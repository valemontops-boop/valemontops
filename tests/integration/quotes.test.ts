import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import { ConflictError } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { RuleError } from "@/server/errors";
import { seedBaseline } from "@/server/services/baseline";
import { createAccount } from "@/server/services/crm";
import { savePolicy, priceBook } from "@/server/services/commercial";
import { saveAudit, startAudit, validateAudit } from "@/server/services/audits";
import {
  approveQuote, createQuote, dealWorkspace, decideQuote, markSent, newVersion, quoteForOpportunity, quotePdf, saveQuote, saveQuoteToDrive,
} from "@/server/services/quotes";
import { dedupeEvents } from "@/domain/activity";
import { FakeGoogleStore, MemoryDriveUploader } from "@/fake-google/store";
import { freshSheetsRepo } from "../helpers";

let fake: FakeSheetsServer;
let repo: DataRepository;
beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  repo = env.repo;
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => fake.stop());

const LEGAL: Record<string, string> = {
  legal_name: "Valemont Test SAS", legal_form: "SAS", address: "1 rue de l'Exemple, 75000 Paris", seller_country: "FR", company_id: "000 000 000", vat_number: "FR00000000000",
};
async function setLegal(skip: string[] = []) {
  for (const [key, value] of Object.entries(LEGAL)) if (!skip.includes(key)) await savePolicy(repo, "theo", { id: randomUUID(), key, value, effective_from: "2000-01-02", note: "" });
}
async function deal(country: "FR" | "ES" = "FR", brand: "local" | "consulting" = "local") {
  const id = randomUUID();
  await createAccount(repo, "theo", {
    id,
    account: { name: "Garage Exemple (test)", sector: "", niche: "Garages", country, city: "Lyon", website: "", phone: "", email: "", linkedin_url: "", lead_source: "", lead_type: null, brand: null, owner_founder: "theo", lead_status: "working", observed_problem: "", problem_evidence: "", language: "", notes: "" },
    contact: { full_name: "Alex Test", role: "", is_decision_maker: true, phone: "", email: "alex@example.com", linkedin_url: "", contact_type: "professional_named", language: "", lawful_basis: "", source: "" },
    opportunity: { name: "Garage Exemple", brand, market: country, stage: "qualified", owner_founder: "theo", value_eur: null, expected_close: "", next_action: "", next_action_due: "", next_action_priority: "normal" },
  });
  return (await repo.list("Opportunities", { fresh: true })).rows.find((o) => o.account_id === id)!;
}
type Q = Awaited<ReturnType<typeof dealWorkspace>>["quotes"][number];
const body = (q: Q, patch: Partial<Q> = {}) => {
  const v = { ...q, ...patch };
  return {
    language: v.language, valid_until: v.valid_until!, payment_terms: v.payment_terms, term_months: v.term_months, discount_bp: v.discount_bp, contingency_bp: v.contingency_bp,
    trade_recorded: v.trade_recorded, scope: v.scope, exclusions: v.exclusions, milestones: v.milestones, risks: v.risks, pilot_terms: v.pilot_terms, notes: v.notes,
  };
};

/** Text drawn in a pdf-lib document (content streams are deflated, strings hex-encoded). */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let s = m[1];
    try { s = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { /* not deflated */ }
    for (const h of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(h[1], "hex").toString("latin1").replace(/\x80/g, "€") + "\n"; // WinAnsi € = 0x80
  }
  return out;
}

