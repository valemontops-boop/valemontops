import { describe, expect, it } from "vitest";
import {
  actualCost, assignmentCost, capacityCheck, forecastCost, LOCAL_PLAN_LIMITS_SEED, LOCAL_PROVISIONS_SEED, limitLevel, localMargin, marginOf, parseLocalUsageCsv,
  projectAlerts, projectCost, projectRevenue, provisionsTotal, shortlist,
} from "./delivery";

describe("project cost calculator and margin", () => {
  it("adds founder labour, contractors, API usage and infrastructure", () => {
    const c = projectCost({ founderHours: 20, hourCostMinor: 3000, assignments: [{ planned_hours: 10, rate_minor: 4500, rate_unit: "hour" }, { planned_hours: 16, rate_minor: 40000, rate_unit: "day" }, { planned_hours: 0, rate_minor: 25000, rate_unit: "fixed", status: "cancelled" }], apiMinor: 1500, infraMinor: 2500 });
    expect(c).toEqual({ founder: 60000, contractors: 45000 + 80000, api: 1500, infra: 2500, other: 0, total: 189000 });
    expect(assignmentCost({ planned_hours: 3, rate_minor: 99999, rate_unit: "fixed" })).toBe(99999);
  });
  it("classifies healthy / at risk / negative with the guardrail", () => {
    expect(marginOf(150000, 60000, 30)).toEqual({ margin: 90000, pct: 60, status: "healthy" });
    expect(marginOf(150000, 120000, 30).status).toBe("at_risk"); // 20 %
    expect(marginOf(150000, 150001, 30).status).toBe("negative");
    expect(marginOf(0, 0, 30).status).toBe("at_risk"); // no revenue: never "healthy"
  });
  it("counts MRR over the term and forecasts from max(estimate, actual)", () => {
    expect(projectRevenue({ revenue_one_off_minor: 49000, mrr_minor: 9900, term_months: 12 })).toBe(49000 + 118800);
    expect(projectRevenue({ revenue_one_off_minor: 150000, mrr_minor: 0, term_months: null })).toBe(150000);
    expect(forecastCost(60000, 20000)).toBe(60000);
    expect(forecastCost(60000, 90000)).toBe(90000);
  });
  it("values time entries at the founder hour cost and the contractor's own rate", () => {
    const a = actualCost({
      entries: [{ minutes: 240, person_kind: "founder", vendor_id: "" }, { minutes: 300, person_kind: "contractor", vendor_id: "v1" }, { minutes: 60, person_kind: "contractor", vendor_id: "v2" }],
      costs: [{ amount_minor: 1800, kind: "api" }], hourCostMinor: 3000,
      assignments: [{ vendor_id: "v1", planned_hours: 20, rate_minor: 4500, rate_unit: "hour" }, { vendor_id: "v2", planned_hours: 0, rate_minor: 50000, rate_unit: "fixed" }],
    });
    expect(a).toEqual({ founder: 12000, contractors: 22500 + 50000, direct: 1800, total: 86300, founderHours: 4, contractorHours: 6 });
  });
});

describe("contractor capacity and shortlist", () => {
  it("spreads planned hours over the assignment's weeks and warns above capacity", () => {
    const ok = capacityCheck(10, [{ planned_hours: 24, rate_minor: 0, rate_unit: "hour", start_date: "2026-11-02", end_date: "2026-11-29" }]); // 4 weeks
    expect(ok).toMatchObject({ plannedPerWeek: 6, over: false, loadPct: 60 });
    const over = capacityCheck(10, [
      { planned_hours: 24, rate_minor: 0, rate_unit: "hour", start_date: "2026-11-02", end_date: "2026-11-29" },
      { planned_hours: 10, rate_minor: 0, rate_unit: "hour", start_date: "2026-11-09", end_date: "2026-11-15" }, // 1 week
      { planned_hours: 50, rate_minor: 0, rate_unit: "hour", status: "done", start_date: "2026-11-09", end_date: "2026-11-15" },
    ]);
    expect(over).toMatchObject({ plannedPerWeek: 16, over: true });
  });
  it("filters by skill, free capacity, country and cost, cheapest first, never the unavailable", () => {
    const v = [
      { id: "a", skills: ["Automatisation", "CRM"], country: "FR", capacity_hours_week: 10, availability: "available", hourly_rate_minor: 6000 },
      { id: "b", skills: ["automatisation"], country: "FR", capacity_hours_week: 20, availability: "available", hourly_rate_minor: 4000 },
      { id: "c", skills: ["automatisation"], country: "ES", capacity_hours_week: 20, availability: "available", hourly_rate_minor: 3000 },
      { id: "d", skills: ["automatisation"], country: "FR", capacity_hours_week: 40, availability: "unavailable", hourly_rate_minor: 1000 },
    ];
    const free = new Map([["a", 2], ["b", 12]]);
    expect(shortlist(v, free, { skill: "auto", country: "FR" }).map((x) => x.id)).toEqual(["b", "a"]);
    expect(shortlist(v, free, { skill: "auto", minHours: 5 }).map((x) => x.id)).toEqual(["c", "b"]);
    expect(shortlist(v, free, { maxRateMinor: 4500 }).map((x) => x.id)).toEqual(["c", "b"]);
  });
});

