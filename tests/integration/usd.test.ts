import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import type { BankPort } from "@/data/bank/wise";
import { mapStatement, WiseAdapter } from "@/data/bank/wise";
import { MemoryBank, FakeWiseStore } from "@/fake-wise/store";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { addCost, assignContractor, deliveryOverview, linkCost, wonToProject } from "@/server/services/delivery";
import { createVendor, partnersOverview } from "@/server/services/partners";
import { addEntry, entrySchema, financeOverview } from "@/server/services/finance";
import { syncBank } from "@/server/services/bank";
import { _testUsd, currentUsdRate, saveManualRate } from "@/server/services/usd-rates";
import { integrationStatusId } from "@/server/services/integration-status";
import { localDate } from "@/domain/time";
import { freshSheetsRepo } from "../helpers";

/** D085: USD only to pay contractors — rate from the Wise payment, else Wise today (cached once a day), else manual. */
let fake: FakeSheetsServer;
let repo: DataRepository;
const today = localDate(new Date(), "Europe/Paris");
const ctxOf = (r: DataRepository, mode: "live" | "demo" = "demo", bank: BankPort | null = null): AppContext => ({ repo: r, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode, bank });

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  repo = env.repo;
  _testUsd.reset();
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => { await fake.stop(); vi.restoreAllMocks(); });

async function project(ctx: AppContext) {
  const accountId = randomUUID(), oppId = randomUUID();
  await repo.insert("Accounts", [{ id: accountId, name: "Garage Dollar (test)", sector: "", niche: "Garages", country: "FR", city: "", website: "", domain_normalized: "", phone: "+33100000998", email: "", linkedin_url: "", lead_source: "test", lead_type: "outbound", brand: "consulting", owner_founder: "theo", lead_status: "working", observed_problem: "", problem_evidence: "", language: "fr", notes: "", import_batch_id: "" }], { founder: "theo" });
  await repo.insert("Opportunities", [{ id: oppId, account_id: accountId, primary_contact_id: "", name: "Garage Dollar", brand: "consulting", market: "FR", stage: "won", owner_founder: "theo", value_minor: 150000, currency: "EUR", expected_close: null, next_action: "", next_action_due: null, next_action_priority: "normal", next_action_reason: "", lost_reason: "", anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "" }], { founder: "theo" });
  await wonToProject(ctx, "theo", { opportunity_id: oppId, start_date: today, owner_founder: "theo", promised: "", stakeholders: "", success: "" });
  return (await deliveryOverview(ctx, "theo")).projects[0];
}
async function usdVendor(ctx: AppContext) {
  const id = randomUUID();
  await createVendor(ctx, "theo", { id, vendor: { name: "Sam Example (test)", company: "", skills: ["api"], services: "", timezone: "America/New_York", country: "US", currency: "USD", hourly_rate_eur: 40, daily_rate_eur: null, fixed_rate_eur: null, capacity_hours_week: 20, availability: "available", response_sla_hours: null, nda_status: "signed", contract_status: "signed", rate_valid_until: "", contact_email: "sam@example.com", contact_phone: "", notes: "", quality_feedback: "" } });
  return id;
}
const usdEntry = (p: Record<string, unknown> = {}) => entrySchema.parse({ id: randomUUID(), date: today, kind: "expense", category: "contractors", cost_center: "consulting", currency: "USD", amount_minor: 120000, counterparty: "Example Dev LLC (test)", ...p });

/** A Wise store with one USD transfer paid from the EUR balance: 326 $ sent, 300 € debited. */
function wiseWithUsdPayment() {
  const s = new FakeWiseStore();
  s.balances.push({ id: "eur-1", currency: "EUR", amount_minor: 100000, name: "" });
  s.addTx("eur-1", { referenceNumber: "TRANSFER-777", direction: "debit", occurred_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), amount_minor: -30000, currency: "EUR", fee_minor: 0, description: "Sent money to Example Dev LLC (test)", counterparty: "Example Dev LLC (test)", detailsType: "TRANSFER", merchantCategory: "", fx_currency: "USD", fx_amount_minor: 32600 });
  return s;
}

