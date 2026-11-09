import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryRepository } from "@/data/memory";
import type { DataRepository } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { signJob } from "@/server/job-auth";
import { handleWebsiteWebhook, websiteLimiter } from "@/server/website-webhook";
import { rateLimiter } from "@/server/rate-limit";
import { submissionId } from "@/server/services/website-leads";
import { listInbox } from "@/server/services/inbox";
import { websiteLeadSchema } from "@/domain/website-lead";
import { POST as websitePOST } from "@/app/api/webhooks/website/route";
import { freshSheetsRepo } from "../helpers";

const SECRET = "website-test-secret-0123456789abcdef";
const ctxOf = (repo: DataRepository): AppContext => ({ repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "live" });
const lead = (p: Record<string, unknown> = {}) => ({
  event_id: "evt-0001-website", site: "valemont", form_type: "contact", language: "fr", name: "Claire Dupont", company: "Boulangerie Exemple (test)",
  email: "claire@boulangerie-exemple.example.com", phone: "06 12 34 56 78", website: "https://boulangerie-exemple.example.com", message: "=Bonjour, combien pour un site ?",
  utm: { source: "google", medium: "cpc", campaign: "fr-boulangeries" }, consent: { marketing: true, text: "J'accepte d'être recontacté.", version: "2026-11" }, elapsed_ms: 12_000, ...p,
});