describe("project alerts", () => {
  it("flags overdue milestones, unassigned open tasks and a potential negative margin", () => {
    const alerts = projectAlerts({
      today: "2026-11-09",
      milestones: [{ title: "Kick-off", due_date: "2026-11-01", done_at: "2026-11-01T10:00:00Z" }, { title: "Diagnostic", due_date: "2026-11-05", done_at: null }, { title: "Later", due_date: "2026-12-01", done_at: null }],
      tasks: [{ owner: null, status: "todo" }, { owner: null, status: "done" }, { owner: "theo", status: "todo" }],
      margin: { margin: -5000, pct: -3, status: "negative" },
    });
    expect(alerts).toEqual([{ kind: "overdue_milestone", title: "Diagnostic", due: "2026-11-05" }, { kind: "unassigned_tasks", count: 1 }, { kind: "negative_margin", marginMinor: -5000 }]);
  });
  it("keeps only margin alerts once the project is delivered", () => {
    const alerts = projectAlerts({ today: "2026-11-09", milestones: [{ title: "x", due_date: "2026-01-01", done_at: null }], tasks: [{ owner: null, status: "todo" }], margin: { margin: 10, pct: 10, status: "at_risk" }, delivered: true });
    expect(alerts).toEqual([{ kind: "at_risk_margin", pct: 10 }]);
  });
});

describe("Valemont Local limits and contribution margin", () => {
  it("seeds the spec 2.5 limits and the 37 € provisions", () => {
    expect(LOCAL_PLAN_LIMITS_SEED).toEqual({ conversations: 200, qualified_requests: 100, automated_emails: 200, support_minutes: 30, locations: 1 });
    expect(provisionsTotal(LOCAL_PROVISIONS_SEED, 30)).toBe(3700);
  });
  it("alerts at 80 % and 100 % of a limit", () => {
    expect(limitLevel(159, 200)).toBe("ok");
    expect(limitLevel(160, 200)).toBe("warn");
    expect(limitLevel(200, 200)).toBe("over");
    expect(limitLevel(1, 0)).toBe("over");
  });
  it("margin = 100 € − provisions, with support over 30 minutes eating the margin", () => {
    const base = { conversations: 172, qualified_requests: 41, automated_emails: 96, support_minutes: 20, locations: 1, actual_cost_minor: null };
    const ok = localMargin(base, 10000, LOCAL_PLAN_LIMITS_SEED, LOCAL_PROVISIONS_SEED);
    expect(ok).toMatchObject({ costMinor: 3700, marginMinor: 6300, marginPct: 63, costBasis: "provisions", extraSupportMinutes: 0 });
    expect(ok.levels.conversations).toBe("warn");
    const heavy = localMargin({ ...base, support_minutes: 75 }, 10000, LOCAL_PLAN_LIMITS_SEED, LOCAL_PROVISIONS_SEED);
    expect(heavy).toMatchObject({ supportCostMinor: 5000, costMinor: 1700 + 5000, marginMinor: 3300, extraSupportMinutes: 45, extraSupportCostMinor: 3000 });
    expect(heavy.levels.support_minutes).toBe("over");
    expect(localMargin({ ...base, actual_cost_minor: 2500 }, 10000, LOCAL_PLAN_LIMITS_SEED, LOCAL_PROVISIONS_SEED)).toMatchObject({ costMinor: 2500, marginMinor: 7500, costBasis: "actual" });
  });
  it("parses a usage CSV (FR headers, semicolons) and rejects bad rows", () => {
    const r = parseLocalUsageCsv("Client;Mois;Conversations;Demandes qualifiées;E-mails;Support\nGarage Test;2026-11;120;30;80;45\n;2026-11;1;1;1;1\nAutre;2026-11;-3;1;1;1\n");
    expect(r.rows).toEqual([{ client: "Garage Test", month: "2026-11", values: { conversations: 120, qualified_requests: 30, automated_emails: 80, support_minutes: 45 }, actual_cost_minor: null }]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });
});
