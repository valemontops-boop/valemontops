import { LOCALE_OF, tFor } from "@/i18n";
import { z } from "zod";
import type { DataRepository } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import { childId, newId } from "@/lib/ids";
import {
  ACTIVITY_LABELS, METRICS, METRIC_LABELS, STAGE_LABELS, WORK_MODES, type ActivityType, type FounderKey, type Metric,
  type WorkMode, FOUNDER_NAMES,
} from "@/domain/constants";
import { dedupeEvents, funnelCounts, newBusinessesContacted, tallyDay, type Tally } from "@/domain/activity";
import { effectiveFromForEdit, feasibility, resolveMode, resolveTargets, weightedAttainment, type TargetSet } from "@/domain/targets";
import { addDays, cutoffOf, localDate, startOfWeek, weekday } from "@/domain/time";
import { isOpen } from "@/domain/pipeline";
import { formatWhatsAppReport } from "@/domain/report";
import { CAPACITY_SEED_MINUTES, MINUTES_PER_ACTION_SEED, linkedinCap, seedTargetsFor } from "@/domain/seeds";
import { contentBrandOf } from "@/domain/content";
import { numSetting, userRow } from "./common";
import { callStats } from "@/domain/calls";

function earliest<R extends { created_at: string; id: string }>(rows: R[]): R | undefined {
  return [...rows].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1))[0];
}

const OFF_MODES: WorkMode[] = ["DAY_OFF", "VACATION"];

/** Today's plan snapshot, written lazily on first read of the day (D009). Earliest row wins on a race. */
export async function ensureDailyPlan(repo: DataRepository, founder: FounderKey, today: string): Promise<Row<"DailyPlans"> | null> {
  const t = await repo.listMany(["DailyPlans", "WorkModes", "DailyTargets", "Users"]);
  const existing = earliest(t.DailyPlans.rows.filter((p) => p.founder_key === founder && p.local_date === today));
  if (existing) return existing;
  const user = t.Users.rows.find((u) => u.founder_key === founder)!;
  const mode = resolveMode(t.WorkModes.rows, founder, today);
  if (!mode) return null; // onboarding: no mode chosen, no plan, no penalty
  const targets = resolveTargets(t.DailyTargets.rows, founder, mode, today);
  const isWorkday = user.workdays.includes(weekday(today)) && !OFF_MODES.includes(mode);
  const [row] = await repo.insert(
    "DailyPlans",
    [{
      id: childId("plan", founder, today),
      founder_key: founder,
      local_date: today,
      timezone: user.timezone,
      mode,
      is_workday: isWorkday,
      capacity_minutes: user.capacity_minutes,
      targets: isWorkday ? targets : {},
    }],
    { founder },
  );
  return row;
}

export interface FollowUp {
  key: string;
  accountId: string;
  accountName: string;
  opportunityId: string | null;
  opportunityVersion: number | null;
  action: string;
  due: string;
  overdue: boolean;
  priority: "high" | "normal";
  phone: string;
  why: string;
}

export interface MyDay {
  founder: FounderKey;
  founderName: string;
  timezone: string;
  today: string;
  cutoffAt: string;
  mode: WorkMode | null;
  isWorkday: boolean;
  planLocked: boolean;
  targets: TargetSet | null;
  tally: Tally;
  attainment: number | null;
  feasibility: ReturnType<typeof feasibility> | null;
  capacityMinutes: number;
  followUps: FollowUp[];
  todayEvents: { id: string; type: ActivityType; label: string; accountName: string; occurredAt: string; outcome: string | null; lateLogged: boolean }[];
  nextAction: { kind: "follow_up" | "metric" | "onboarding" | "done"; title: string; detail: string; followUp?: FollowUp; metric?: Metric };
  byType: Partial<Record<ActivityType, number>>;
  calls: ReturnType<typeof callStats>;
  /** LinkedIn limits take priority over targets: set when today's invitation target was lowered to the limit. */
  linkedinCap: { planned: number; shown: number } | null;
}

