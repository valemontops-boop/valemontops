import { describe, expect, it } from "vitest";
import { allocateByDays, arr, billingPeriod, buildPnl, contractMrr, defaultClass, mrrMovements, mrrOn, runwayMonths, suggestCostCenter, sumMonths, type ContractLite, type FinItem, type ScheduleLine } from "./finance";

const item = (p: Partial<FinItem> & Pick<FinItem, "id" | "date" | "eur_gross">): FinItem => ({
  source: "manual", label: "", counterparty: "", category: "revenue", cost_center: "local", cls: "revenue", currency: "EUR", gross_minor: p.eur_gross ?? 0, vat_minor: 0,
  eur_net: (p.eur_gross ?? 0) - (p.eur_vat ?? 0), eur_vat: 0, fx: null, service_from: null, service_to: null, contract_id: "", project_id: "", receipt_url: "", reference: "", reconciled: true, ...p,
});
const sub = (p: Partial<ContractLite> = {}): ContractLite => ({ id: "c1", client_id: "cl1", name: "Client (test)", cost_center: "local", kind: "subscription", currency: "EUR", setup_minor: 0, one_off_minor: 0, recurring_minor: 9900, billing_months: 1, start_date: "2026-10-01", end_date: null, status: "active", ...p });

describe("MRR and ARR (spec 5.10)", () => {
  it("counts active subscriptions normalized by billing period, never set-up fees or one-off contracts", () => {
    expect(contractMrr(sub({ setup_minor: 49000 }), "2026-11-09")).toBe(9900);
    expect(contractMrr(sub({ recurring_minor: 118800, billing_months: 12 }), "2026-11-09")).toBe(9900);
    expect(contractMrr(sub({ kind: "one_off", one_off_minor: 3900, recurring_minor: 0 }), "2026-11-09")).toBe(0);
    expect(contractMrr(sub({ status: "paused" }), "2026-11-09")).toBe(0);
    expect(contractMrr(sub({ start_date: "2026-12-01" }), "2026-11-09")).toBe(0);
    expect(contractMrr(sub({ end_date: "2026-10-31" }), "2026-11-09")).toBe(0);
    const m = mrrOn([sub({ setup_minor: 49000 }), sub({ id: "c2", kind: "one_off", cost_center: "thirty", one_off_minor: 3900, recurring_minor: 0 })], "2026-11-09");
    expect(m.mrr).toBe(9900);
    expect(m.arr).toBe(118800);
    expect(arr(9900)).toBe(118800);
  });
  it("leaves out (and counts) a foreign-currency contract when no rate is known", () => {
    expect(mrrOn([sub({ currency: "USD" })], "2026-11-09", () => null)).toMatchObject({ mrr: 0, missing: 1 });
  });
  it("classifies MRR movements per client", () => {
    const cs = [sub({ start_date: "2026-11-03" }), sub({ id: "c2", client_id: "cl2", start_date: "2026-01-01", end_date: "2026-11-05" }), sub({ id: "c3", client_id: "cl3", start_date: "2026-01-01", recurring_minor: 20000 })];
    expect(mrrMovements(cs, "2026-11")).toEqual({ new: 9900, expansion: 0, contraction: 0, churn: 9900, reactivation: 0 });
  });
});

