import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import { ConflictError } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import {
  addVariants, advanceBatch, browseMedia, contentStudio, createPiece, createPieceSchema, metricsSchema, movePiece, saveChecklist, saveMetrics, updatePiece, updatePieceSchema,
  updateVariant, variantSchema,
} from "@/server/services/content-studio";
import { FakeGoogleStore, MemoryDrive } from "@/fake-google/store";
import { maybeSnapshot, runSnapshot, snapshotStatus } from "@/server/services/snapshot";
import { marketingWeek } from "@/server/services/marketing-week";
import { audienceSeries } from "@/server/services/audience";
import { FakeInstagramStore, MemoryInstagram, startFakeInstagramHttp } from "@/fake-instagram";
import { GraphInstagramAdapter, instagramFromEnv } from "@/data/instagram/graph";
import { signJob, verifyJobBearer, verifyJobSignature } from "@/server/job-auth";
import { POST as jobPOST } from "@/app/api/jobs/snapshot/route";
import { childId, newId } from "@/lib/ids";
import { addDays, localDate } from "@/domain/time";
import { freshSheetsRepo } from "../helpers";

let fake: FakeSheetsServer;
let repo: DataRepository;
let ctx: AppContext;
const IG_VALEMONT = childId("social", "ig-valemont");
const H = 3_600_000;

function igStore(now: Date) {
  const s = new FakeInstagramStore();
  s.now = () => now;
  const days: FakeInstagramStore["accounts"][string]["days"] = {};
  for (let i = 1; i <= 40; i++) days[addDays(localDate(now, "Europe/Paris"), -i)] = { views: 1000 + i, reach: 600, profile_visits: 30, link_clicks: 4 };
  s.accounts["1784000000000001"] = {
    username: "valemont_demo", followers: 812, days,
    media: [
      { id: "m-reel", kind: "reel", permalink: "https://www.instagram.com/reel/demo1/", timestamp: new Date(now.getTime() - 25 * H).toISOString(), insights: { views: 4200, reach: 3100, likes: 120, comments: 9, saves: 30, shares: 12 } },
      { id: "m-story", kind: "story", permalink: "https://www.instagram.com/stories/demo/1/", timestamp: new Date(now.getTime() - 3 * H).toISOString(), viewers: 40, insights: { views: 40, reach: 38, profile_visits: 3, follows: 1 } },
      { id: "m-story-small", kind: "story", permalink: "https://www.instagram.com/stories/demo/2/", timestamp: new Date(now.getTime() - 2 * H).toISOString(), viewers: 3, insights: { views: 3, reach: 3 } },
    ],
  };
  return s;
}
const live = (store: FakeInstagramStore, expiresAt: string | null = null): AppContext => ({ ...ctx, mode: "live", instagram: [{ key: "ig-valemont", port: new MemoryInstagram(store, "1784000000000001"), expiresAt }] });

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  repo = env.repo;
  ctx = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" };
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => fake.stop());