describe("Stage 2A · scenario 6: audit and quote for Valemont Local", () => {
  it("490 € one-time + 99 €/month: first-year 1,678 € only with a 12-month term; adds nothing to revenue, cash or MRR", async () => {
    await setLegal();
    const opp = await deal("FR", "local");
    // Audit: start, answer (resumable), summary, validation.
    const auditId = randomUUID();
    const a = await startAudit(repo, "theo", { id: auditId, opportunity_id: opp.id, sector: "garage", complexity: "simple", language: null });
    expect(a.language).toBe("FR");
    expect((await startAudit(repo, "theo", { id: auditId, opportunity_id: opp.id, sector: "garage", complexity: "simple", language: null })).id).toBe(auditId);
    const saved = await saveAudit(repo, "theo", { id: auditId, expected_version: a.version, answers: { missed_calls: "12", budget: "Moins de 100 €" } });
    expect(saved.summary!.observed_problems.some((p) => p.draft)).toBe(true);
    await expect(saveAudit(repo, "pablo", { id: auditId, expected_version: a.version, answers: { missed_calls: "3" } })).rejects.toBeInstanceOf(ConflictError);
    const validated = await validateAudit(repo, "pablo", { id: auditId, expected_version: saved.version });
    expect(validated.validated_by).toBe("pablo");

    // Quote prefilled with Local at 100 €/month, no set-up fee.
    const qid = randomUUID();
    await createQuote(repo, "theo", { id: qid, opportunity_id: opp.id, audit_session_id: auditId });
    const ws = await dealWorkspace(repo, opp.id);
    let q = ws.quotes[0];
    expect(q.reference).toMatch(/^VAL-[0-9A-F]{8}-V1$/);
    expect(q.lines.map((l) => [l.billing, l.unit_price_minor])).toEqual([["monthly", 10_000]]);
    expect(q.scope).toContain("Rappel automatique");

    const local = ws.priceBook.find((i) => i.item_key === "local_essential")!;
    const lines = [
      { price_book_item_id: "", item_key: "", label: "Mise en place Valemont Local", billing: "one_time" as const, unit: "project" as const, quantity_x100: 100, unit_price_minor: 49_000, est_hours_x100: 300 },
      { price_book_item_id: local.id, item_key: local.item_key, label: local.name_fr, billing: "monthly" as const, unit: "month" as const, quantity_x100: 100, unit_price_minor: 9_900, direct_cost_minor: 3_700 },
    ];
    // No term → no first-year sum.
    await saveQuote(repo, "theo", { id: qid, expected_version: q.version, quote: body(q), lines: lines as never });
    q = (await dealWorkspace(repo, opp.id)).quotes[0];
    expect([q.totals.oneOffMinor, q.totals.mrrMinor, q.totals.firstYearMinor]).toEqual([49_000, 9_900, null]);
    // 6 months → still none.
    await saveQuote(repo, "theo", { id: qid, expected_version: q.version, quote: body(q, { term_months: 6 }), lines: lines as never });
    q = (await dealWorkspace(repo, opp.id)).quotes[0];
    expect(q.totals.firstYearMinor).toBeNull();
    // Explicit 12 months → 490 + 12 × 99 = 1,678 €.
    await saveQuote(repo, "theo", { id: qid, expected_version: q.version, quote: body(q, { term_months: 12 }), lines: lines as never });
    // A stale version is a visible conflict and changes nothing.
    await expect(saveQuote(repo, "pablo", { id: qid, expected_version: q.version, quote: body(q, { term_months: 3 }), lines: [] })).rejects.toBeInstanceOf(ConflictError);
    q = (await dealWorkspace(repo, opp.id)).quotes[0];
    expect([q.totals.oneOffMinor, q.totals.mrrMinor, q.totals.firstYearMinor, q.lines.length]).toEqual([49_000, 9_900, 167_800, 2]);
    expect(q.tax).toMatchObject({ ok: true, oneOffTaxMinor: 9_800, mrrTaxMinor: 1_980 });
    expect(q.check.requiresOtherFounder).toBe(false);

    // Approval inside the policy: the author may approve.
    await approveQuote(repo, "theo", { id: qid, expected_version: q.version });
    q = (await dealWorkspace(repo, opp.id)).quotes[0];
    expect(q.status).toBe("approved");
    await expect(saveQuote(repo, "theo", { id: qid, expected_version: q.version, quote: body(q), lines: lines as never })).rejects.toThrow(/new version/);

    // PDF shows one-off, MRR and the first-year value before taxes.
    const pdf = await quotePdf(repo, qid);
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    const text = pdfText(pdf.bytes);
    expect(text).toContain("490,00 €");
    expect(text).toContain("99,00 €");
    expect(text).toContain("1 678,00 €");
    expect(text).toContain("Valeur contractuelle de la première année HT");
    expect(text).toContain("Valemont Test SAS");

    // Sent by the founder: proposal_sent logged exactly once, even when retried.
    const s1 = await markSent(repo, "theo", { id: qid, expected_version: q.version });
    const s2 = await markSent(repo, "theo", { id: qid, expected_version: s1.quote.version });
    expect(s2.activity_duplicate).toBe(true);
    const events = dedupeEvents((await repo.list("ActivityEvents", { fresh: true })).rows).filter((e) => e.activity_type === "proposal_sent");
    expect(events).toHaveLength(1);
    expect(events[0].opportunity_id).toBe(opp.id);

    // Accepted: no cash, no revenue, no MRR, and the deal is not won until a founder says so.
    await decideQuote(repo, "pablo", { id: qid, expected_version: s1.quote.version, decision: "accepted", reason: "" });
    expect((await repo.list("BankTransactions", { fresh: true })).rows).toHaveLength(0);
    expect((await repo.list("RevenueSnapshots", { fresh: true })).rows).toHaveLength(0);
    expect((await repo.get("Opportunities", opp.id, { fresh: true }))!.stage).toBe("qualified");

    // Stage 2B reads the accepted quote.
    const forProject = await quoteForOpportunity(repo, opp.id);
    expect(forProject).toMatchObject({ oneOffMinor: 49_000, mrrMinor: 9_900, termMonths: 12 });
    expect(forProject!.services).toEqual([
      { label: "Mise en place Valemont Local", qty: 1, unit_minor: 49_000, kind: "one_off" },
      { label: local.name_fr, qty: 1, unit_minor: 9_900, kind: "monthly" },
    ]);
    expect(forProject!.estimatedDeliveryCost.monthlyMinor).toBe(4_070); // 37 € provision + 10 % contingency
  });
});