describe("USD contractor → project cost in EUR", () => {
  it("converts a USD assignment with the manual rate, and leaves it out of EUR totals while no rate exists", async () => {
    const ctx = ctxOf(repo);
    const p0 = await project(ctx);
    const vendor = await usdVendor(ctx);
    const r = await assignContractor(ctx, "theo", { id: randomUUID(), project_id: p0.id, vendor_id: vendor, role: "API", rate_eur: 40, rate_unit: "hour", planned_hours: 10, start_date: "", end_date: "", note: "" });
    expect(r.duplicate).toBe(false);
    expect((await repo.list("ProjectAssignments", { fresh: true })).rows[0].currency).toBe("USD"); // from the contractor

    // No Wise, no manual rate, no demo rate: 400 $ is "rate missing", not counted in EUR.
    let p = (await deliveryOverview(ctx, "theo")).projects[0];
    expect(p.estimate).toMatchObject({ contractors: 0, missing: 1, missing_usd_minor: 40000 });
    expect(p.assignments[0]).toMatchObject({ rate_eur_minor: null, fx_rate: null });

    await saveManualRate(ctx, "theo", { rate: "0,92", date: today, expected_version: 0 });
    p = (await deliveryOverview(ctx, "theo")).projects[0];
    expect(p.estimate).toMatchObject({ founder: 60000, contractors: 36800, total: 96800, missing: 0 }); // 400 $ × 0.92
    expect(p.assignments[0]).toMatchObject({ rate_eur_minor: 3680, fx_rate: { micro: 920_000, source: "manual", date: today } });
    expect(p.margin.margin).toBe(150000 - 96800);
    const partners = await partnersOverview(ctx, "theo");
    expect(partners.vendors[0].eur).toEqual({ hourly: 3680, daily: null, fixed: null });

    // The manual rate is a versioned setting: a stale form gets a 409.
    await expect(saveManualRate(ctx, "pablo", { rate: "0,95", date: today, expected_version: 0 })).rejects.toMatchObject({ code: "conflict" });
  });

  it("a USD cost linked to the Wise payment uses its real rate (bank > Wise today > manual)", async () => {
    const ctx = ctxOf(repo, "demo", new MemoryBank(wiseWithUsdPayment()));
    await syncBank(ctx);
    const tx = (await repo.list("BankTransactions", { fresh: true })).rows[0];
    expect(tx).toMatchObject({ currency: "EUR", amount_minor: -30000, fx_currency: "USD", fx_amount_minor: 32600 });
    await saveManualRate(ctx, "theo", { rate: "0.95", date: today, expected_version: 0 });
    const p0 = await project(ctx);
    const costId = randomUUID();
    await addCost(ctx, "theo", { id: costId, project_id: p0.id, date: today, kind: "contractor", label: "Maquettes", amount_eur: 326, currency: "USD", tool_id: "" });
    let p = (await deliveryOverview(ctx, "theo")).projects[0];
    expect(p.costs[0]).toMatchObject({ eur_minor: 30970, fx_rate: { source: "manual" } }); // estimate at the manual rate
    expect(p.actual.direct).toBe(30970);
    const c = (await repo.get("ProjectCosts", costId, { fresh: true }))!;
    await linkCost(ctx, "theo", { id: costId, expected_version: c.version, wise_tx_id: tx.id });
    p = (await deliveryOverview(ctx, "theo")).projects[0];
    expect(p.costs[0]).toMatchObject({ eur_minor: 30000, fx_rate: { source: "bank", micro: 920_245 } }); // the EUR actually debited
    expect(p.actual.direct).toBe(30000);
    await expect(linkCost(ctx, "theo", { id: costId, expected_version: c.version, wise_tx_id: "" })).rejects.toMatchObject({ code: "conflict" });
    // An EUR cost cannot borrow a payment's rate.
    await expect(addCost(ctx, "theo", { id: randomUUID(), project_id: p0.id, date: today, kind: "other", label: "x", amount_eur: 1, currency: "EUR", wise_tx_id: tx.id, tool_id: "" })).rejects.toThrow(/Only a USD cost/);
  });
});

describe("USD manual entry in Money", () => {
  it("locks rate, date, source and EUR amounts at entry; P&L totals stay EUR", async () => {
    const ctx = ctxOf(repo);
    await saveManualRate(ctx, "theo", { rate: "0,92", date: today, expected_version: 0 });
    const e = await addEntry(ctx, "theo", usdEntry());
    expect(e).toMatchObject({ currency: "USD", amount_minor: -120000, fx_rate: "0.92", fx_date: today, fx_source: "manual", eur_minor: -110400 });
    // Changing the manual rate later does not restate a locked entry.
    const v = (await repo.get("SystemSettings", (await repo.list("SystemSettings", { fresh: true })).rows.find((r) => r.key === "usd_eur_rate_manual")!.id, { fresh: true }))!.version;
    await saveManualRate(ctx, "theo", { rate: "0,99", date: today, expected_version: v });
    const f = await financeOverview(ctx, "theo");
    const it = f.items.find((i) => i.id === e.id)!;
    expect(it).toMatchObject({ eur_gross: -110400, rate_missing: false, fx: { micro: 920_000, source: "manual" } });
    expect(f.pnl.at(-1)!.direct).toBe(110400);
    expect(f.usd_missing.count).toBe(0);
    // USD is for paying suppliers only.
    expect(entrySchema.safeParse({ ...usdEntry(), kind: "income", category: "revenue" }).success).toBe(false);
  });

  it("without any rate the entry stays in USD, marked rate missing, out of EUR totals (never an invented rate)", async () => {
    const ctx = ctxOf(repo);
    const e = await addEntry(ctx, "theo", usdEntry());
    expect(e).toMatchObject({ fx_rate: "", fx_source: "", eur_minor: 0 });
    const f = await financeOverview(ctx, "theo");
    expect(f.items.find((i) => i.id === e.id)).toMatchObject({ eur_gross: null, rate_missing: true });
    expect(f.pnl.at(-1)!.direct).toBe(0);
    expect(f.usd_missing).toEqual({ count: 1, usd_minor: 120000 });
    expect(f.non_eur).toBe(0); // counted as "rate missing", not as an unconverted foreign movement
  });

  it("takes the real rate of a linked Wise payment", async () => {
    const ctx = ctxOf(repo, "demo", new MemoryBank(wiseWithUsdPayment()));
    await syncBank(ctx);
    const tx = (await repo.list("BankTransactions", { fresh: true })).rows[0];
    const e = await addEntry(ctx, "theo", usdEntry({ amount_minor: 32600, wise_tx_id: tx.id }));
    expect(e).toMatchObject({ fx_source: "bank", fx_rate: "0.920245", eur_minor: -30000, wise_tx_id: tx.id });
  });
});