describe("scenario 10: one 30/30 concept, a French and a Spanish version", () => {
  it("plans, schedules and publishes both variants with UTM links and manual metrics, and counts the concept once", async () => {
    const id = newId();
    const input = createPieceSchema.parse({ id, brand: "thirty", title: "Un rapport IA en 30 minutes", format: "reel", hook: "Et si votre concurrent…" });
    expect(await createPiece(ctx, "theo", input)).toEqual({ id, duplicate: false });
    expect((await createPiece(ctx, "theo", input)).duplicate).toBe(true); // retry adds nothing
    let s = await contentStudio(ctx, "theo");
    let piece = s.pieces.find((p) => p.id === id)!;
    expect(piece.variants.map((v) => [v.language, v.owner_founder, v.platform, v.slot_key])).toEqual([["ES", "pablo", "instagram", "3-ig-thirty-story-es"], ["FR", "theo", "instagram", "2-ig-thirty-story-fr"]]);
    expect(piece.variants.every((v) => v.account_id === childId("social", "ig-thirty"))).toBe(true);
    expect(piece.column).toBe("idea");

    // Production steps, then a stale version is a conflict, never a silent overwrite.
    const p1 = await updatePiece(ctx, "theo", updatePieceSchema.parse({ id, expected_version: piece.version, patch: { stage: "draft", script: "Plan : accroche, preuve, CTA" } }));
    await expect(updatePiece(ctx, "pablo", updatePieceSchema.parse({ id, expected_version: piece.version, patch: { stage: "ready" } }))).rejects.toBeInstanceOf(ConflictError);
    expect(await advanceBatch(ctx, "pablo", { to: "ready", items: [{ id, expected_version: p1.version }] })).toEqual({ moved: 1, conflicts: [] });

    const [es, fr] = piece.variants;
    const frSaved = await updateVariant(ctx, "theo", variantSchema.parse({ id: fr.id, expected_version: fr.version, action: "schedule", patch: { scheduled_date: "2026-11-10", destination_url: "https://example.com/fr", caption: "Votre rapport IA", checklist_done: ["hook", "subtitles"] } }));
    expect(frSaved.status).toBe("scheduled");
    const frPub = await updateVariant(ctx, "theo", variantSchema.parse({ id: fr.id, expected_version: frSaved.version, action: "publish", patch: { platform_post_url: "https://www.instagram.com/reel/demo-fr/", published_at: new Date().toISOString() } }));
    await updateVariant(ctx, "pablo", variantSchema.parse({ id: es.id, expected_version: es.version, action: "publish", patch: { destination_url: "https://example.com/es", platform_post_url: "https://www.instagram.com/reel/demo-es/" } }));
    // Retrying the publish (same variant) logs nothing more.
    await updateVariant(ctx, "theo", variantSchema.parse({ id: fr.id, expected_version: frPub.version, action: "publish", patch: {} }));

    await expect(saveMetrics(ctx, "theo", metricsSchema.parse({ variant_id: fr.id, checkpoint: "h24", impressions: 10 }))).rejects.toThrow(/views/);
    await saveMetrics(ctx, "theo", metricsSchema.parse({ variant_id: fr.id, checkpoint: "h24", views: 900, profile_visits: 30, link_clicks: 8, site_visits: 6, leads: 1 }));
    await saveMetrics(ctx, "theo", metricsSchema.parse({ variant_id: fr.id, checkpoint: "h24", views: 1000, profile_visits: 30, link_clicks: 8, site_visits: 6, leads: 1 })); // correction, same row
    await saveMetrics(ctx, "pablo", metricsSchema.parse({ variant_id: es.id, checkpoint: "h72", views: 500, link_clicks: 2 }));

    s = await contentStudio(ctx, "pablo");
    piece = s.pieces.find((p) => p.id === id)!;
    expect(piece.column).toBe("published");
    const frV = piece.variants.find((v) => v.language === "FR")!;
    expect(frV.link).toContain("utm_source=instagram");
    expect(frV.link).toContain("utm_content=un-rapport-ia-en-30-minutes-reel-fr");
    expect(frV.checklist).toMatchObject({ done: 2, total: 9 });
    expect(frV.checkpoints.find((c) => c.key === "h24")?.snapshot).toMatchObject({ views: 1000, source: "manual" });
    expect(s.weekPath.instagram.steps.views).toEqual({ value: 1500, posts: 2 });
    expect(s.weekPath.instagram.steps.leads).toEqual({ value: 1, posts: 1 });
    expect(s.weekPath.linkedin.posts).toBe(0);
    expect((await repo.list("SocialPostSnapshots", { fresh: true })).rows.filter((r) => r.variant_id === fr.id)).toHaveLength(1);

    const week = await marketingWeek(ctx, "theo");
    const done = Object.fromEntries(week.items.map((i) => [i.key, i.done]));
    expect(done).toMatchObject({ "concept-thirty": 1, "reel-thirty-fr": 1, "reel-thirty-es": 1, "reel-valemont-fr": 0 });
    // No geo-targeting is assumed: nothing about countries is stored on the piece or its variants.
    expect(JSON.stringify(piece)).not.toMatch(/country/);
  });

  it("edits the checklist per platform and never tags a personal post with a brand", async () => {
    await saveChecklist(ctx, "pablo", { platform: "linkedin", items: [{ key: "hook", label: "Gancho" }, { key: "cta", label: "CTA" }] });
    const id = newId();
    await createPiece(ctx, "pablo", createPieceSchema.parse({ id, brand: "thirty", title: "Lo que aprendí", format: "personal_post", languages: ["ES"] }));
    const s = await contentStudio(ctx, "theo");
    const p = s.pieces.find((x) => x.id === id)!;
    expect(p.brand).toBeNull();
    expect(p.variants[0]).toMatchObject({ platform: "linkedin_personal", owner_founder: "pablo", account_id: childId("social", "li-pablo") });
    expect(p.format).toBe("post"); // legacy "personal_post" is read as a post on the personal profile
    expect(s.checklists.linkedin).toHaveLength(2);
    await expect(saveChecklist(ctx, "pablo", { platform: "linkedin", items: [{ key: "a", label: "x" }, { key: "a", label: "y" }] })).rejects.toThrow(/same key/);
  });
});

