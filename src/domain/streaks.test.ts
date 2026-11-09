import { describe, expect, it } from "vitest";
import { consistency, currentStreak, evaluateDay, highPriorityFollowupsOk } from "./streaks";
import { emptyTally, tallyDay, type EventLike } from "./activity";

const plan = { is_workday: true, targets: { calls: { target: 10, weight: 1, minutes: 4 }, dms: { target: 10, weight: 1, minutes: 3 } } };
const t = (calls: number, dms: number) => ({ ...emptyTally(), calls, dms });

describe("Scenario 5: daily status", () => {
  it("10 and 7 → 85 % Passed", () => {
    const r = evaluateDay(plan, t(10, 7), true, true);
    expect(r.attainment).toBeCloseTo(0.85);
    expect(r.status).toBe("passed");
  });
  it("10 and 6 → 80 % Missed", () => {
    expect(evaluateDay(plan, t(10, 6), true, true)).toMatchObject({ status: "missed" });
  });
  it("20 and 6 → still 80 % Missed because of the cap", () => {
    const r = evaluateDay(plan, t(20, 6), true, true);
    expect(r.attainment).toBeCloseTo(0.8);
    expect(r.status).toBe("missed");
  });
  it("Perfect meets every target; review and follow-ups are required", () => {
    expect(evaluateDay(plan, t(10, 10), true, true).status).toBe("perfect");
    expect(evaluateDay(plan, t(10, 10), true, false).status).toBe("missed");
    expect(evaluateDay(plan, t(10, 10), false, true).status).toBe("missed");
  });
  it("off days and days without targets are never missed", () => {
    expect(evaluateDay({ ...plan, is_workday: false }, t(0, 0), true, false).status).toBe("off");
    expect(evaluateDay({ is_workday: true, targets: {} }, t(0, 0), true, false).status).toBe("off");
    expect(evaluateDay(null, t(0, 0), true, false).status).toBe("off");
  });
  it("repeated submissions with the same idempotency_key do not change the score", () => {
    const ev = (key: string, i: number): EventLike => ({ id: `00000000-0000-4000-8000-00000000000${i}`, idempotency_key: key, created_at: `2026-11-09T10:00:0${i}.000Z`, founder_key: "theo", activity_type: "cold_call", account_id: "a", local_date: "2026-11-09", occurred_at: "2026-11-09T10:00:00.000Z" });
    const once = tallyDay([ev("k1", 1)], "theo", "2026-11-09");
    const twice = tallyDay([ev("k1", 1), ev("k1", 2)], "theo", "2026-11-09");
    expect(twice.calls).toBe(once.calls);
  });
  it("no due follow-ups counts as fulfilled", () => {
    expect(highPriorityFollowupsOk([], [], "2026-11-09")).toBe(true);
  });
  it("an untouched high-priority follow-up fails the day; a touch fixes it", () => {
    const opp = { account_id: "a", next_action_priority: "high", next_action_due: "2026-11-08", stage: "contacted", is_archived: false };
    expect(highPriorityFollowupsOk([opp], [], "2026-11-09")).toBe(false);
    expect(highPriorityFollowupsOk([opp], [{ account_id: "a", local_date: "2026-11-09" }], "2026-11-09")).toBe(true);
    expect(highPriorityFollowupsOk([{ ...opp, next_action_priority: "normal" }], [], "2026-11-09")).toBe(true);
  });
});

describe("streaks and consistency", () => {
  const r = (local_date: string, status: string) => ({ local_date, status });
  it("skips off days and stops at a miss", () => {
    const rows = [r("2026-11-02", "missed"), r("2026-11-03", "passed"), r("2026-11-04", "perfect"), r("2026-11-05", "off"), r("2026-11-06", "passed")];
    expect(currentStreak(rows)).toBe(3);
    expect(consistency(rows, "2026-11-02", "2026-11-08")).toEqual({ pct: 0.75, passed: 3, scheduled: 4 });
    expect(consistency([r("2026-11-05", "off")], "2026-11-01", "2026-11-08").pct).toBeNull();
  });
});
