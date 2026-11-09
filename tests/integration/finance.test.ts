import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { InMemoryRepository } from "@/data/memory";
import { ConflictError, type DataRepository } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { seedDemo } from "@/server/services/demo-seed";
import { addEntry, contractsFromProjects, createContract, financeOverview, reverseEntry, saveAllocation, setEcbFetcher, usdView } from "@/server/services/finance";
import { moneyOverview } from "@/server/services/bank";
import { childId } from "@/lib/ids";
import { addDays, localDate } from "@/domain/time";
import { RuleError } from "@/server/errors";
import { freshSheetsRepo, uuid } from "../helpers";

let fake: FakeSheetsServer | null = null;
let repo: DataRepository;
let ctx: AppContext;
const today = localDate(new Date(), "Europe/Paris");
const month = today.slice(0, 7);
const first = `${month}-01`;
const prevMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const lastOfMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const mkCtx = (r: DataRepository, mode: "live" | "demo" = "demo"): AppContext => ({ repo: r, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode });
const entry = (p: Record<string, unknown>) => ({ id: uuid(), date: first, kind: "income" as const, category: "revenue" as const, cost_center: "local" as const, cost_class: "" as const, currency: "EUR", amount_minor: 9900, vat_minor: 0, counterparty: "Client (test)", reference: "", receipt_url: "", project_id: "", contract_id: "", service_from: null, service_to: null, note: "", manual_rate: "", ...p });

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  repo = env.repo;
  ctx = mkCtx(repo);
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => { await fake?.stop(); fake = null; });

async function subscription(setup = 0) {
  return createContract(ctx, "theo", { id: uuid(), name: "Abonnement Local (test)", client_id: "", project_id: "", cost_center: "local", kind: "subscription", currency: "EUR", setup_minor: setup, one_off_minor: 0, recurring_minor: 9900, billing_months: 1, start_date: first, end_date: null, notes: "" });
}

describe("Scenario 8: cash vs recognized revenue, MRR, ARR, provisional EBITDA (fake Sheets)", () => {
  it("EUR 99 subscription + EUR 12 expense + EUR 39 30/30 sale", async () => {
    const c = await subscription();
    await addEntry(ctx, "theo", entry({ contract_id: c.id, service_from: first, service_to: lastOfMonth }));
    await addEntry(ctx, "theo", entry({ kind: "expense", category: "software", cost_center: "shared", amount_minor: 1200, date: first }));
    await addEntry(ctx, "pablo", entry({ cost_center: "thirty", amount_minor: 3900, counterparty: "Acheteur (test)" }));
    const f = await financeOverview(mkCtx(repo), "theo");
    const m = f.pnl.at(-1)!;
    expect(f.numbers.mrr).toMatchObject({ value: 9900, source: "contracts" });
    expect(f.numbers.arr).toBe(118800);
    expect(m.cash_in).toBe(13800);
    expect(m.revenue.total).toBe(13800);
    expect(m.revenue).toMatchObject({ local: 9900, thirty: 3900 });
    expect(m.opex).toBe(1200);
    expect(m.ebitda).toBe(12600);
    expect(m.provisional).toBe(true); // the 30/30 sale has no service period: invoice-based estimate
    expect(f.numbers).toMatchObject({ revenue_month: 13800, ebitda_month: 12600, provisional: true });
  });
  it("with 20% VAT on the subscription, cash rises by 19.80 and revenue is unchanged", async () => {
    const c = await subscription();
    await addEntry(ctx, "theo", entry({ contract_id: c.id, vat_minor: 1980, service_from: first, service_to: lastOfMonth }));
    const m = (await financeOverview(ctx, "theo")).pnl.at(-1)!;
    expect(m.cash_in).toBe(11880);
    expect(m.revenue.total).toBe(9900);
    expect(m.vat_in).toBe(1980);
  });
  it("with a service period split across two months, revenue splits and cash does not", async () => {
    const c = await subscription();
    await addEntry(ctx, "theo", entry({ contract_id: c.id, date: `${prevMonth}-15`, service_from: `${prevMonth}-15`, service_to: addDays(`${month}-15`, -1) }));
    const f = await financeOverview(ctx, "theo");
    const [p, m] = f.pnl.slice(-2);
    expect(p.cash_in).toBe(9900);
    expect(m.cash_in).toBe(0);
    expect(p.revenue.total).toBeGreaterThan(0);
    expect(m.revenue.total).toBeGreaterThan(0);
    expect(p.revenue.total + m.revenue.total).toBe(9900);
  });
  it("a set-up fee never changes MRR", async () => {
    const c = await subscription(49000);
    await addEntry(ctx, "theo", entry({ contract_id: c.id, amount_minor: 49000, note: "Set-up (test)" }));
    expect((await financeOverview(ctx, "theo")).numbers.mrr.value).toBe(9900);
  });
  it("history is corrected by a reversing entry, never erased; reversing twice adds nothing", async () => {
    const e = await addEntry(ctx, "theo", entry({ kind: "expense", category: "travel", cost_center: "shared", amount_minor: 6400 }));
    expect((await addEntry(ctx, "theo", entry({ id: e.id, kind: "expense", category: "travel", cost_center: "shared", amount_minor: 6400 }))).id).toBe(e.id); // retry with the same id
    await reverseEntry(ctx, "theo", { id: e.id, note: "" });
    await reverseEntry(ctx, "theo", { id: e.id, note: "" });
    const rows = (await repo.list("LedgerEntries", { fresh: true })).rows;
    expect(rows).toHaveLength(2);
    expect((await financeOverview(ctx, "theo")).pnl.at(-1)!.opex).toBe(0);
  });
});

