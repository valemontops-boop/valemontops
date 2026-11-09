import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { InMemoryRepository } from "@/data/memory";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { logActivity, logActivitySchema } from "@/server/services/activities";
import { optOutContact } from "@/server/services/crm";
import { createTask, createTaskSchema } from "@/server/services/tasks";
import { buildExport, exportFile, exportSchema, toXlsx } from "@/server/services/export";
import { renderMarkdown } from "@/domain/export";
import { post, recordDelivery, signBody, trackerAction, trackerConfig, trackerFeed, trackerSink, trackerStatus, type FetchLike } from "@/server/services/tracker";
import { setActivitySink } from "@/server/activity-hooks";
import { founderForFeedToken } from "@/server/tracker-auth";
import { MISSING } from "@/i18n";
import { addDays, localDate } from "@/domain/time";

let repo: InMemoryRepository;
let privates: Record<string, InMemoryRepository>;
let ctx: AppContext;
const today = localDate(new Date(), "Europe/Paris");
const from = addDays(today, -6);
const SECRET = "test-secret-0123456789abcdef";
const ENV = { TRACKER_WEBHOOK_URL_THEO: "https://tracker.example.com/hooks/valemont", TRACKER_WEBHOOK_SECRET_THEO: SECRET, TRACKER_FEED_TOKEN_THEO: "feed-token-theo-0123456789abcdef" };

async function log(founder: "theo" | "pablo", input: Record<string, unknown>) {
  return logActivity(repo, founder, logActivitySchema.parse({ idempotency_key: randomUUID(), ...input }));
}

/** Records every POST; answers with the given status (or throws). */
function fakeFetch(status: number | "throw" = 200) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    if (status === "throw") throw new TypeError("fetch failed");
    return new Response("{}", { status });
  };
  return { fn, calls };
}

