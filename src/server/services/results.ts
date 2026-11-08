import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { METRICS } from "@/domain/constants";
import { dedupeEvents, tallyDay } from "@/domain/activity";
import { consistency, currentStreak, evaluateDay, highPriorityFollowupsOk, type DayPlanLike } from "@/domain/streaks";
import { resolveMode, resolveTargets, weightedAttainment } from "@/domain/targets";
import { addDays, cutoffOf, localDate, weekday } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { userRow } from "./common";

const OFF = ["DAY_OFF", "VACATION"];
const LOOKBACK_DAYS = 60;

type Tables = Awaited<ReturnType<typeof load>>;
async function load(ctx: AppContext) {
  return ctx.repo.listMany(["DailyPlans", "WorkModes", "DailyTargets", "ActivityEvents", "Opportunities", "DailyReviews", "DailyResults", "DailyResultCorrections", "Users"]);
}

/** The day's plan: its snapshot if one was taken, otherwise reconstructed from append-only modes and targets. */
export function planFor(t: Tables, user: Row<"Users">, founder: string, date: string): DayPlanLike | null {
  const snaps = t.DailyPlans.rows.filter((p) => p.founder_key === founder && p.local_date === date).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  if (snaps[0]) return { is_workday: snaps[0].is_workday, targets: snaps[0].targets };
  const mode = resolveMode(t.WorkModes.rows, founder, date);
  if (!mode) return null;
  const isWorkday = user.workdays.includes(weekday(date)) && !OFF.includes(mode);
  return { is_workday: isWorkday, targets: isWorkday ? resolveTargets(t.DailyTargets.rows, founder, mode, date) : {} };
}

function evaluate(t: Tables, user: Row<"Users">, founder: string, date: string) {
  const corrections = t.DailyResultCorrections.rows.filter((c) => c.founder_key === founder && c.local_date === date);
  const included = new Set(corrections.flatMap((c) => c.event_ids));
  // Late-logged activity keeps its true date but changes a closed day only through an audited correction (spec 5.4).
  const events = dedupeEvents(t.ActivityEvents.rows).filter((e) => !e.late_logged || included.has(e.id));
  const tally = tallyDay(events, founder, date);
  const followupsOk = highPriorityFollowupsOk(t.Opportunities.rows.filter((o) => !o.owner_founder || o.owner_founder === founder), events, date);
  const reviewDone = t.DailyReviews.rows.some((r) => r.founder_key === founder && r.local_date === date);
  return { ...evaluateDay(planFor(t, user, founder, date), tally, followupsOk, reviewDone), corrections: corrections.length };
}

/** Writes DailyResults for closed days lazily on read (spec 4.6). Idempotent: deterministic ids, earliest row wins. */
export async function closeDays(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const user = await userRow(ctx.repo, founder);
  const today = localDate(now, user.timezone);
  const t = await load(ctx);
  const firstMode = t.WorkModes.rows.filter((m) => m.founder_key === founder).map((m) => (m.created_at.slice(0, 10) > m.effective_from ? m.created_at.slice(0, 10) : m.effective_from)).sort()[0];
  if (!firstMode) return [];
  const have = new Set(t.DailyResults.rows.filter((r) => r.founder_key === founder).map((r) => r.local_date));
  const rows = [];
  for (let d = [addDays(today, -LOOKBACK_DAYS), firstMode].sort()[1]; d < today; d = addDays(d, 1)) {
    if (have.has(d) || now < cutoffOf(d, user.timezone)) continue;
    const r = evaluate(t, user, founder, d);
    rows.push({
      id: childId("result", founder, d), founder_key: founder, local_date: d, status: r.status, attainment_pct: r.attainment === null ? null : Math.round(r.attainment * 100),
      followups_ok: r.followupsOk, review_done: r.reviewDone, computed_at: now.toISOString(), correction_count: 0,
    });
  }
  if (rows.length) await ctx.repo.insert("DailyResults", rows, { founder });
  return rows;
}