export async function getMyDay(repo: DataRepository, founder: FounderKey, now = new Date()): Promise<MyDay> {
  const user = await userRow(repo, founder);
  const today = localDate(now, user.timezone);
  const plan = await ensureDailyPlan(repo, founder, today);
  const t = await repo.listMany(["ActivityEvents", "Accounts", "Opportunities", "WorkModes"]);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const tally = tallyDay(events, founder, today);
  const accountName = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));
  const accountPhone = new Map(t.Accounts.rows.map((a) => [a.id, a.phone]));
  const mode = plan?.mode ?? resolveMode(t.WorkModes.rows, founder, today);
  let targets = plan && plan.is_workday ? fillTargets(plan.targets) : null;
  let capInfo: MyDay["linkedinCap"] = null;
  if (targets && targets.invitations.target > 0) {
    const limits = { daily: await numSetting(repo, "linkedin_daily_invitation_limit", 20), weekly: await numSetting(repo, "linkedin_weekly_invitation_limit", 100) };
    const week = startOfWeek(today);
    const sentBefore = events.filter((e) => e.founder_key === founder && e.activity_type === "linkedin_invitation" && e.local_date >= week && e.local_date < today).length;
    const c = linkedinCap(targets.invitations.target, limits, sentBefore);
    if (c.capped) {
      capInfo = { planned: targets.invitations.target, shown: c.target };
      targets = { ...targets, invitations: { ...targets.invitations, target: c.target } };
    }
  }

  // Follow-ups: opportunity next actions owned by this founder, then event next actions not superseded by a later touch.
  const followUps: FollowUp[] = [];
  const covered = new Set<string>();
  for (const o of t.Opportunities.rows) {
    if (!isOpen(o) || !o.next_action_due || o.next_action_due > today) continue;
    if (o.owner_founder && o.owner_founder !== founder) continue;
    covered.add(o.account_id);
    followUps.push({
      key: `opp:${o.id}`,
      accountId: o.account_id,
      accountName: accountName.get(o.account_id) ?? "Unknown business",
      opportunityId: o.id,
      opportunityVersion: o.version,
      action: o.next_action || "Follow up",
      due: o.next_action_due,
      overdue: o.next_action_due < today,
      priority: o.next_action_priority === "high" ? "high" : "normal",
      phone: accountPhone.get(o.account_id) ?? "",
      why: o.next_action_due < today ? `Overdue since ${o.next_action_due} · ${STAGE_LABELS[o.stage]}` : `Due today · ${STAGE_LABELS[o.stage]}`,
    });
  }
  const latestByAccount = new Map<string, (typeof events)[number]>();
  for (const e of events) if (e.account_id) latestByAccount.set(e.account_id, e); // events sorted by occurred_at
  for (const [acc, e] of latestByAccount) {
    if (covered.has(acc) || e.founder_key !== founder || !e.next_action_due || e.next_action_due > today) continue;
    followUps.push({
      key: `evt:${e.id}`,
      accountId: acc,
      accountName: accountName.get(acc) ?? "Unknown business",
      opportunityId: null,
      opportunityVersion: null,
      action: e.next_action || "Follow up",
      due: e.next_action_due,
      overdue: e.next_action_due < today,
      priority: "normal",
      phone: accountPhone.get(acc) ?? "",
      why: `From your ${ACTIVITY_LABELS[e.activity_type].toLowerCase()} on ${e.local_date}`,
    });
  }
  followUps.sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || Number(b.overdue) - Number(a.overdue) || a.due.localeCompare(b.due));

  const todays = events.filter((e) => e.founder_key === founder && e.local_date === today).reverse();
  const byType: Partial<Record<ActivityType, number>> = {};
  for (const e of todays) byType[e.activity_type] = (byType[e.activity_type] ?? 0) + 1;

  let nextAction: MyDay["nextAction"];
  if (!mode) nextAction = { kind: "onboarding", title: "Choose today's work mode", detail: "Targets are set from your mode. Nothing is counted against you until you choose." };
  else if (followUps[0]) nextAction = { kind: "follow_up", title: followUps[0].action, detail: `${followUps[0].accountName} · ${followUps[0].why}`, followUp: followUps[0] };
  else {
    const gaps = targets
      ? METRICS.filter((m) => targets[m].target > 0).map((m) => ({ m, left: targets[m].target - tally[m], ratio: tally[m] / targets[m].target })).filter((x) => x.left > 0).sort((a, b) => a.ratio - b.ratio)
      : [];
    nextAction = gaps[0]
      ? { kind: "metric", title: `${METRIC_LABELS[gaps[0].m]}: ${gaps[0].left} to go`, detail: "Furthest behind today's target.", metric: gaps[0].m }
      : { kind: "done", title: plan?.is_workday ? "Today's targets are met" : "Not a scheduled workday", detail: plan?.is_workday ? "Anything you log now is extra." : "Nothing is expected today. Logged activity still counts in the CRM." };
  }

  return {
    founder,
    founderName: FOUNDER_NAMES[founder],
    timezone: user.timezone,
    today,
    cutoffAt: cutoffOf(today, user.timezone).toISOString(),
    mode,
    isWorkday: Boolean(plan?.is_workday),
    planLocked: Boolean(plan),
    targets,
    tally,
    attainment: targets ? weightedAttainment(targets, tally) : null,
    feasibility: targets ? feasibility(targets, plan!.capacity_minutes) : null,
    capacityMinutes: plan?.capacity_minutes ?? user.capacity_minutes,
    followUps,
    todayEvents: todays.map((e) => ({
      id: e.id, type: e.activity_type, label: ACTIVITY_LABELS[e.activity_type], accountName: accountName.get(e.account_id) ?? "",
      occurredAt: e.occurred_at, outcome: e.outcome, lateLogged: e.late_logged,
    })),
    nextAction,
    byType,
    calls: callStats(todays, user.timezone),
    linkedinCap: capInfo,
  };
}