let alphaId = "";
beforeEach(async () => {
  repo = new InMemoryRepository();
  privates = { theo: new InMemoryRepository(), pablo: new InMemoryRepository() };
  ctx = { repo, privateRepo: (f) => privates[f] ?? null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" };
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  const a = await log("theo", { activity_type: "connected_call", outcome: "interested", objections: ["too_expensive"], duration_sec: 95, fast_contact: { company_name: "Plomberie Alpha (test)", contact_name: "Jean Testeur", phone: "+33 6 12 34 56 78", email: "alpha@example.com", country: "FR", contact_type: "professional_named", niche: "Plombier" } });
  alphaId = a.event.account_id;
  const b = await log("theo", { activity_type: "cold_call", outcome: "no_answer", fast_contact: { company_name: "Garage Beta (test)", contact_name: "Marie Optout", phone: "+33 6 98 76 54 32", email: "beta@example.com", country: "FR", contact_type: "professional_named", niche: "Garage" } });
  await optOutContact(repo, "theo", { contact_id: b.created.contactId!, reason: "Asked not to be contacted" });
  await log("pablo", { activity_type: "connected_call", outcome: "meeting_booked", fast_contact: { company_name: "Fontanería Gamma (test)", contact_name: "", phone: "+34 600 111 222", email: "", country: "ES", contact_type: "company_generic", niche: "Fontanero" } });
  await log("theo", { activity_type: "qualified_conversation", account_id: alphaId });
  await createTask(ctx, "pablo", createTaskSchema.parse({ id: randomUUID(), task: { title: "Secret pablo task (test)", private: true, due_at: today } }));
  await createTask(ctx, "theo", createTaskSchema.parse({ id: randomUUID(), task: { title: "=HYPERLINK(\"https://example.com\")", owner: "theo", priority: "P1", due_at: today } }));
});
afterEach(() => setActivitySink(null));

describe("Export for AI analysis", () => {
  it("validates the period", async () => {
    expect(exportSchema.safeParse({ from: "2026-13-01", to: today }).success).toBe(false);
    expect(exportSchema.parse({ from, to: today })).toMatchObject({ format: "md", scope: "team" });
    await expect(buildExport(ctx, "theo", { from: today, to: from, scope: "team" })).rejects.toThrow(/start date/);
  });

  it("builds a Markdown file in the founder's language with every section, and no English left", async () => {
    MISSING.clear();
    const fr = renderMarkdown(await buildExport(ctx, "theo", { from, to: today, scope: "team" }));
    const es = renderMarkdown(await buildExport(ctx, "pablo", { from, to: today, scope: "team" }));
    expect([...MISSING]).toEqual([]);
    expect(fr).toMatch(/^# Valemont OS — données pour une analyse par l'IA/);
    expect(es).toMatch(/^# Valemont OS — datos para un análisis con IA/);
    for (const h of ["Définitions", "Résumé", "Conversion par canal", "Objections", "Journal des appels", "E-mails et WhatsApp", "Pipeline", "Tâches", "Contenu publié", "Trafic du site et audience sociale", "Finances", "Bilans de la semaine", "Questions à poser à l'IA"]) expect(fr).toContain(h);
    expect(es).toContain("## Preguntas para hacer a la IA");
    // KPI table with both founders and the team; qualified conversations counted
    expect(fr).toMatch(/\| Conversation qualifiée \| 1 \| 0 \| 1 \|/);
    expect(fr).toContain("Plomberie Alpha (test)");
    expect(fr).toContain("| Trop cher | 1 | 1 | 100% |");
  });

  it("respects privacy: no phones, emails or contact names; opted-out businesses unnamed; never the other founder's private tasks", async () => {
    const theo = renderMarkdown(await buildExport(ctx, "theo", { from, to: today, scope: "team" }));
    for (const s of ["+33", "+34", "@example.com", "Jean Testeur", "Marie Optout", "Garage Beta (test)", "Secret pablo task"]) expect(theo).not.toContain(s);
    expect(theo).toContain("Opposé au démarchage (nom masqué)");
    const pablo = renderMarkdown(await buildExport(ctx, "pablo", { from, to: today, scope: "team" }));
    expect(pablo).toContain("Secret pablo task (test)");
    const mine = renderMarkdown(await buildExport(ctx, "theo", { from, to: today, scope: "me" }));
    expect(mine).not.toContain("Fontanería Gamma (test)");
    expect(mine).not.toContain("| Pablo |");
    expect(mine).not.toContain("Finances"); // company money only in the team export
  });

  it("builds an Excel workbook: one sheet per table, bold frozen header, numbers as numbers, formulas neutralised", async () => {
    const file = await exportFile(ctx, "theo", { from, to: today, scope: "team", format: "xlsx" });
    expect(file.filename).toBe(`valemont-team-${from}_${today}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(file.body as Uint8Array) as never);
    expect(wb.worksheets.length).toBeGreaterThan(10);
    const kpi = wb.worksheets.find((w) => w.name.startsWith("Résumé - Chiffres"))!;
    expect(kpi.getRow(1).font?.bold).toBe(true);
    expect(kpi.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const dials = kpi.getSheetValues().find((r) => Array.isArray(r) && r[1] === "Appels passés") as unknown[] | undefined;
    if (dials) expect(typeof dials[2]).toBe("number");
    const outreach = kpi.getRow(2).getCell(2).value;
    expect(typeof outreach).toBe("number");
    const tasks = wb.worksheets.filter((w) => w.name.startsWith("Tâches"));
    const titles = tasks.flatMap((w) => w.getColumn(1).values.filter(Boolean).map(String));
    expect(titles).toContain("'=HYPERLINK(\"https://example.com\")");
    expect(titles).not.toContain("=HYPERLINK(\"https://example.com\")");
    expect(await toXlsx(await buildExport(ctx, "pablo", { from, to: today, scope: "me" }))).toBeInstanceOf(Uint8Array);
  });
});

describe("My tracker", () => {
  it("validates its configuration from env: https only, a real secret", () => {
    expect(trackerConfig("theo", ENV)).toMatchObject({ url: ENV.TRACKER_WEBHOOK_URL_THEO, problem: null, feedToken: true });
    expect(trackerConfig("theo", { ...ENV, TRACKER_WEBHOOK_URL_THEO: "http://tracker.example.com/x" })).toMatchObject({ url: null, problem: expect.stringMatching(/https/) });
    expect(trackerConfig("theo", { ...ENV, TRACKER_WEBHOOK_SECRET_THEO: "short" })).toMatchObject({ url: null });
    expect(trackerConfig("pablo", ENV)).toMatchObject({ url: null, problem: null, feedToken: false });
  });

  it("posts the documented payload, signed with HMAC-SHA256 of the body, idempotency key = event id", async () => {
    const f = fakeFetch();
    setActivitySink(trackerSink(ENV, f.fn));
    const r = await log("theo", { activity_type: "connected_call", outcome: "interested", account_id: alphaId, duration_sec: 61 });
    await vi.waitFor(() => expect(f.calls).toHaveLength(1));
    const c = f.calls[0];
    expect(c.url).toBe(ENV.TRACKER_WEBHOOK_URL_THEO);
    expect(c.headers["x-valemont-signature"]).toBe(`sha256=${createHmac("sha256", SECRET).update(c.body).digest("hex")}`);
    expect(c.headers["x-valemont-signature"]).toBe(signBody(SECRET, c.body));
    expect(c.headers["x-valemont-idempotency-key"]).toBe(r.event.id);
    const body = JSON.parse(c.body);
    expect(body).toEqual({
      source: "valemont-os", version: 1, founder: "theo",
      event: { id: r.event.id, type: "connected_call", occurred_at: r.event.occurred_at, local_date: r.event.local_date, channel: "phone", outcome: "interested", account: "Plomberie Alpha (test)", duration_sec: 61, project: "Valemont" },
    });
    expect(c.body).not.toMatch(/\+33|example\.com|Jean/);
    // Pablo has no tracker: nothing is sent for his activity.
    await log("pablo", { activity_type: "cold_call", outcome: "no_answer", account_id: alphaId });
    await new Promise((r) => setTimeout(r, 20));
    expect(f.calls).toHaveLength(1);
  });

  it("never fails the founder's action when the tracker is down, slow or the sink throws", async () => {
    const down = fakeFetch("throw");
    setActivitySink(trackerSink(ENV, down.fn));
    const r1 = await log("theo", { activity_type: "cold_call", outcome: "no_answer", account_id: alphaId });
    expect(r1.duplicate).toBe(false);
    await vi.waitFor(() => expect(down.calls).toHaveLength(1));
    const status = await vi.waitFor(async () => {
      const s = await trackerStatus({ ...ctx, mode: "live" }, "theo", ENV);
      expect(s.last?.status).toBe("error");
      return s;
    });
    expect(status.last?.error).toMatch(/reached/);
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(status.host).toBe("tracker.example.com");
    setActivitySink({ activity: () => { throw new Error("boom"); } });
    await expect(log("theo", { activity_type: "cold_call", outcome: "no_answer", account_id: alphaId })).resolves.toMatchObject({ duplicate: false });
    setActivitySink({ activity: () => new Promise(() => undefined) }); // never answers
    await expect(log("theo", { activity_type: "cold_call", outcome: "no_answer", account_id: alphaId })).resolves.toMatchObject({ duplicate: false });
  });

  it("maps HTTP errors and records the last delivery only when it changes", async () => {
    expect(await post({ url: ENV.TRACKER_WEBHOOK_URL_THEO, secret: SECRET }, { a: 1 }, "k", fakeFetch(500).fn)).toMatchObject({ ok: false, status: 500, error: "The tracker answered HTTP 500." });
    await recordDelivery(repo, "theo", { ok: true, status: 200, error: "" });
    const v1 = (await repo.list("IntegrationStatuses")).rows.find((r) => r.integration === "tracker_theo")!;
    await recordDelivery(repo, "theo", { ok: true, status: 200, error: "" });
    const v2 = (await repo.list("IntegrationStatuses")).rows.find((r) => r.integration === "tracker_theo")!;
    expect(v2.version).toBe(v1.version);
  });

  it("test event and period backfill: LIVE only, idempotent keys, opted-out businesses unnamed", async () => {
    await expect(trackerAction(ctx, "theo", { action: "test" }, ENV, fakeFetch().fn)).rejects.toThrow(/DEMO/);
    const live = { ...ctx, mode: "live" as const };
    await expect(trackerAction(live, "pablo", { action: "test" }, ENV, fakeFetch().fn)).rejects.toThrow(/not configured/);
    const f = fakeFetch();
    expect(await trackerAction(live, "theo", { action: "test" }, ENV, f.fn)).toMatchObject({ sent: 1 });
    expect(JSON.parse(f.calls[0].body).event.type).toBe("test");
    const b = fakeFetch();
    const r = await trackerAction(live, "theo", { action: "backfill", from, to: today }, ENV, b.fn);
    expect(r).toMatchObject({ sent: 3, failed: 0, total: 3 });
    expect(new Set(b.calls.map((c) => c.headers["x-valemont-idempotency-key"])).size).toBe(3);
    const accounts = b.calls.map((c) => JSON.parse(c.body).event.account);
    expect(accounts).toContain("Plomberie Alpha (test)");
    expect(accounts).not.toContain("Garage Beta (test)");
    const again = fakeFetch();
    await trackerAction(live, "theo", { action: "backfill", from, to: today }, ENV, again.fn);
    expect(again.calls.map((c) => c.headers["x-valemont-idempotency-key"]).sort()).toEqual(b.calls.map((c) => c.headers["x-valemont-idempotency-key"]).sort());
    const s = fakeFetch();
    await trackerAction(live, "theo", { action: "summary", date: today }, ENV, s.fn);
    expect(JSON.parse(s.calls[0].body).summary).toMatchObject({ date: today, project: "Valemont", outreach: 2, counts: { qualified_conversation: 1 } });
    expect(s.calls[0].headers["x-valemont-idempotency-key"]).toBe(`summary-theo-${today}`);
  });

  it("feed: the founder's own events only, same shape as the push", async () => {
    const feed = await trackerFeed(repo, "theo", { from, to: today });
    expect(feed).toMatchObject({ source: "valemont-os", version: 1, founder: "theo", from, to: today });
    expect(feed.events).toHaveLength(3);
    expect(Object.keys(feed.events[0]).sort()).toEqual(["account", "channel", "duration_sec", "id", "local_date", "occurred_at", "outcome", "project", "type"]);
    expect(feed.events.some((e) => e.account === "Fontanería Gamma (test)")).toBe(false);
  });

  it("feed auth: bearer token compared in constant time; wrong or missing token → 401", async () => {
    expect(founderForFeedToken(null, ENV)).toBeNull();
    expect(founderForFeedToken("Bearer wrong-token-0123456789abcdef", ENV)).toBeNull();
    expect(founderForFeedToken(`Basic ${ENV.TRACKER_FEED_TOKEN_THEO}`, ENV)).toBeNull();
    expect(founderForFeedToken(`Bearer ${ENV.TRACKER_FEED_TOKEN_THEO}`, ENV)).toBe("theo");
    expect(founderForFeedToken("Bearer short", { TRACKER_FEED_TOKEN_PABLO: "short" })).toBeNull(); // too short = not configured
    const { GET } = await import("@/app/api/tracker/feed/route");
    const prev = process.env.TRACKER_FEED_TOKEN_THEO;
    process.env.TRACKER_FEED_TOKEN_THEO = ENV.TRACKER_FEED_TOKEN_THEO;
    try {
      expect((await GET(new NextRequest("http://localhost/api/tracker/feed"))).status).toBe(401);
      expect((await GET(new NextRequest("http://localhost/api/tracker/feed", { headers: { authorization: "Bearer nope-nope-nope-nope-nope-nope" } }))).status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.TRACKER_FEED_TOKEN_THEO;
      else process.env.TRACKER_FEED_TOKEN_THEO = prev;
    }
  });
});
