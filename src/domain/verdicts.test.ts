import { describe, expect, it } from "vitest";
import { growthVerdicts, moneyVerdicts, salesVerdicts } from "./verdicts";

const k = (v: number | null, delta: number | null = null) => ({ value: v, delta });
describe("verdicts", () => {
  it("reads sales: low pick-up with the best hour, low yes rate with the weakest objection, best trade", () => {
    const v = salesVerdicts({
      kpis: { dials: k(100, -30), pickupRate: k(0.15), yesRate: k(0.05), yes: k(1), meetings: k(1) },
      byHour: [{ hour: 9, dials: 40, pickupRate: 0.1 }, { hour: 12, dials: 20, pickupRate: 0.4 }],
      byNiche: [{ key: "Plumbers", dials: 50, picked: 10, yesRate: 0.3 }, { key: "Garages", dials: 50, picked: 10, yesRate: 0.05 }],
      byMarket: [], objections: [{ key: "too_expensive", count: 6, won: 0, wonRate: 0 }],
    });
    const keys = v.map((x) => [x.kind, x.key]);
    expect(keys).toContainEqual(["watch", "Calls are down {d}% vs the previous period."]);
    expect(v.find((x) => x.key === "Only {p}% of calls are picked up.")?.action?.vars).toEqual({ h: 12, p: 40 });
    expect(v.find((x) => x.key === "Only {p}% of the people reached say yes.")?.action?.vars).toMatchObject({ objection: "too_expensive", n: 6 });
    expect(keys).toContainEqual(["good", "{niche} answers best: {p}% yes."]);
    expect(keys).toContainEqual(["watch", "{niche} answers less: {p}% yes."]);
  });
  it("draws no rate conclusion from a tiny sample", () => {
    const v = salesVerdicts({ kpis: { dials: k(5), pickupRate: k(0), yesRate: k(0), yes: k(0), meetings: k(0) }, byHour: [], byNiche: [], byMarket: [], objections: [] });
    expect(v).toEqual([]);
  });
  it("reads growth and money", () => {
    const g = growthVerdicts({ all: [{ key: "phone", touches: 60, meetings: 3, meetingsPerHour: 0.8, steps: [{ label: "Dials", value: 60 }, { label: "Picked up", value: 20 }] }, { key: "linkedin", touches: 40, meetings: 0, meetingsPerHour: 0, steps: [] }, { key: "email", touches: 4, meetings: 0, meetingsPerHour: null, steps: [{ label: "Sent", value: 4 }] }], inbound: { steps: [] }, best: "phone" });
    expect(g.map((x) => x.kind)).toEqual(["good", "fix", "fix"]); // best channel, LinkedIn without meetings, low message coverage
    const m = moneyVerdicts({ months: [{ month: "2026-09", income: 0, expenses: 100000, net: -100000 }, { month: "2026-10", income: 0, expenses: 100000, net: -100000 }, { month: "2026-11", income: 0, expenses: 100000, net: -100000 }], expensesByCategory: [{ category: "software", amount: 100000 }], toReview: 0, balance: 200000, mrr: null }, (x) => `${x / 100} €`);
    expect(m[0]).toMatchObject({ kind: "fix", key: "This month you spend more than you earn ({x})." });
    expect(m[1]).toMatchObject({ kind: "fix", key: "Cash covers about {n} months at the current pace.", vars: { n: 2 } });
  });
});
