import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import { ConflictError } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { advanceBatch, contentStudio, createPiece, createPieceSchema, metricsSchema, saveChecklist, saveMetrics, updatePiece, updateVariant, variantSchema } from "@/server/services/content-studio";
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
    const p1 = await updatePiece(ctx, "theo", { id, expected_version: piece.version, patch: { stage: "script", script: "Plan : accroche, preuve, CTA" } });
    await expect(updatePiece(ctx, "pablo", { id, expected_version: piece.version, patch: { stage: "shoot" } })).rejects.toBeInstanceOf(ConflictError);
    expect(await advanceBatch(ctx, "pablo", { to: "edit", items: [{ id, expected_version: p1.version }] })).toEqual({ moved: 1, conflicts: [] });

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
    expect(s.checklists.linkedin).toHaveLength(2);
    await expect(saveChecklist(ctx, "pablo", { platform: "linkedin", items: [{ key: "a", label: "x" }, { key: "a", label: "y" }] })).rejects.toThrow(/same key/);
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