describe("Scenario 9: EUR/USD with a labelled 1.1000 fixture", () => {
  beforeEach(async () => {
    await repo.insert("FxRates", [{ id: childId("fx", "demo", "USD", first), base: "EUR", quote: "USD", rate: "1.1000", rate_date: first, source: "demo", fetched_at: new Date().toISOString() }], { founder: "system" });
  });
  it("EUR 99.00 displays USD 108.90 with the rate date; stored 9900 EUR minor units unchanged", async () => {
    const e = await addEntry(ctx, "theo", entry({ date: first, service_from: first, service_to: first }));
    const f = await financeOverview(ctx, "theo");
    expect(f.fx.usd).toMatchObject({ rate: "1.1000", rate_date: first, source: "demo" });
    expect(usdView(9900, f.fx.usd as never)).toBe(10890);
    expect((await repo.get("LedgerEntries", e.id, { fresh: true }))?.amount_minor).toBe(9900);
  });
  it("a USD entry locks its rate; a later rate for that date changes nothing", async () => {
    const e = await addEntry(ctx, "theo", entry({ kind: "expense", category: "api_tokens", cost_center: "local", currency: "USD", amount_minor: 9900 }));
    expect(e).toMatchObject({ currency: "USD", amount_minor: -9900, eur_minor: -9000, fx_rate: "1.1000", fx_date: first, fx_source: "demo" });
    await repo.insert("FxRates", [{ id: childId("fx", "ecb", "USD", first), base: "EUR", quote: "USD", rate: "1.2000", rate_date: first, source: "ecb", fetched_at: new Date().toISOString() }], { founder: "system" });
    const it = (await financeOverview(ctx, "theo")).items.find((i) => i.id === e.id)!;
    expect(it.eur_net).toBe(-9000);
    expect(it.fx).toMatchObject({ rate: "1.1000", rate_date: first });
  });
  it("refuses a foreign-currency entry with no known rate, unless a founder enters the rate by hand", async () => {
    const old = addDays(first, -60);
    await expect(addEntry(ctx, "theo", entry({ date: old, currency: "USD" }))).rejects.toBeInstanceOf(RuleError);
    const e = await addEntry(ctx, "theo", entry({ date: old, currency: "USD", manual_rate: "1,0800" }));
    expect(e).toMatchObject({ fx_rate: "1.0800", fx_source: "manual", eur_minor: 9167 });
  });
});