describe("iteration 11 (D081): accounts × languages, planning, Kanban moves, Drive media, 409", () => {
  const LI_THEO = childId("social", "li-theo");
  const LI_VALEMONT = childId("social", "li-valemont");
  const IG_THIRTY = childId("social", "ig-thirty");
  function withDrive() {
    const store = new FakeGoogleStore();
    store.addFile({ id: "fld-content", name: "Contenu", mimeType: "application/vnd.google-apps.folder", parents: ["root-folder"] });
    store.addFile({ id: "vid-1", name: "reel-fr.mp4", mimeType: "video/mp4", parents: ["fld-content"], thumbnailLink: "https://drive.example.com/thumb/vid-1", videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "42000" } });
    store.addFile({ id: "img-1", name: "slide.png", mimeType: "image/png", parents: ["fld-content"], imageMediaMetadata: { width: 1080, height: 1350 } });
    store.addFile({ id: "doc-1", name: "notes.txt", mimeType: "text/plain", parents: ["fld-content"] });
    return { ...ctx, drive: new MemoryDrive(store) } satisfies AppContext;
  }

  it("creates a one-line idea with no version, then a post on three accounts, schedules, flags a conflict and moves it on the board", async () => {
    const idea = newId();
    await createPiece(ctx, "theo", createPieceSchema.parse({ id: idea, title: "Idée : le devis en 24 h", brand: "consulting", format: "post", targets: [] }));
    let s = await contentStudio(ctx, "theo");
    expect(s.pieces.find((p) => p.id === idea)).toMatchObject({ column: "idea", variants: [], score: null });
    expect(s.accounts.map((a) => a.label)).toEqual(["LinkedIn Théo", "LinkedIn Pablo", "LinkedIn Valemont", "LinkedIn 30/30 AI", "Instagram Valemont", "Instagram 30/30 AI"]);

    const id = newId();
    const targets = [{ account_id: LI_THEO, language: "FR" }, { account_id: LI_VALEMONT, language: "FR" }, { account_id: LI_VALEMONT, language: "ES" }, { account_id: LI_THEO, language: "FR" }];
    await createPiece(ctx, "theo", createPieceSchema.parse({ id, title: "3 leçons de 40 appels", brand: "consulting", format: "post", stage: "draft", targets }));
    expect((await addVariants(ctx, "theo", { piece_id: id, targets: [{ account_id: LI_VALEMONT, language: "ES" }, { account_id: IG_THIRTY, language: "ES" }] }))).toMatchObject({ added: 1, skipped: 1 });
    s = await contentStudio(ctx, "theo");
    let piece = s.pieces.find((p) => p.id === id)!;
    expect(piece.variants.map((v) => [v.account, v.language, v.owner_founder, v.link_placement])).toEqual([
      ["Instagram 30/30 AI", "ES", "pablo", "bio"], ["LinkedIn Théo", "FR", "theo", "first_comment"], ["LinkedIn Valemont", "ES", "pablo", "first_comment"], ["LinkedIn Valemont", "FR", "theo", "first_comment"],
    ]);

    // Kanban: no dated version yet → cannot enter Scheduled.
    await expect(movePiece(ctx, "theo", { id, expected_version: piece.version, to: "scheduled" })).rejects.toThrow(/date/);
    const liTheo = piece.variants.find((v) => v.account_id === LI_THEO)!;
    const saved = await updateVariant(ctx, "theo", variantSchema.parse({ id: liTheo.id, expected_version: liTheo.version, action: "save", patch: { hook: "40 appels.", caption: "Leçon 1", scheduled_date: "2026-11-10", scheduled_time: "08:30" } }));
    expect(saved.status).toBe("draft");
    const moved = await movePiece(ctx, "theo", { id, expected_version: piece.version, to: "scheduled" });
    expect(moved).toMatchObject({ scheduled: 1, unscheduled: 0 });
    // A second post on the same account 20 minutes later is flagged, not blocked.
    const other = newId();
    await createPiece(ctx, "theo", createPieceSchema.parse({ id: other, title: "Autre post", brand: null, format: "post", targets: [{ account_id: LI_THEO, language: "FR" }] }));
    const ov = (await contentStudio(ctx, "theo")).pieces.find((p) => p.id === other)!.variants[0];
    await updateVariant(ctx, "theo", variantSchema.parse({ id: ov.id, expected_version: ov.version, action: "schedule", patch: { scheduled_date: "2026-11-10", scheduled_time: "08:50" } }));
    s = await contentStudio(ctx, "theo");
    piece = s.pieces.find((p) => p.id === id)!;
    expect(piece.column).toBe("scheduled");
    expect(piece.variants.find((v) => v.id === liTheo.id)!.conflicts).toEqual([ov.id]);
    expect(s.schedule.filter((e) => e.conflict).map((e) => e.id).sort()).toEqual([liTheo.id, ov.id].sort());
    expect(piece.variants.find((v) => v.id === liTheo.id)!.score.score).toBeGreaterThan(0);

    // Drag to another day keeps it scheduled; moving the card back to Ready puts it back to draft with its date.
    const cur = piece.variants.find((v) => v.id === liTheo.id)!;
    expect((await updateVariant(ctx, "theo", variantSchema.parse({ id: cur.id, expected_version: cur.version, action: "schedule", patch: { scheduled_date: "2026-11-12" } })))).toMatchObject({ status: "scheduled", scheduled_date: "2026-11-12", scheduled_time: "08:30" });
    await expect(movePiece(ctx, "pablo", { id, expected_version: piece.version - 1, to: "ready" })).rejects.toBeInstanceOf(ConflictError);
    expect(await movePiece(ctx, "pablo", { id, expected_version: piece.version, to: "ready" })).toMatchObject({ unscheduled: 1 });
    const back = (await contentStudio(ctx, "theo")).pieces.find((p) => p.id === id)!;
    expect(back.column).toBe("ready");
    expect(back.variants.find((v) => v.id === liTheo.id)).toMatchObject({ status: "draft", scheduled_date: "2026-11-12" });
  });

  it("schedules a new version straight onto a recommended slot", async () => {
    const id = newId();
    await createPiece(ctx, "pablo", createPieceSchema.parse({ id, title: "Informe IA", brand: "thirty", format: "reel", targets: [] }));
    const r = await addVariants(ctx, "pablo", { piece_id: id, targets: [{ account_id: IG_THIRTY, language: "ES" }], schedule: { date: "2026-11-11", time: "12:00" } });
    const v = (await repo.get("ContentVariants", r.ids[0], { fresh: true }))!;
    expect(v).toMatchObject({ status: "scheduled", scheduled_date: "2026-11-11", scheduled_time: "12:00", slot_key: "3-ig-thirty-story-es" });
  });

  it("attaches Drive media by id (no copy), keeps their metadata, refuses unknown or non-media files, and a stale autosave is a 409", async () => {
    const c = withDrive();
    await repo.insert("SystemSettings", [{ id: childId("setting", "drive_folder_id"), key: "drive_folder_id", value: "root-folder", description: "" }], { founder: "system" });
    const picker = await browseMedia(c, { folder: "fld-content", q: "" });
    expect(picker.files.map((f) => [f.file_id, f.is_folder])).toEqual([["vid-1", false], ["img-1", false]]); // the text file is hidden
    expect((await browseMedia(c, { q: "" })).files.map((f) => f.name)).toEqual(["Contenu"]);

    const id = newId();
    await createPiece(c, "theo", createPieceSchema.parse({ id, title: "Reel FR", brand: "thirty", format: "reel", targets: [{ account_id: IG_THIRTY, language: "FR" }] }));
    const v = (await contentStudio(c, "theo")).pieces.find((p) => p.id === id)!.variants[0];
    const row = await updateVariant(c, "theo", variantSchema.parse({ id: v.id, expected_version: v.version, patch: { drive_media: [{ file_id: "vid-1" }], caption: "Version 1" } }));
    expect(row.drive_media).toEqual([{ file_id: "vid-1", name: "reel-fr.mp4", mime: "video/mp4", web_link: "https://drive.example.com/file/vid-1", thumbnail_link: "https://drive.example.com/thumb/vid-1", width: 1080, height: 1920, duration_ms: 42_000 }]);
    await expect(updateVariant(c, "theo", variantSchema.parse({ id: v.id, expected_version: row.version, patch: { drive_media: [{ file_id: "nope" }] } }))).rejects.toThrow(/not visible/);
    await expect(updateVariant(c, "theo", variantSchema.parse({ id: v.id, expected_version: row.version, patch: { drive_media: [{ file_id: "doc-1" }] } }))).rejects.toThrow(/image, a video/);
    // Pablo's tab still holds version 1 of the row: his autosave is refused, Théo's text is kept.
    await expect(updateVariant(c, "pablo", variantSchema.parse({ id: v.id, expected_version: v.version, patch: { caption: "Écrasé" } }))).rejects.toBeInstanceOf(ConflictError);
    const studio = await contentStudio(c, "theo");
    const fresh = studio.pieces.find((p) => p.id === id)!.variants[0];
    expect(fresh.caption).toBe("Version 1");
    expect(fresh.drive_media).toHaveLength(1);
    // Drive is the only copy: the Sheets row holds the id and link, never the bytes.
    expect(JSON.stringify(fresh.drive_media)).not.toMatch(/base64/);
    // Publishing an Instagram carousel counts as an Instagram post in the weekly goals log.
    const car = newId();
    await createPiece(c, "theo", createPieceSchema.parse({ id: car, title: "Carrousel", brand: "consulting", format: "carousel", targets: [{ account_id: IG_VALEMONT, language: "FR" }] }));
    const cv = (await contentStudio(c, "theo")).pieces.find((p) => p.id === car)!.variants[0];
    await updateVariant(c, "theo", variantSchema.parse({ id: cv.id, expected_version: cv.version, action: "publish", patch: { platform_post_url: "https://www.instagram.com/p/demo-car/" } }));
    const logs = (await repo.list("ContentLog", { fresh: true })).rows.filter((l) => l.title === "Carrousel");
    expect(logs.map((l) => l.deliverable)).toEqual(["ig_post"]);
  });
});

