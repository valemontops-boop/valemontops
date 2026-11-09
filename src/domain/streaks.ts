import type { Metric } from "./constants";
import type { Tally } from "./activity";
import { weightedAttainment, type TargetSpec } from "./targets";

export type DayStatus = "scheduled" | "in_progress" | "passed" | "perfect" | "missed" | "off";

export interface DayPlanLike {
  is_workday: boolean;
  targets: Partial<Record<Metric, TargetSpec>>;
}

export interface DayEval {
  status: "passed" | "perfect" | "missed" | "off";
  attainment: number | null;
  followupsOk: boolean;
  reviewDone: boolean;
  perfectTargets: boolean;
}

export const PASS_THRESHOLD = 0.85;

/**
 * Closed-day evaluation (spec 5.4). No plan, a day off or no eligible target is "off":
 * no targets means no punishment. Passed needs follow-ups handled, the end-of-day review
 * and >= 85 % weighted attainment; Perfect also meets every eligible target.
 */
export function evaluateDay(plan: DayPlanLike | null, tally: Tally, followupsOk: boolean, reviewDone: boolean): DayEval {
  if (!plan || !plan.is_workday) return { status: "off", attainment: null, followupsOk, reviewDone, perfectTargets: false };
  const attainment = weightedAttainment(plan.targets, tally);
  if (attainment === null) return { status: "off", attainment: null, followupsOk, reviewDone, perfectTargets: false };
  const eligible = (Object.entries(plan.targets) as [Metric, TargetSpec][]).filter(([, s]) => s && s.target > 0 && s.weight > 0);
  const perfectTargets = eligible.every(([m, s]) => (tally[m] ?? 0) >= s.target);
  const passed = followupsOk && reviewDone && attainment >= PASS_THRESHOLD - 1e-9;
  return { status: passed ? (perfectTargets ? "perfect" : "passed") : "missed", attainment, followupsOk, reviewDone, perfectTargets };
}

/** High-priority due follow-ups must be handled: touched by the day, or rescheduled (with a reason) past it. */
export function highPriorityFollowupsOk(
  opps: { account_id: string; next_action_priority: string | null; next_action_due: string | null; stage: string; is_archived: boolean }[],
  touches: { account_id: string; local_date: string }[],
  date: string,
): boolean {
  for (const o of opps) {
    if (o.is_archived || o.stage === "won" || o.stage === "lost") continue;
    if (o.next_action_priority !== "high" || !o.next_action_due || o.next_action_due > date) continue;
    const handled = touches.some((t) => t.account_id === o.account_id && t.local_date >= o.next_action_due! && t.local_date <= date);
    if (!handled) return false;
  }
  return true; // no due follow-ups counts as fulfilled (ratio 1)
}

/** Consecutive Passed/Perfect closed days counting back from the latest, skipping Off days. */
export function currentStreak(results: { local_date: string; status: string }[]): number {
  const closed = [...results].sort((a, b) => b.local_date.localeCompare(a.local_date));
  let n = 0;
  for (const r of closed) {
    if (r.status === "off") continue;
    if (r.status === "passed" || r.status === "perfect") n++;
    else break;
  }
  return n;
}

/** Share of scheduled (non-off) closed days that passed, within [from, to]. Null when nothing was scheduled. */
export function consistency(results: { local_date: string; status: string }[], from: string, to: string): { pct: number | null; passed: number; scheduled: number } {
  const inRange = results.filter((r) => r.local_date >= from && r.local_date <= to && r.status !== "off");
  const passed = inRange.filter((r) => r.status === "passed" || r.status === "perfect").length;
  return { pct: inRange.length ? passed / inRange.length : null, passed, scheduled: inRange.length };
}