describe("ECB rates in LIVE (fetched lazily once a day, cached in FxRates, never invented)", () => {
  afterEach(() => setEcbFetcher(async () => { throw new Error("no network in tests"); }));
  it("caches the daily file once; a failure keeps the cache and leaves unconverted rows out", async () => {
    let calls = 0;
    const d = addDays(today, -1);
    setEcbFetcher(async () => { calls++; return `<Cube><Cube time='${d}'><Cube currency='USD' rate='1.0812'/><Cube currency='GBP' rate='0.8400'/></Cube></Cube>`; });
    const live = mkCtx(repo, "live");
    const f = await financeOverview(live, "theo");
    expect(f.fx.usd).toMatchObject({ rate: "1.0812", rate_date: d, source: "ecb" });
    await financeOverview(live, "theo");
    expect(calls).toBe(1);
    const rows = (await repo.list("FxRates", { fresh: true })).rows;
    expect(rows.map((r) => r.quote)).toEqual(["USD"]); // only the currencies needed
    // A bank movement in GBP with no rate: shown, counted as missing, excluded from totals.
    setEcbFetcher(async () => { throw new Error("timeout"); });
    await repo.insert("BankTransactions", [{ id: uuid(), bank: "wise", source_id: "T-GBP", origin: "csv", balance_id: "csv-GBP", currency: "GBP", amount_minor: -5000, fee_minor: null, direction: "debit", date: today, occurred_at: new Date().toISOString(), description: "Outil (test)", counterparty: "", bank_type: "CARD", merchant_category: "", category: "software", category_source: "auto", running_balance_minor: null, note: "" }], { founder: "system" });
    const g = await financeOverview(live, "theo");
    expect(g.fx.missing).toBe(1);
    expect(g.fx.error).toMatch(/ECB/);
    expect(g.pnl.at(-1)!.opex).toBe(0);
  });
});

describe("bank movements, allocations and contracts (in-memory DEMO)", () => {
  it("contracts come from the demo projects once; allocation edits are version-checked (409 on a stale form)", async () => {
    const mem = new InMemoryRepository();
    await seedBaseline(mem, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
    await seedDemo(mem);
    const demo = mkCtx(mem);
    const { MemoryBank, demoWiseStore } = await import("@/fake-wise/store");
    demo.bank = new MemoryBank(demoWiseStore());
    await moneyOverview(demo, "theo"); // first read syncs the demo Wise movements
    expect((await contractsFromProjects(demo, "theo")).added).toBe(0); // already made by the demo seed
    const f = await financeOverview(demo, "theo");
    expect(f.contracts.map((c) => c.kind).sort()).toEqual(["one_off", "subscription"]);
    expect(f.numbers.mrr).toMatchObject({ value: 10000, source: "contracts" });
    expect(f.schedule.length).toBeGreaterThan(0);
    const contribution = f.items.find((i) => i.category === "founder_contribution")!;
    expect(f.contributions.filter((c) => c.ref === contribution.id).every((c) => c.line === "neutral")).toBe(true);
    const sub = f.items.find((i) => i.source === "bank" && /VL-0001/.test(i.label))!;
    expect(sub.cost_center).toBe("local");
    const saved = await saveAllocation(demo, "theo", { bank_tx_id: sub.id, expected_version: 0, cost_center: "local", cost_class: "", vat_minor: 0, service_from: null, service_to: null, contract_id: "", project_id: "", receipt_url: "https://files.example.com/r.pdf", reference: "VL-0001", reconciled: true, note: "" });
    await expect(saveAllocation(demo, "pablo", { bank_tx_id: sub.id, expected_version: 0, cost_center: "consulting", cost_class: "", vat_minor: 0, service_from: null, service_to: null, contract_id: "", project_id: "", receipt_url: "", reference: "", reconciled: false, note: "" })).rejects.toBeInstanceOf(ConflictError);
    await saveAllocation(demo, "pablo", { bank_tx_id: sub.id, expected_version: saved.version, cost_center: "local", cost_class: "", vat_minor: 1667, service_from: null, service_to: null, contract_id: "", project_id: "", receipt_url: "", reference: "", reconciled: true, note: "" });
    await expect(saveAllocation(demo, "theo", { bank_tx_id: sub.id, expected_version: saved.version, cost_center: "thirty", cost_class: "", vat_minor: 0, service_from: null, service_to: null, contract_id: "", project_id: "", receipt_url: "", reference: "", reconciled: false, note: "" })).rejects.toBeInstanceOf(ConflictError);
    const after = (await financeOverview(demo, "theo")).items.find((i) => i.id === sub.id)!;
    expect(after).toMatchObject({ vat_minor: 1667, eur_net: 10000 - 1667, auto: false });
  });
});