describe("scenario 22: the snapshot job", () => {
  it("captures once per slot; a repeat (or a concurrent call) is a no-op", async () => {
    const now = new Date();
    const c = live(igStore(now));
    const [a, b] = await Promise.all([runSnapshot(c, { now, trigger: "scheduler" }), runSnapshot(c, { now, trigger: "scheduler" })]);
    expect(a).toBe(b); // same in-flight run
    expect(a).toMatchObject({ status: "done", accounts: 1, post_rows: 1, story_rows: 2 });
    expect(a.status === "done" && a.daily_rows).toBe(7); // yesterday + 6 missed days the API still serves
    expect(await runSnapshot(c, { now, trigger: "first_request" })).toMatchObject({ status: "skipped" });
    const runs = (await repo.list("SnapshotRuns", { fresh: true })).rows;
    expect(runs.filter((r) => r.status === "done")).toHaveLength(1);
    const st = await snapshotStatus(c, now);
    expect(st).toMatchObject({ capability: "connected", lastError: "" });
    expect(st.lastSuccessAt).toBeTruthy();
  });

  it("keeps a story captured inside 24 h after the API stops serving it, and stores < 5 viewers as not available", async () => {
    const t0 = new Date();
    const store = igStore(t0);
    await runSnapshot(live(store), { now: t0, trigger: "scheduler" });
    const t1 = new Date(t0.getTime() + 26 * H);
    store.now = () => t1;
    expect(await new MemoryInstagram(store, "1784000000000001").stories()).toHaveLength(0); // the fake no longer serves them
    await runSnapshot(live(store), { now: t1, trigger: "scheduler" });
    const snaps = (await repo.list("SocialPostSnapshots", { fresh: true })).rows;
    const story = snaps.filter((s) => s.media_id === "m-story");
    expect(story).toHaveLength(1);
    expect(story[0]).toMatchObject({ checkpoint: "live", availability: "ok", views: 40, source: "api" });
    const small = snaps.find((s) => s.media_id === "m-story-small")!;
    expect(small).toMatchObject({ availability: "not_available", views: null, reach: null });
    // The Reel got its 24 h checkpoint in the first run and its 72 h one only once it is due.
    expect(snaps.filter((s) => s.media_id === "m-reel").map((s) => s.checkpoint)).toEqual(["h24"]);
    const t2 = new Date(t0.getTime() + 50 * H);
    store.now = () => t2;
    await runSnapshot(live(store), { now: t2, trigger: "scheduler" });
    expect((await repo.list("SocialPostSnapshots", { fresh: true })).rows.filter((s) => s.media_id === "m-reel").map((s) => [s.checkpoint, s.age_hours])).toEqual([["h24", 25], ["h72", 75]]);
  });

  it("renders missed days as gaps: followers unknown, days the API no longer serves stay empty", async () => {
    const now = new Date();
    const early = new Date(now.getTime() - 3 * 24 * H);
    const store = igStore(now);
    store.windowDays = 2;
    store.now = () => early;
    await runSnapshot(live(store), { now: early, trigger: "scheduler" });
    store.now = () => now;
    await runSnapshot(live(store), { now, trigger: "scheduler" }); // two days without any run in between
    const series = await audienceSeries(live(store), "theo", { account_id: IG_VALEMONT, metric: "followers", days: 7 });
    const today = localDate(now, "Europe/Paris");
    const byDate = Object.fromEntries(series.points.map((p) => [p.date, p]));
    expect(byDate[addDays(today, -1)]).toMatchObject({ value: 812, source: "api" });
    expect(byDate[addDays(today, -2)].value).toBeNull(); // views backfilled, followers unknown → gap, never interpolated
    expect(byDate[addDays(today, -3)].value).toBeNull();
    const views = await audienceSeries(live(store), "theo", { account_id: IG_VALEMONT, metric: "views", days: 7 });
    const v = Object.fromEntries(views.points.map((p) => [p.date, p.value]));
    expect(v[addDays(today, -2)]).toBe(1002);
    expect(v[addDays(today, -3)]).toBeNull(); // outside the 2-day window when the job came back
    expect(v[addDays(today, -4)]).toBe(1004); // captured by the early run (its "yesterday")
    expect(views.allowedMetrics).not.toContain("impressions"); // Instagram views and LinkedIn impressions are never mixed
  });

  it("an account failure records the error, leaves the slot open and the next trigger retries", async () => {
    const now = new Date();
    const c = live(igStore(now));
    c.instagram = [{ key: "ig-valemont", expiresAt: null, port: { ...new MemoryInstagram(igStore(now), "1784000000000001"), profile: async () => { throw new Error("Instagram returned 500"); }, dayInsights: async () => null, media: async () => [], stories: async () => [], insights: async () => ({ available: false }) } }];
    expect(await runSnapshot(c, { now, trigger: "scheduler" })).toMatchObject({ status: "error" });
    expect((await repo.get("IntegrationStatuses", childId("integration", "instagram"), { fresh: true }))?.status).toBe("error");
    expect((await runSnapshot(live(igStore(now)), { now, trigger: "scheduler" })).status).toBe("done");
  });

  it("creates a token task 14 days before expiry, once", async () => {
    const now = new Date();
    const exp = addDays(localDate(now, "UTC"), 10);
    await runSnapshot(live(igStore(now), exp), { now, trigger: "scheduler" });
    await runSnapshot(live(igStore(now), exp), { now: new Date(now.getTime() + 6 * H), trigger: "scheduler" });
    expect((await repo.list("Tasks", { fresh: true })).rows.filter((t) => t.source_id === "ig-token:ig-valemont")).toHaveLength(1);
  });

  it("lazy trigger: nothing in DEMO or without Instagram; one attempt per slot in LIVE", async () => {
    expect(maybeSnapshot(ctx)).toBeNull();
    const now = new Date("2031-01-01T07:00:00Z");
    const c = live(igStore(now));
    const p = maybeSnapshot(c, now);
    expect(p).not.toBeNull();
    await p;
    expect(maybeSnapshot(c, new Date("2031-01-01T08:00:00Z"))).toBeNull();
  });

  it("matches API captures to the published variant by its post link", async () => {
    const now = new Date();
    const id = newId();
    await createPiece(ctx, "theo", createPieceSchema.parse({ id, brand: "consulting", title: "Visite terrain", format: "reel", languages: ["FR"] }));
    const v = (await contentStudio(ctx, "theo")).pieces.find((p) => p.id === id)!.variants[0];
    expect(v.account_id).toBe(IG_VALEMONT);
    await updateVariant(ctx, "theo", variantSchema.parse({ id: v.id, expected_version: v.version, action: "publish", patch: { platform_post_url: "https://www.instagram.com/reel/demo1" } }));
    await runSnapshot(live(igStore(now)), { now, trigger: "scheduler" });
    const fr = (await contentStudio(ctx, "theo")).pieces.find((p) => p.id === id)!.variants[0];
    expect(fr.latest).toMatchObject({ checkpoint: "h24", source: "api" });
    expect(fr.path.views).toBe(4200);
  });
});