describe("Wise rate of the day (LIVE): cached once per day, manual fallback on failure", () => {
  it("fetches GET /v1/rates once per day and stores it in UsdRates", async () => {
    const rate = vi.fn(async () => ({ rate: 0.9213, time: new Date().toISOString() }));
    const ctx = ctxOf(repo, "live", { profileId: async () => "p", balances: async () => [], statement: async () => [], rate });
    await saveManualRate(ctx, "theo", { rate: "0,90", date: today, expected_version: 0 });
    const a = await currentUsdRate(ctx, today);
    const b = await currentUsdRate(ctx, today);
    expect(rate).toHaveBeenCalledTimes(1);
    expect(rate).toHaveBeenCalledWith("USD", "EUR");
    expect(a.rate).toEqual({ micro: 921_300, date: today, source: "wise" }); // Wise beats the manual rate
    expect(b.rate).toEqual(a.rate);
    const rows = (await repo.list("UsdRates", { fresh: true })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: today, rate: "0.9213", source: "wise" });
    // A new day asks Wise again.
    await currentUsdRate(ctx, "2099-01-01");
    expect(rate).toHaveBeenCalledTimes(2);
  });

  it("on failure uses the manual rate, records the error and does not hammer Wise", async () => {
    const rate = vi.fn(async () => { throw new Error("Wise returned 503"); });
    const ctx = ctxOf(repo, "live", { profileId: async () => "p", balances: async () => [], statement: async () => [], rate });
    await saveManualRate(ctx, "theo", { rate: "0,91", date: "2026-11-01", expected_version: 0 });
    const a = await currentUsdRate(ctx, today);
    expect(a).toMatchObject({ rate: { micro: 910_000, date: "2026-11-01", source: "manual" }, wise_status: "failed" });
    await currentUsdRate(ctx, today);
    expect(rate).toHaveBeenCalledTimes(1); // retried at most hourly
    expect(await repo.get("IntegrationStatuses", integrationStatusId("wise_rates"), { fresh: true })).toMatchObject({ status: "error", last_error: "Wise returned 503" });
    expect((await repo.list("UsdRates", { fresh: true })).rows).toHaveLength(0);
  });

  it("without a Wise token and without a manual rate there is no rate at all", async () => {
    const r = await currentUsdRate(ctxOf(repo, "live", null), today);
    expect(r).toMatchObject({ rate: null, wise_status: "not_configured" });
  });
});

describe("Wise adapter (read-only token)", () => {
  it("reads GET /v1/rates?source=USD&target=EUR with the bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ rate: 0.9187, source: "USD", target: "EUR", time: "2026-11-09T10:00:00+0000" }]), { status: 200, headers: { "content-type": "application/json" } }));
    const w = new WiseAdapter("https://wise.example.com", "token-example", null, "1");
    expect(await w.rate("USD", "EUR")).toEqual({ rate: 0.9187, time: "2026-11-09T10:00:00+0000" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://wise.example.com/v1/rates?source=USD&target=EUR");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-example");
  });
  it("keeps the USD side of a payment from the statement's exchange details", () => {
    const [t] = mapStatement({ transactions: [{ type: "DEBIT", date: "2026-11-02T10:00:00Z", amount: { value: -300, currency: "EUR" }, referenceNumber: "TRANSFER-1", details: { type: "TRANSFER", description: "Sent money" }, exchangeDetails: { forAmount: { value: 326, currency: "USD" }, rate: 1.08667 } }] });
    expect(t).toMatchObject({ amount_minor: -30000, currency: "EUR", fx_currency: "USD", fx_amount_minor: 32600 });
    const [u] = mapStatement({ transactions: [{ type: "DEBIT", amount: { value: -20, currency: "EUR" }, referenceNumber: "CARD-1", details: { type: "CARD" } }] });
    expect(u).toMatchObject({ fx_currency: "", fx_amount_minor: null });
  });
});
