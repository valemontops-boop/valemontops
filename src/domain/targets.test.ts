import { describe, expect, it } from "vitest";
import { effectiveFromForEdit, feasibility, resolveMode, resolveTargets, weightedAttainment } from "./targets";
import { emptyTally } from "./activity";

const spec = (target: number, weight = 1, minutes = 0) => ({ target, weight, minutes });

describe("weighted attainment (scenario 5 figures)", () => {
  const targets = { calls: spec(10), dms: spec(10) };
  it("10 and 7 gives 85%", () => {
    expect(weightedAttainment(targets, { calls: 10, dms: 7 })).toBeCloseTo(0.85, 10);
  });
  it("10 and 6 gives 80%", () => {
    expect(weightedAttainment(targets, { calls: 10, dms: 6 })).toBeCloseTo(0.8, 10);
  });
  it("20 and 6 still gives 80% because of the cap", () => {
    expect(weightedAttainment(targets, { calls: 20, dms: 6 })).toBeCloseTo(0.8, 10);
  });
  it("ignores zero targets; no targets means null (no punishment)", () => {
    expect(weightedAttainment({ calls: spec(0), dms: spec(4) }, { dms: 2 })).toBe(0.5);
    expect(weightedAttainment({ calls: spec(0) }, {})).toBeNull();
  });
  it("uses weights", () => {
    expect(weightedAttainment({ calls: spec(10, 3), dms: spec(10, 1) }, { calls: 10, dms: 0 })).toBe(0.75);
  });
});

describe("prospective targets", () => {
  const base = { created_at: "2026-11-01T00:00:00.000Z", founder_key: "theo" };
  it("resolves the latest effective mode and targets", () => {
    const modes = [
      { ...base, mode: "REDUCED" as const, effective_from: "2026-11-01" },
      { ...base, mode: "FULL_TIME" as const, effective_from: "2026-11-10" },
    ];
    expect(resolveMode(modes, "theo", "2026-11-09")).toBe("REDUCED");
    expect(resolveMode(modes, "theo", "2026-11-10")).toBe("FULL_TIME");
    expect(resolveMode(modes, "pablo", "2026-11-10")).toBeNull();
    const rows = [
      { ...base, mode: "FULL_TIME" as const, metric: "calls" as const, target: 35, weight: 1, minutes_per_action: 4, effective_from: "2026-11-01" },
      { ...base, created_at: "2026-11-05T00:00:00.000Z", mode: "FULL_TIME" as const, metric: "calls" as const, target: 30, weight: 1, minutes_per_action: 4, effective_from: "2026-11-01" },
    ];
    expect(resolveTargets(rows, "theo", "FULL_TIME", "2026-11-09").calls).toEqual({ target: 30, weight: 1, minutes: 4 });
  });
  it("an edit after today's plan exists applies tomorrow", () => {
    expect(effectiveFromForEdit("2026-11-09", true, "2026-11-10")).toBe("2026-11-10");
    expect(effectiveFromForEdit("2026-11-09", false, "2026-11-10")).toBe("2026-11-09");
  });
  it("computes feasibility against capacity", () => {
    const f = feasibility({ calls: spec(35, 1, 4), dms: spec(12, 1, 3) }, 120);
    expect(f).toEqual({ plannedMinutes: 176, capacityMinutes: 120, overBy: 56, feasible: false });
    expect(emptyTally().calls).toBe(0);
  });
});

describe("LinkedIn limits take priority over targets (brief round 8)", () => {
  it("caps the invitation target by the daily limit and what is left of the weekly limit", async () => {
    const { linkedinCap } = await import("./seeds");
    expect(linkedinCap(15, { daily: 20, weekly: 100 }, 0)).toEqual({ target: 15, capped: false });
    expect(linkedinCap(25, { daily: 20, weekly: 100 }, 0)).toEqual({ target: 20, capped: true });
    expect(linkedinCap(15, { daily: 20, weekly: 100 }, 92)).toEqual({ target: 8, capped: true });
    expect(linkedinCap(15, { daily: 20, weekly: 100 }, 140)).toEqual({ target: 0, capped: true });
  });
});