describe("snapshot job endpoint and Graph adapter", () => {
  it("verifies the signature with a timestamp window, or a long bearer token", () => {
    const body = "{}";
    const { ts, sig } = signJob(body, "job-secret-demo");
    expect(verifyJobSignature(body, ts, sig, "job-secret-demo")).toBe(true);
    expect(verifyJobSignature(body + " ", ts, sig, "job-secret-demo")).toBe(false);
    expect(verifyJobSignature(body, ts, sig, "other")).toBe(false);
    expect(verifyJobSignature(body, ts, sig, "job-secret-demo", Date.now() + 10 * 60_000)).toBe(false); // replay outside 5 min
    expect(verifyJobSignature(body, ts, sig, undefined)).toBe(false);
    expect(verifyJobBearer("Bearer abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(verifyJobBearer("Bearer short", "short")).toBe(false);
    expect(verifyJobBearer("Bearer abcdefghijklmnopqrstuvwxyZ", "abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });
  it("refuses unconfigured, unsigned and badly signed calls before touching storage", async () => {
    const req = (headers: Record<string, string> = {}) => new NextRequest("https://app.example.com/api/jobs/snapshot", { method: "POST", body: "{}", headers });
    delete process.env.SNAPSHOT_JOB_SECRET;
    delete process.env.SNAPSHOT_JOB_TOKEN;
    expect((await jobPOST(req())).status).toBe(503);
    process.env.SNAPSHOT_JOB_SECRET = "job-secret-demo";
    expect((await jobPOST(req())).status).toBe(401);
    const bad = signJob("{}", "nope");
    expect((await jobPOST(req({ "x-valemont-timestamp": bad.ts, "x-valemont-signature": bad.sig }))).status).toBe(401);
    const old = signJob("{}", "job-secret-demo", Date.now() - 3_600_000);
    expect((await jobPOST(req({ "x-valemont-timestamp": old.ts, "x-valemont-signature": old.sig }))).status).toBe(401);
    delete process.env.SNAPSHOT_JOB_SECRET;
  });
  it("reads the fake Graph API over HTTP with retries on 429 and reports an expired token", async () => {
    const now = new Date();
    const store = igStore(now);
    const { url, server } = await startFakeInstagramHttp(store, "fake-ig-token");
    try {
      const a = new GraphInstagramAdapter(url, "1784000000000001", "fake-ig-token", { sleep: async () => undefined });
      store.faults = [429, 503];
      expect(await a.profile()).toEqual({ username: "valemont_demo", followers: 812 });
      const media = await a.media(Math.floor(now.getTime() / 1000) - 3 * 86_400);
      expect(media.map((m) => [m.id, m.kind])).toEqual([["m-reel", "reel"]]);
      expect(await a.insights(media[0])).toMatchObject({ available: true, views: 4200, saves: 30 });
      const stories = await a.stories();
      expect(stories).toHaveLength(2);
      expect(await a.insights(stories.find((s) => s.id === "m-story-small")!)).toEqual({ available: false });
      const y = addDays(localDate(now, "Europe/Paris"), -1);
      expect(await a.dayInsights(Date.parse(`${y}T00:00:00Z`) / 1000, Date.parse(`${y}T00:00:00Z`) / 1000 + 86_400)).toMatchObject({ views: 1001, link_clicks: 4 });
      await expect(new GraphInstagramAdapter(url, "1784000000000001", "wrong").profile()).rejects.toThrow(/expired or revoked/);
      store.faults = [500, 500, 500, 500];
      await expect(a.profile()).rejects.toThrow(/500/);
    } finally {
      server.close();
    }
  });
  it("reads accounts only from env and ignores malformed JSON", () => {
    expect(instagramFromEnv({})).toEqual([]);
    expect(instagramFromEnv({ INSTAGRAM_ACCOUNTS_JSON: "{oops" })).toEqual([]);
    const two = instagramFromEnv({ INSTAGRAM_ACCOUNTS_JSON: JSON.stringify([{ account: "ig-thirty", ig_user_id: "1", token: "t", expires_at: "2027-01-01" }]), INSTAGRAM_ACCESS_TOKEN: "t2", INSTAGRAM_BUSINESS_ACCOUNT_ID: "2" });
    expect(two.map((a) => [a.key, a.expiresAt])).toEqual([["ig-thirty", "2027-01-01"], ["ig-valemont", null]]);
  });
});