function fillTargets(t: Row<"DailyPlans">["targets"]): TargetSet {
  const out = {} as TargetSet;
  for (const m of METRICS) out[m] = t[m] ?? { target: 0, weight: 1, minutes: MINUTES_PER_ACTION_SEED[m] };
  return out;
}

/* ---------------- mode, targets, profile ---------------- */

export const setModeSchema = z.object({ mode: z.enum(WORK_MODES), reason: z.string().trim().max(300).default("") });

export async function setMode(repo: DataRepository, founder: FounderKey, input: z.infer<typeof setModeSchema>, now = new Date()) {
  const user = await userRow(repo, founder);
  const today = localDate(now, user.timezone);
  const t = await repo.listMany(["DailyPlans", "DailyTargets"], { fresh: true });
  const planToday = t.DailyPlans.rows.some((p) => p.founder_key === founder && p.local_date === today);
  const effective = effectiveFromForEdit(today, planToday, addDays(today, 1));
  await repo.insert("WorkModes", [{ id: newId(), founder_key: founder, mode: input.mode, effective_from: effective, reason: input.reason }], { founder });
  // CUSTOM (or any mode without rows yet) starts from zero targets the founder then edits.
  const hasRows = t.DailyTargets.rows.some((r) => r.founder_key === founder && r.mode === input.mode);
  if (!hasRows && !OFF_MODES.includes(input.mode)) {
    await repo.insert(
      "DailyTargets",
      seedTargetsFor(founder, input.mode).map(({ metric, target }) => ({
        id: childId("target-seed", founder, input.mode, metric), founder_key: founder, mode: input.mode, metric, target, weight: 1,
        minutes_per_action: MINUTES_PER_ACTION_SEED[metric], effective_from: "2000-01-01",
      })),
      { founder },
    );
  }
  if (!user.onboarded_at) {
    await repo.update("Users", user.id, user.version, { onboarded_at: now.toISOString(), capacity_minutes: CAPACITY_SEED_MINUTES[input.mode] || user.capacity_minutes }, { founder });
  }
  return { effectiveFrom: effective, appliesToday: effective === today };
}

export const setTargetsSchema = z.object({
  mode: z.enum(WORK_MODES),
  targets: z.partialRecord(z.enum(METRICS), z.object({ target: z.number().int().min(0).max(500), weight: z.number().int().min(0).max(10), minutes: z.number().int().min(0).max(240) })),
});

export async function setTargets(repo: DataRepository, founder: FounderKey, input: z.infer<typeof setTargetsSchema>, now = new Date()) {
  const user = await userRow(repo, founder);
  const today = localDate(now, user.timezone);
  const t = await repo.listMany(["DailyPlans", "DailyTargets"], { fresh: true });
  const planToday = t.DailyPlans.rows.some((p) => p.founder_key === founder && p.local_date === today);
  const effective = effectiveFromForEdit(today, planToday, addDays(today, 1));
  const current = resolveTargets(t.DailyTargets.rows, founder, input.mode, effective);
  const rows = (Object.entries(input.targets) as [Metric, { target: number; weight: number; minutes: number }][])
    .filter(([m, v]) => current[m].target !== v.target || current[m].weight !== v.weight || current[m].minutes !== v.minutes)
    .map(([metric, v]) => ({ id: newId(), founder_key: founder, mode: input.mode, metric, target: v.target, weight: v.weight, minutes_per_action: v.minutes, effective_from: effective }));
  if (rows.length) await repo.insert("DailyTargets", rows, { founder });
  return { changed: rows.length, effectiveFrom: effective, appliesToday: effective === today };
}