export async function streakSummary(ctx: AppContext, founder: FounderKey, now = new Date()) {
  await closeDays(ctx, founder, now);
  const user = await userRow(ctx.repo, founder);
  const today = localDate(now, user.timezone);
  const t = await load(ctx);
  const results = t.DailyResults.rows.filter((r) => r.founder_key === founder).sort((a, b) => a.local_date.localeCompare(b.local_date) || a.created_at.localeCompare(b.created_at));
  const byDate = new Map<string, (typeof results)[number]>();
  for (const r of results) if (!byDate.has(r.local_date)) byDate.set(r.local_date, r);
  const closed = [...byDate.values()];
  const todayEval = evaluate(t, user, founder, today);
  const todayPlan = planFor(t, user, founder, today);
  const days = [];
  for (let d = addDays(today, -29); d <= today; d = addDays(d, 1)) {
    const r = byDate.get(d);
    days.push({ date: d, status: d === today ? (todayPlan?.is_workday && todayEval.status !== "off" ? "in_progress" : "off") : (r?.status ?? "off"), attainment: d === today ? todayEval.attainment : r?.attainment_pct === null || r?.attainment_pct === undefined ? null : r.attainment_pct / 100 });
  }
  const late = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.founder_key === founder && e.late_logged);
  const correctable = [...new Set(late.map((e) => e.local_date))].filter((d) => byDate.has(d) && !t.DailyResultCorrections.rows.some((c) => c.founder_key === founder && c.local_date === d && late.filter((e) => e.local_date === d).every((e) => c.event_ids.includes(e.id))));
  return {
    today,
    cutoffAt: cutoffOf(today, user.timezone).toISOString(),
    streak: currentStreak(closed),
    c7: consistency(closed, addDays(today, -7), addDays(today, -1)),
    c30: consistency(closed, addDays(today, -30), addDays(today, -1)),
    days,
    todayStatus: { attainment: todayEval.attainment, reviewDone: todayEval.reviewDone, followupsOk: todayEval.followupsOk, wouldPass: todayEval.status === "passed" || todayEval.status === "perfect" },
    lateDaysToCorrect: correctable,
  };
}

export const reviewSchema = z.object({ went_well: z.string().trim().max(1_000).default(""), blockers: z.string().trim().max(1_000).default(""), tomorrow_priority: z.string().trim().min(1, "Write tomorrow's priority").max(300) });

/** End-of-day review for today (one per day; editing updates it). Required to pass the day. */
export async function saveReview(ctx: AppContext, founder: FounderKey, input: z.infer<typeof reviewSchema>, now = new Date()) {
  const user = await userRow(ctx.repo, founder);
  const today = localDate(now, user.timezone);
  const id = childId("review", founder, today);
  const cur = await ctx.repo.get("DailyReviews", id, { fresh: true });
  if (cur) return ctx.repo.update("DailyReviews", id, cur.version, input, { founder });
  const [row] = await ctx.repo.insert("DailyReviews", [{ id, founder_key: founder, local_date: today, ...input }], { founder });
  return row;
}

export async function getReview(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const user = await userRow(ctx.repo, founder);
  return ctx.repo.get("DailyReviews", childId("review", founder, localDate(now, user.timezone)));
}

export const correctionSchema = z.object({ local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5, "Give a reason").max(500) });

/** Audited correction: include late-logged activity in a closed day and recompute it (spec 5.4). */
export async function applyLateCorrection(ctx: AppContext, founder: FounderKey, input: z.infer<typeof correctionSchema>) {
  const user = await userRow(ctx.repo, founder);
  const t = await load(ctx);
  const result = t.DailyResults.rows.find((r) => r.id === childId("result", founder, input.local_date));
  if (!result) throw new RuleError("That day is not closed yet.");
  const late = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.founder_key === founder && e.local_date === input.local_date && e.late_logged);
  if (!late.length) throw new RuleError("No late activity on that day.");
  await ctx.repo.insert("DailyResultCorrections", [{ id: childId("correction", founder, input.local_date, ...late.map((e) => e.id).sort()), founder_key: founder, local_date: input.local_date, reason: input.reason, event_ids: late.map((e) => e.id) }], { founder });
  await ctx.repo.insert("AuditLog", [{ id: childId("audit-correction", founder, input.local_date, String(Date.now())), actor: founder, action: "day.correction", table_name: "DailyResults", record_id: result.id, fields: "status,attainment_pct", correlation_id: "" }], { founder });
  const t2 = await load(ctx);
  const r = evaluate(t2, user, founder, input.local_date);
  return ctx.repo.update("DailyResults", result.id, result.version, { status: r.status, attainment_pct: r.attainment === null ? null : Math.round(r.attainment * 100), followups_ok: r.followupsOk, review_done: r.reviewDone, computed_at: new Date().toISOString(), correction_count: result.correction_count + 1 }, { founder });
}

export { weightedAttainment, METRICS };