let repo: DataRepository;
let ctx: AppContext;
const now = Date.parse("2026-11-09T10:00:00Z");
async function call(body: unknown, opts: { ts?: number; secret?: string; ip?: string; sig?: string | null; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const s = signJob(raw, opts.secret ?? SECRET, opts.ts ?? now);
  return handleWebsiteWebhook({ raw, contentLength: raw.length, timestamp: s.ts, signature: opts.sig === undefined ? s.sig : opts.sig, ip: opts.ip ?? "203.0.113.1", secret: SECRET, getCtx: async () => ctx, now });
}

beforeEach(async () => {
  websiteLimiter.reset();
  repo = new InMemoryRepository();
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  ctx = ctxOf(repo);
});

describe("website webhook: authentication (spec 7, 12)", () => {
  it("refuses everything when WEBSITE_WEBHOOK_SECRET is not set", async () => {
    const r = await handleWebsiteWebhook({ raw: "{}", contentLength: 2, timestamp: null, signature: null, ip: "x", secret: undefined, getCtx: async () => ctx, now });
    expect(r.status).toBe(503);
  });
  it("accepts a valid signature and refuses a malformed, wrong, expired or future one before touching storage", async () => {
    let touched = 0;
    const spy = async () => { touched++; return ctx; };
    const raw = JSON.stringify(lead());
    const base = { raw, contentLength: raw.length, ip: "203.0.113.2", secret: SECRET, getCtx: spy, now };
    const good = signJob(raw, SECRET, now);
    expect((await handleWebsiteWebhook({ ...base, timestamp: good.ts, signature: "sha256=zz" })).body.error).toBe("bad_signature");
    expect((await handleWebsiteWebhook({ ...base, timestamp: good.ts, signature: null })).body.error).toBe("bad_signature");
    expect((await handleWebsiteWebhook({ ...base, timestamp: good.ts, signature: signJob(raw, "another-secret-0123456789abcdef", now).sig })).status).toBe(401);
    expect((await handleWebsiteWebhook({ ...base, raw: raw + " ", timestamp: good.ts, signature: good.sig })).status).toBe(401); // body changed
    const old = signJob(raw, SECRET, now - 6 * 60_000);
    expect((await handleWebsiteWebhook({ ...base, timestamp: old.ts, signature: old.sig })).body.error).toBe("stale_timestamp");
    const future = signJob(raw, SECRET, now + 6 * 60_000);
    expect((await handleWebsiteWebhook({ ...base, timestamp: future.ts, signature: future.sig })).status).toBe(401);
    expect((await handleWebsiteWebhook({ ...base, timestamp: "abc", signature: good.sig })).status).toBe(401);
    expect(touched).toBe(0);
    const ok = await handleWebsiteWebhook({ ...base, timestamp: good.ts, signature: good.sig });
    expect(ok).toMatchObject({ status: 200, body: { ok: true, status: "created" } });
    expect(touched).toBe(1);
  });
  it("rejects malformed JSON, an invalid payload and an oversized body", async () => {
    expect((await call(null, { raw: "{not json" })).status).toBe(400);
    const bad = await call(lead({ email: "", phone: "" }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("validation_error");
    expect((await call(lead({ event_id: "x" }))).status).toBe(400);
    expect((await call(null, { raw: JSON.stringify(lead({ message: "a".repeat(40_000) })) })).status).toBe(413);
  });
  it("the Next route reads the signed headers and answers the same way", async () => {
    process.env.WEBSITE_WEBHOOK_SECRET = SECRET;
    const raw = JSON.stringify(lead());
    const res = await websitePOST(new NextRequest("https://app.example.com/api/webhooks/website", { method: "POST", body: raw, headers: { "x-valemont-timestamp": signJob(raw, SECRET).ts, "x-valemont-signature": "sha256=" + "0".repeat(64), "x-forwarded-for": "198.51.100.7" } }));
    expect(res.status).toBe(401);
    delete process.env.WEBSITE_WEBHOOK_SECRET;
    expect((await websitePOST(new NextRequest("https://app.example.com/api/webhooks/website", { method: "POST", body: raw }))).status).toBe(503);
  });
});

describe("website webhook: abuse limits", () => {
  it("rate-limits per IP (20 per minute) and lets other IPs through", async () => {
    for (let i = 0; i < 20; i++) expect((await call(null, { raw: "{}", sig: null, ip: "203.0.113.9" })).status).toBe(401);
    const limited = await call(null, { raw: "{}", sig: null, ip: "203.0.113.9" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers?.["retry-after"])).toBeGreaterThan(0);
    expect((await call(null, { raw: "{}", sig: null, ip: "203.0.113.10" })).status).toBe(401);
  });
  it("the limiter opens a new window after a minute and stays bounded in size", () => {
    const rl = rateLimiter({ limit: 2, windowMs: 60_000, maxKeys: 3 });
    expect([rl.hit("a", 0).ok, rl.hit("a", 1).ok, rl.hit("a", 2).ok]).toEqual([true, true, false]);
    expect(rl.hit("a", 60_001).ok).toBe(true);
    for (const k of ["b", "c", "d", "e"]) rl.hit(k, 60_002);
    expect(rl.hit("e", 60_003).ok).toBe(true);
  });
  it("drops honeypot and too-fast submissions without storing anything", async () => {
    expect((await call(lead({ honeypot: "http://spam.example.com" }))).body).toEqual({ ok: true, status: "ignored" });
    expect((await call(lead({ event_id: "evt-fast-0001", elapsed_ms: 300 }))).body.status).toBe("ignored");
    const t = await repo.listMany(["Accounts", "WebsiteSubmissions", "InboxItems"], { fresh: true });
    expect(t.Accounts.rows.filter((a) => a.lead_source === "website")).toHaveLength(0);
    expect(t.WebsiteSubmissions.rows).toHaveLength(0);
  });
});

describe("website webhook: lead creation, idempotency, suppression, consent", () => {
  it("creates an inbound account, a contact, one item to reply to and the submission with UTM and consent", async () => {
    expect((await call(lead())).body.status).toBe("created");
    const t = await repo.listMany(["Accounts", "Contacts", "InboxItems", "WebsiteSubmissions"], { fresh: true });
    const acc = t.Accounts.rows.find((a) => a.lead_source === "website")!;
    expect(acc).toMatchObject({ name: "Boulangerie Exemple (test)", lead_type: "inbound", brand: "consulting", country: "FR", owner_founder: "theo", lead_status: "new", domain_normalized: "boulangerie-exemple.example.com" });
    const c = t.Contacts.rows.find((x) => x.account_id === acc.id)!;
    expect(c).toMatchObject({ full_name: "Claire Dupont", consent_status: "consented", source: "website" });
    expect(c.lawful_basis).toContain("2026-11");
    const sub = t.WebsiteSubmissions.rows[0];
    expect(sub).toMatchObject({ id: submissionId("evt-0001-website"), outcome: "created", form_type: "contact", language: "FR", utm_source: "google", utm_medium: "cpc", utm_campaign: "fr-boulangeries", consent_marketing: true, consent_version: "2026-11", account_id: acc.id, contact_id: c.id });
    expect(t.InboxItems.rows).toHaveLength(1);
    expect(t.InboxItems.rows[0]).toMatchObject({ source: "website_form", status: "to_reply", assigned_founder: "theo", account_label: "Website Valemont" });
    // Leading "=" kept as typed (values are written RAW; never stripped).
    expect(t.InboxItems.rows[0].excerpt).toBe("[contact] =Bonjour, combien pour un site ?");
    // The derived "new website lead" item and the stored one are the same item: shown once.
    const inbox = await listInbox(ctx, "theo", { scope: "team" });
    expect(inbox.items.filter((i) => i.source === "website_form")).toHaveLength(1);
  });
  it("a replayed or retried event adds nothing (idempotency by event id)", async () => {
    await call(lead());
    const again = await call(lead(), { ts: now + 30_000 });
    expect(again.body.status).toBe("duplicate");
    const t = await repo.listMany(["Accounts", "Contacts", "InboxItems", "WebsiteSubmissions"], { fresh: true });
    expect(t.Accounts.rows.filter((a) => a.lead_source === "website")).toHaveLength(1);
    expect(t.Contacts.rows.filter((c) => c.source === "website")).toHaveLength(1);
    expect(t.InboxItems.rows).toHaveLength(1);
    expect(t.WebsiteSubmissions.rows).toHaveLength(1);
  });
  it("a second form from the same business matches it (no new account) and fills blanks only", async () => {
    await call(lead());
    const r = await call(lead({ event_id: "evt-0002-website", form_type: "booking", booking_slot: "mardi 10 h", name: "Claire Dupont", phone: "", consent: { marketing: false } }));
    expect(r.body.status).toBe("matched");
    const t = await repo.listMany(["Accounts", "InboxItems", "WebsiteSubmissions"], { fresh: true });
    expect(t.Accounts.rows.filter((a) => a.lead_source === "website")).toHaveLength(1);
    expect(t.InboxItems.rows).toHaveLength(2);
    expect(t.InboxItems.rows.find((i) => i.external_id === "website:evt-0002-website")!.excerpt).toContain("[booking: mardi 10 h]");
    expect(t.WebsiteSubmissions.rows.map((s) => s.outcome).sort()).toEqual(["created", "matched"]);
  });
  it("Spanish 30/30 form: brand thirty, owner Pablo; no consent box → basis is the visitor's request", async () => {
    await call(lead({ event_id: "evt-es-000001", site: "thirty", language: "es", company: "", name: "Lucía Ejemplo", email: "lucia@correo-ejemplo.example.com", phone: "", website: "", consent: { marketing: false } }));
    const t = await repo.listMany(["Accounts", "Contacts"], { fresh: true });
    const acc = t.Accounts.rows.find((a) => a.lead_source === "website")!;
    expect(acc).toMatchObject({ name: "Lucía Ejemplo", brand: "thirty", country: "ES", owner_founder: "pablo", language: "es" });
    expect(t.Contacts.rows.find((c) => c.account_id === acc.id)).toMatchObject({ consent_status: "unknown", lawful_basis: "Request sent through the website form (reply to it)" });
  });
  it("suppression is a hard block: nothing created or updated, no item to reply to, the submission is kept as suppressed", async () => {
    await repo.insert("SuppressionList", [{ id: "11111111-1111-4111-8111-111111111111", kind: "email", value_normalized: "claire@boulangerie-exemple.example.com", contact_id: "", account_id: "", reason: "Asked to stop", added_by: "theo" }], { founder: "theo" });
    const r = await call(lead());
    expect(r.body.status).toBe("suppressed");
    const t = await repo.listMany(["Accounts", "Contacts", "InboxItems", "WebsiteSubmissions"], { fresh: true });
    expect(t.Accounts.rows.filter((a) => a.lead_source === "website")).toHaveLength(0);
    expect(t.Contacts.rows.filter((c) => c.source === "website")).toHaveLength(0);
    expect(t.InboxItems.rows).toHaveLength(0);
    expect(t.WebsiteSubmissions.rows[0]).toMatchObject({ outcome: "suppressed" });
  });
  it("an opted-out contact who fills the form again is not re-activated", async () => {
    await call(lead());
    const c = (await repo.list("Contacts", { fresh: true })).rows.find((x) => x.source === "website")!;
    await repo.update("Contacts", c.id, c.version, { consent_status: "opted_out" }, { founder: "theo" });
    const r = await call(lead({ event_id: "evt-0003-website" }));
    expect(r.body.status).toBe("suppressed");
    expect((await repo.get("Contacts", c.id, { fresh: true }))!.consent_status).toBe("opted_out");
  });
  it("parses language, country and UTM leniently and keeps + - = @ in text", () => {
    const v = websiteLeadSchema.parse(lead({ language: "es-ES", country: "España", name: "+Pedro", utm: { source: "@ig" } }));
    expect(v).toMatchObject({ language: "ES", country: "ES", name: "+Pedro", utm: { source: "@ig" } });
    expect(websiteLeadSchema.parse(lead({ page_url: "javascript:alert(1)" })).page_url).toBe("");
  });
});

describe("website webhook on the Google Sheets adapter (fake server)", () => {
  const stops: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const s of stops) await s(); });
  it("stores the submission in the WebsiteSubmissions tab and stays idempotent across a fresh repository", async () => {
    const env = await freshSheetsRepo();
    stops.push(() => env.fake.stop());
    await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
    ctx = ctxOf(env.repo);
    expect((await call(lead())).body.status).toBe("created");
    const { makeRepo } = await import("../helpers");
    ctx = ctxOf(makeRepo(env.url)); // another server instance
    expect((await call(lead(), { ts: now + 1_000 })).body.status).toBe("duplicate");
    const rows = (await ctx.repo.list("WebsiteSubmissions", { fresh: true })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ utm_campaign: "fr-boulangeries", consent_marketing: true });
  });
});
