import type { Metric, WorkMode } from "./constants";
import { METRICS } from "./constants";
import type { Tally } from "./activity";

export interface TargetSpec {
  target: number;
  weight: number;
  minutes: number;
}
export type TargetSet = Record<Metric, TargetSpec>;

interface Effective {
  effective_from: string;
  created_at: string;
}

function latestEffective<R extends Effective>(rows: R[], date: string): R | null {
  let best: R | null = null;
  for (const r of rows) {
    if (r.effective_from > date) continue;
    if (!best || r.effective_from > best.effective_from || (r.effective_from === best.effective_from && r.created_at > best.created_at)) best = r;
  }
  return best;
}

export function resolveMode<R extends Effective & { founder_key: string; mode: WorkMode }>(
  rows: R[],
  founder: string,
  date: string,
): WorkMode | null {
  return latestEffective(rows.filter((r) => r.founder_key === founder), date)?.mode ?? null;
}

export function resolveTargets<
  R extends Effective & { founder_key: string; mode: WorkMode; metric: Metric; target: number; weight: number; minutes_per_action: number },
>(rows: R[], founder: string, mode: WorkMode, date: string): TargetSet {
  const out = {} as TargetSet;
  for (const metric of METRICS) {
    const r = latestEffective(rows.filter((x) => x.founder_key === founder && x.mode === mode && x.metric === metric), date);
    out[metric] = { target: r?.target ?? 0, weight: r?.weight ?? 1, minutes: r?.minutes_per_action ?? 0 };
  }
  return out;
}

/**
 * Weighted attainment (spec 5.4): sum(weight × min(actual/target, 1)) / sum(weight) over targets > 0.
 * Returns null when there is no eligible target (no targets means no punishment).
 */
export function weightedAttainment(targets: Partial<Record<Metric, TargetSpec>>, actual: Partial<Tally>): number | null {
  let num = 0;
  let den = 0;
  for (const [metric, spec] of Object.entries(targets) as [Metric, TargetSpec][]) {
    if (!spec || spec.target <= 0 || spec.weight <= 0) continue;
    num += spec.weight * Math.min((actual[metric] ?? 0) / spec.target, 1);
    den += spec.weight;
  }
  return den === 0 ? null : num / den;
}

export interface Feasibility {
  plannedMinutes: number;
  capacityMinutes: number;
  overBy: number;
  feasible: boolean;
}

/** Planned time vs capacity using editable minutes per action (spec 5.3). */
export function feasibility(targets: Partial<Record<Metric, TargetSpec>>, capacityMinutes: number): Feasibility {
  let planned = 0;
  for (const spec of Object.values(targets)) if (spec) planned += spec.target * spec.minutes;
  return { plannedMinutes: planned, capacityMinutes, overBy: Math.max(0, planned - capacityMinutes), feasible: planned <= capacityMinutes };
}

/** Target edits are prospective: today only while today's plan snapshot does not exist yet (D008). */
export function effectiveFromForEdit(today: string, todayPlanExists: boolean, tomorrow: string): string {
  return todayPlanExists ? tomorrow : today;
}

/** Remaining actions per metric, never negative. */
export function remaining(targets: Partial<Record<Metric, TargetSpec>>, actual: Tally): Partial<Record<Metric, number>> {
  const out: Partial<Record<Metric, number>> = {};
  for (const [m, spec] of Object.entries(targets) as [Metric, TargetSpec][]) {
    if (spec.target > 0) out[m] = Math.max(0, spec.target - actual[m]);
  }
  return out;
}