export async function getTargetsForEdit(repo: DataRepository, founder: FounderKey, mode: WorkMode, now = new Date()) {
  const user = await userRow(repo, founder);
  const today = localDate(now, user.timezone);
  const t = await repo.listMany(["DailyPlans", "DailyTargets", "WorkModes"]);
  const planToday = t.DailyPlans.rows.some((p) => p.founder_key === founder && p.local_date === today);
  const effective = effectiveFromForEdit(today, planToday, addDays(today, 1));
  return {
    mode,
    currentMode: resolveMode(t.WorkModes.rows, founder, today),
    nextMode: resolveMode(t.WorkModes.rows, founder, addDays(today, 1)),
    effectiveFrom: effective,
    appliesToday: effective === today,
    targets: resolveTargets(t.DailyTargets.rows, founder, mode, effective),
    capacityMinutes: user.capacity_minutes,
  };
}

export const profileSchema = z.object({
  expected_version: z.number().int(),
  timezone: z.string().trim().min(1).max(60),
  workdays: z.array(z.number().int().min(0).max(6)).max(7),
  capacity_minutes: z.number().int().min(0).max(960),
  avail_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  avail_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/* ---------------- WhatsApp report ---------------- */

export async function whatsappReport(repo: DataRepository, founder: FounderKey, nextDayPriority: string, now = new Date()) {
  const day = await getMyDay(repo, founder, now);
  const t = await repo.listMany(["ActivityEvents", "ContentLog", "BankTransactions", "TrafficDaily", "RevenueSnapshots"]);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const today = day.today;
  const mine = funnelCounts(events, founder, today, today);
  const team = funnelCounts(events, null, today, today);
  const count = (type: ActivityType, who: FounderKey | null) => events.filter((e) => e.activity_type === type && e.local_date === today && (!who || e.founder_key === who)).length;
  const seen = new Set<string>();
  const content = t.ContentLog.rows.filter((c) => !c.is_archived && c.local_date === today && !seen.has(c.idempotency_key) && Boolean(seen.add(c.idempotency_key)));
  const revenue = t.BankTransactions.rows.filter((b) => !b.is_archived && b.date === today && b.direction === "credit" && b.category === "revenue" && b.currency === "EUR");
  const traffic = t.TrafficDaily.rows.filter((r) => !r.is_archived && r.date === today && r.brand === "thirty");
  const sumOrNull = (k: "sessions" | "purchases") => (traffic.some((r) => r[k] !== null) ? traffic.reduce((a, r) => a + (r[k] ?? 0), 0) : null);
  const snapshot = [...t.RevenueSnapshots.rows].filter((r) => !r.is_archived).sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)).at(-1);
  return formatWhatsAppReport({
    founderName: day.founderName,
    date: today,
    tally: day.tally,
    qualifiedConversations: count("qualified_conversation", founder),
    meetingsBooked: mine.meetingsBooked,
    proposalsSent: mine.proposals,
    postsPublished: content.filter((c) => c.founder_key === founder).length,
    cashCollectedMinor: revenue.reduce((a, b) => a + b.amount_minor, 0),
    nextDayPriority,
    // VAT is not recorded on bank movements yet, so revenue ex VAT stays "—" rather than a guess.
    valemont: { newContacts: newBusinessesContacted(events, null, today, today).length, qualifiedConversations: count("qualified_conversation", null), meetingsHeld: team.meetingsHeld, proposalsSent: team.proposals, revenueExVatMinor: null },
    thirty: { videosPublished: content.filter((c) => contentBrandOf(c.brand) === "thirty" && ["reel", "story"].includes(c.deliverable)).length, siteVisits: sumOrNull("sessions"), checkouts: null, reportsSold: sumOrNull("purchases") },
    local: { activeSubscriptions: snapshot ? snapshot.active_subscriptions : null, setupFeesMinor: null, aiUsage: null, marginAfterSupportMinor: null },
  }, tFor(LOCALE_OF[founder]));
}