describe("revenue recognition vs cash", () => {
  it("splits by days with an exact sum", () => {
    const m = allocateByDays(10000, "2026-11-16", "2026-12-15");
    expect([...m.entries()]).toEqual([["2026-11", 5000], ["2026-12", 5000]]);
    const odd = allocateByDays(9900, "2026-11-15", "2026-12-14");
    expect([...odd.values()].reduce((a, b) => a + b, 0)).toBe(9900);
    expect(allocateByDays(-300, "2026-01-01", "2026-03-31").get("2026-02")).toBe(-93);
  });
  it("a monthly payment linked to a subscription covers its calendar month", () => {
    expect(billingPeriod("2026-11-20", 1)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(billingPeriod("2026-11-20", 12)).toEqual({ from: "2026-11-01", to: "2027-10-31" });
  });
  it("revenue follows the service period while cash stays on the payment date; VAT is cash, not revenue", () => {
    const items = [item({ id: "p", date: "2026-11-15", eur_gross: 11880, eur_vat: 1980, service_from: "2026-11-15", service_to: "2026-12-14" })];
    const { months } = buildPnl({ items, schedule: [], contracts: [], months: ["2026-11", "2026-12"] });
    expect(months[0].cash_in).toBe(11880);
    expect(months[1].cash_in).toBe(0);
    expect(months[0].revenue.total + months[1].revenue.total).toBe(9900);
    expect(months[0].revenue.total).toBe(5280); // 16 of 30 days
    expect(months[0].vat_in).toBe(1980);
    expect(months[0].provisional).toBe(false);
  });
  it("a payment with no service period is recognized on its date and makes the month provisional", () => {
    const { months } = buildPnl({ items: [item({ id: "t", date: "2026-11-02", eur_gross: 3900, cost_center: "thirty" })], schedule: [], contracts: [], months: ["2026-11"] });
    expect(months[0].revenue.thirty).toBe(3900);
    expect(months[0].provisional).toBe(true);
  });
  it("a one-off contract with a schedule is recognized when earned; its payments are cash only", () => {
    const c = sub({ id: "k", kind: "one_off", cost_center: "consulting", one_off_minor: 150000, recurring_minor: 0 });
    const schedule: ScheduleLine[] = [
      { id: "s1", contract_id: "k", label: "Kick-off", kind: "milestone", period_start: "2026-10-20", period_end: "2026-10-20", amount_eur: 75000, amount_minor: 75000, currency: "EUR", status: "earned", earned_on: "2026-10-20", cost_center: "consulting" },
      { id: "s2", contract_id: "k", label: "Delivery", kind: "milestone", period_start: "2026-12-01", period_end: "2026-12-01", amount_eur: 75000, amount_minor: 75000, currency: "EUR", status: "planned", earned_on: null, cost_center: "consulting" },
    ];
    const { months } = buildPnl({ items: [item({ id: "pay", date: "2026-11-03", eur_gross: 150000, cost_center: "consulting", contract_id: "k" })], schedule, contracts: [c], months: ["2026-10", "2026-11"] });
    expect(months[0].revenue.consulting).toBe(75000);
    expect(months[1].revenue.consulting).toBe(0);
    expect(months[1].cash_in).toBe(150000);
  });
});

describe("managerial P&L and EBITDA", () => {
  it("aggregates revenue by cost center, direct costs, opex by category; contributions and transfers are neither", () => {
    const items = [
      item({ id: "r1", date: "2026-11-02", eur_gross: 150000, cost_center: "consulting", service_from: "2026-11-01", service_to: "2026-11-30" }),
      item({ id: "r2", date: "2026-11-05", eur_gross: 10000, cost_center: "local", service_from: "2026-11-01", service_to: "2026-11-30" }),
      item({ id: "c1", date: "2026-11-06", eur_gross: -30000, category: "contractors", cls: "direct", cost_center: "consulting" }),
      item({ id: "o1", date: "2026-11-07", eur_gross: -2390, category: "software", cls: "opex", cost_center: "shared" }),
      item({ id: "o2", date: "2026-11-08", eur_gross: -1200, category: "travel", cls: "opex", cost_center: "shared" }),
      item({ id: "n1", date: "2026-11-09", eur_gross: 500000, category: "founder_contribution", cls: "neutral", cost_center: "shared" }),
      item({ id: "x1", date: "2026-11-09", eur_gross: -8000, category: "taxes", cls: "excluded", cost_center: "shared" }),
      item({ id: "f1", date: "2026-11-09", eur_gross: null, eur_net: null, currency: "USD" }),
    ];
    const { months, contributions } = buildPnl({ items, schedule: [], contracts: [], months: ["2026-11"] });
    const m = months[0];
    expect(m.revenue).toMatchObject({ consulting: 150000, local: 10000, thirty: 0, total: 160000 });
    expect(m.direct).toBe(30000);
    expect(m.gross_profit).toBe(130000);
    expect(m.gross_margin).toBeCloseTo(0.8125);
    expect(m.opex_by_category).toEqual({ software: 2390, travel: 1200 });
    expect(m.ebitda).toBe(130000 - 3590);
    expect(m.cash_in).toBe(160000);
    expect(m.cash_out).toBe(30000 + 2390 + 1200 + 8000);
    expect(m.neutral).toBe(500000);
    expect(contributions.filter((c) => c.line === "opex:software").map((c) => c.ref)).toEqual(["o1"]);
    expect(contributions.some((c) => c.ref === "f1")).toBe(false);
    expect(sumMonths(months).ebitda).toBe(m.ebitda);
  });
  it("a refund to a client reduces revenue, not opex", () => {
    const { months } = buildPnl({ items: [item({ id: "r", date: "2026-11-02", eur_gross: 3900, cost_center: "thirty" }), item({ id: "rf", date: "2026-11-03", eur_gross: -3900, category: "refund", cost_center: "thirty" })], schedule: [], contracts: [], months: ["2026-11"] });
    expect(months[0].revenue.total).toBe(0);
    expect(months[0].opex).toBe(0);
  });
  it("default classes follow spec 5.10", () => {
    expect(defaultClass("internal_transfer")).toBe("neutral");
    expect(defaultClass("loan")).toBe("neutral");
    expect(defaultClass("vat")).toBe("excluded");
    expect(defaultClass("contractors")).toBe("direct");
    expect(defaultClass("software")).toBe("opex");
  });
  it("runway = cash ÷ average net burn of the last 3 complete months; none when not burning", () => {
    const m = (cash_in: number, cash_out: number) => ({ ...buildPnl({ items: [], schedule: [], contracts: [], months: ["2026-01"] }).months[0], cash_in, cash_out });
    expect(runwayMonths(600000, [m(0, 100000), m(0, 100000), m(0, 100000)])).toBe(6);
    expect(runwayMonths(600000, [m(200000, 100000)])).toBeNull();
  });
  it("suggests a cost center for incoming money (client match, 30/30, Local price), Consulting otherwise", () => {
    const base = { category: "revenue" as const, counterparty: "", description: "" };
    expect(suggestCostCenter({ ...base, amount_minor: 10000, counterparty: "Electricidad Vega" }, [{ name: "Electricidad Vega (demo)", brand: "local" }], 10000)).toBe("local");
    expect(suggestCostCenter({ ...base, amount_minor: 3900 }, [], 10000)).toBe("thirty");
    expect(suggestCostCenter({ ...base, amount_minor: 10000, description: "Abonnement mois 2" }, [], 10000)).toBe("local");
    expect(suggestCostCenter({ ...base, amount_minor: 150000 }, [], 10000)).toBe("consulting");
    expect(suggestCostCenter({ ...base, category: "software", amount_minor: -2390 }, [], 10000)).toBe("shared");
  });
});