describe("Stage 2A · approvals, versions, taxes, required fields", () => {
  it("a discount beyond the policy needs the other founder and a recorded trade", async () => {
    await setLegal();
    const opp = await deal("FR", "local");
    const qid = randomUUID();
    await createQuote(repo, "theo", { id: qid, opportunity_id: opp.id, audit_session_id: "" });
    let q = (await dealWorkspace(repo, opp.id)).quotes[0];
    const l = q.lines[0];
    const discounted = [{ ...l, unit_price_minor: 8_000 }]; // 20 % below the 100 € list price
    await saveQuote(repo, "theo", { id: qid, expected_version: q.version, quote: body(q), lines: discounted as never });
    q = (await dealWorkspace(repo, opp.id)).quotes[0];
    expect(q.approval_required).toBe(true);
    await expect(approveQuote(repo, "theo", { id: qid, expected_version: q.version })).rejects.toThrow(/other founder/);
    await expect(approveQuote(repo, "pablo", { id: qid, expected_version: q.version })).rejects.toThrow(/trade/);
    await saveQuote(repo, "theo", { id: qid, expected_version: q.version, quote: body(q, { trade_recorded: "12-month commitment and a video testimonial" }), lines: discounted as never });
    q = (await dealWorkspace(repo, opp.id)).quotes[0];
    const approved = await approveQuote(repo, "pablo", { id: qid, expected_version: q.version });
    expect(approved.approvals).toEqual([expect.objectContaining({ founder: "pablo", with_other_founder: true, quote_version: 1 })]);
    // The browser cannot fake a list price: it comes from the price book.
    expect(q.lines[0].list_unit_price_minor).toBe(10_000);
  });

  it("editing an approved quote creates a new version; a retry finds the same version", async () => {
    await setLegal();
    const opp = await deal("FR", "consulting");
    const qid = randomUUID();
    await createQuote(repo, "theo", { id: qid, opportunity_id: opp.id, audit_session_id: "" });
    let q = (await dealWorkspace(repo, opp.id)).quotes[0];
    expect(q.lines[0]).toMatchObject({ billing: "one_time", unit_price_minor: 150_000, item_key: "consulting_mission" });
    await approveQuote(repo, "theo", { id: qid, expected_version: q.version });
    const v2 = await newVersion(repo, "pablo", { id: qid });
    expect((await newVersion(repo, "pablo", { id: qid })).id).toBe(v2.id);
    expect(v2).toMatchObject({ quote_version: 2, status: "draft", quote_group_id: qid });
    expect(v2.reference).toBe(q.reference.replace(/-V1$/, "-V2"));
    const ws = await dealWorkspace(repo, opp.id);
    expect(ws.quotes.map((x) => x.quote_version)).toEqual([2, 1]);
    expect(ws.quotes[0].lines).toHaveLength(1);
    expect(ws.quotes[1].superseded_by).toBe(v2.id);
    q = ws.quotes[0];
    await saveQuote(repo, "pablo", { id: v2.id, expected_version: q.version, quote: body(q), lines: [{ ...q.lines[0], unit_price_minor: 180_000 }] as never });
    expect((await dealWorkspace(repo, opp.id)).quotes[0].totals.oneOffMinor).toBe(180_000);
    expect((await dealWorkspace(repo, opp.id)).quotes[1].totals.oneOffMinor).toBe(150_000);
  });

  it("blocks a guessed cross-border VAT and names missing legal fields instead of printing placeholders", async () => {
    await setLegal(["company_id", "vat_number"]);
    const es = await deal("ES", "local");
    const qid = randomUUID();
    await createQuote(repo, "theo", { id: qid, opportunity_id: es.id, audit_session_id: "" });
    let q = (await dealWorkspace(repo, es.id)).quotes[0];
    expect(q.language).toBe("ES");
    expect(q.tax).toEqual({ ok: false, reason: "no_rule" });
    await expect(approveQuote(repo, "theo", { id: qid, expected_version: q.version })).rejects.toThrow(/Cross-border VAT is never guessed/);
    const err = await quotePdf(repo, qid).catch((e) => e as RuleError);
    expect(err).toBeInstanceOf(RuleError);
    expect((err as RuleError).details).toEqual(["company_id", "vat_number", "tax"]);
    // A founder-confirmed FR → ES rule unblocks it (written by a founder, never seeded in LIVE).
    await savePolicy(repo, "theo", { id: randomUUID(), key: "tax_rules", value: JSON.stringify([{ seller: "FR", client: "FR", label: "TVA", rate_bp: 2000, mention: "" }, { seller: "FR", client: "ES", label: "IVA", rate_bp: 0, mention: "Inversión del sujeto pasivo" }]), effective_from: "2000-01-02", note: "" });
    await setLegal();
    q = (await dealWorkspace(repo, es.id)).quotes[0];
    expect(q.tax.ok).toBe(true);
    const pdf = await quotePdf(repo, qid);
    const text = pdfText(pdf.bytes);
    expect(text).toContain("Presupuesto");
    expect(text).toContain("BORRADOR");
  });

  it("saves the approved PDF to Drive with the founder's own grant only", async () => {
    await setLegal();
    const opp = await deal("FR", "local");
    const qid = randomUUID();
    await createQuote(repo, "theo", { id: qid, opportunity_id: opp.id, audit_session_id: "" });
    const q = (await dealWorkspace(repo, opp.id)).quotes[0];
    await approveQuote(repo, "theo", { id: qid, expected_version: q.version });
    const store = new FakeGoogleStore();
    const ctx: AppContext = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: (f, g) => (g ? new MemoryDriveUploader(store, f) : null), mailerFor: () => null, baseUrl: "", mode: "demo" };
    await expect(saveQuoteToDrive(ctx, "theo", null, { id: qid })).rejects.toThrow(/permission/);
    const r = await saveQuoteToDrive(ctx, "theo", "grant", { id: qid });
    expect(r.duplicate).toBe(false);
    expect((await saveQuoteToDrive(ctx, "theo", "grant", { id: qid })).duplicate).toBe(true);
    expect(store.writes.filter((w) => w.kind === "drive.upload")).toHaveLength(1);
    expect((await repo.list("FilesIndex", { fresh: true })).rows.some((l) => l.record_id === opp.id && l.name.endsWith(".pdf"))).toBe(true);
  });

  it("price book edits are new versions by effective date", async () => {
    const before = (await priceBook(repo, "2026-11-09")).find((i) => i.item_key === "thirty_report")!;
    const { savePriceItem } = await import("@/server/services/commercial");
    const { item_key, kind, brand, name_fr, name_es, unit, price_mode, one_time_hours_x100, monthly_hours_x100, one_time_cost_minor, monthly_cost_minor, pilot_assumption, limits, notes, monthly_min_minor, monthly_max_minor, active } = before;
    const rest = { item_key, kind, brand, name_fr, name_es, unit, price_mode, one_time_hours_x100, monthly_hours_x100, one_time_cost_minor, monthly_cost_minor, pilot_assumption, limits, notes, monthly_min_minor, monthly_max_minor, active };
    await savePriceItem(repo, "pablo", { ...rest, price_setting_key: "", id: randomUUID(), effective_from: "2027-01-01", one_time_min_minor: 4_900, one_time_max_minor: 4_900 });
    expect((await priceBook(repo, "2026-11-09")).find((i) => i.item_key === "thirty_report")!.list_one_time_minor).toBe(3_900);
    const after = (await priceBook(repo, "2027-01-02")).find((i) => i.item_key === "thirty_report")!;
    expect([after.list_one_time_minor, after.versions]).toEqual([4_900, 2]);
  });
});
