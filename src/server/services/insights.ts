import { objectionsOf } from "@/domain/calls";
import { z } from "zod";
import { childId } from "@/lib/ids";
import { ACTIVITY_LABELS, FOUNDERS, MARKETS, METRICS, OBJECTION_LABELS, OFFER_LABELS, STAGES, STAGE_LABELS, type ActivityType, type FounderKey, type Metric, type WorkMode } from "@/domain/constants";
import { dedupeEvents, funnelCounts, isOutreach, METRIC_OF_TYPE, newBusinessesContacted, tallyDay } from "@/domain/activity";
import { nextBestActions, TIER_LABEL } from "@/domain/nba";
import { deriveNotifications } from "@/domain/notifications";
import { hygieneFlags, isOpen } from "@/domain/pipeline";
import { outreachBlock } from "@/domain/suppression";
import { todaysTasks, isOverdue } from "@/domain/tasks";
import { addDays, localDate, startOfWeek, weekday } from "@/domain/time";
import type { AppContext } from "../context";
import { numSetting, offerDefaults, settingValue, stageProbabilities, userRow } from "./common";
import { conversionByChannel, dealValue } from "@/domain/conversion";
import { fridayRules } from "@/domain/friday";
import { channelOf, minutesFor } from "@/domain/funnels";
import { MINUTES_PER_ACTION_SEED } from "@/domain/seeds";
import { resolveMode, resolveTargets } from "@/domain/targets";

import { activeSprint, sprintProgress } from "./sprints";
import { planFor } from "./results";
import { listTasks } from "./tasks";
import { upcomingEvents } from "./agenda";
import { deliveryAttention } from "./delivery";

const today = async (ctx: AppContext, f: FounderKey, now = new Date()) => localDate(now, (await userRow(ctx.repo, f)).timezone);

async function blockedAccounts(ctx: AppContext) {
  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList"]);
  const blocked = new Set<string>();
  for (const a of t.Accounts.rows) {
    if (outreachBlock(null, a, t.SuppressionList.rows).blocked) blocked.add(a.id);
    const contacts = t.Contacts.rows.filter((c) => c.account_id === a.id);
    if (contacts.length && contacts.every((c) => outreachBlock(c, a, t.SuppressionList.rows).blocked)) blocked.add(a.id);
  }
  return blocked;
}

export async function nba(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const t = await ctx.repo.listMany(["Accounts", "Opportunities", "ActivityEvents"]);
  const staleDays = Number(await settingValue(ctx.repo, "hot_lead_stale_days")) || 5;
  const sprint = await activeSprint(ctx);
  const items = nextBestActions({
    founder, today: await today(ctx, founder, now), accounts: t.Accounts.rows, opps: t.Opportunities.rows, events: dedupeEvents(t.ActivityEvents.rows),
    blockedAccountIds: await blockedAccounts(ctx), staleDays, sprintNiche: sprint?.niche || null, limit: 15,
  });
  return items.map((i) => ({ ...i, tierLabel: TIER_LABEL[i.tier] }));
}

export async function notifications(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const t = await ctx.repo.listMany(["Opportunities", "Accounts", "IntegrationStatuses", "NotificationStates"]);
  const tasks = await listTasks(ctx, founder);
  const dismissed = new Set(t.NotificationStates.rows.filter((n) => n.founder_key === founder).map((n) => n.dedupe_key));
  const base = deriveNotifications({
    founder, today: await today(ctx, founder, now), opps: t.Opportunities.rows, accountName: new Map(t.Accounts.rows.map((a) => [a.id, a.name])),
    tasks, integrations: t.IntegrationStatuses.rows, dismissed,
  });
  // Delivery alerts (Stage 2B) for the projects this founder owns (or nobody owns).
  const delivery = (await deliveryAttention(ctx, founder, now)).filter((a) => (!a.owner || a.owner === founder) && !dismissed.has(a.key)).map((a) => ({ key: a.key, kind: "task" as const, title: a.title, detail: a.detail, href: a.href }));
  return [...base, ...delivery];
}

export const dismissSchema = z.object({ key: z.string().min(1).max(200) });
export async function dismissNotification(ctx: AppContext, founder: FounderKey, key: string) {
  const id = childId("notif", founder, key);
  if (await ctx.repo.get("NotificationStates", id, { fresh: true })) return { ok: true };
  await ctx.repo.insert("NotificationStates", [{ id, founder_key: founder, dedupe_key: key, dismissed_at: new Date().toISOString() }], { founder });
  return { ok: true };
}

/** Weekly target for new businesses: sprint pace if a sprint is active, else daily targets × scheduled days. */
async function weeklyNewBusinessTarget(ctx: AppContext, weekStart: string) {
  const sprint = await activeSprint(ctx);
  const t = await ctx.repo.listMany(["DailyPlans", "WorkModes", "DailyTargets", "Users", "ActivityEvents", "Opportunities", "DailyReviews", "DailyResults", "DailyResultCorrections"]);
  let total = 0;
  for (const f of FOUNDERS) {
    if (sprint?.targets[f]) {
      const days = Math.max(1, Math.round((Date.parse(sprint.end_date) - Date.parse(sprint.start_date)) / 86_400_000) + 1);
      total += Math.round((sprint.targets[f].contacted * 7) / days);
      continue;
    }
    const u = t.Users.rows.find((x) => x.founder_key === f);
    if (!u) continue;
    for (let d = weekStart; d < addDays(weekStart, 7); d = addDays(d, 1)) total += planFor(t, u, f, d)?.targets.new_businesses?.target ?? 0;
  }
  return { target: total, basis: sprint ? "sprint pace" : "daily targets" };
}

export async function commandCenter(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const td = await today(ctx, founder, now);
  const week = startOfWeek(td);
  const t = await ctx.repo.listMany(["Opportunities", "Accounts", "ActivityEvents", "IntegrationStatuses", "BankBalances", "RevenueSnapshots"]);
  const probs = await stageProbabilities(ctx.repo);
  // Pipeline value: the deal's value, else its offer's default (Consulting value / Local monthly price), brief round 8.
  const defaults = await offerDefaults(ctx.repo);
  const val = (o: { value_minor: number | null; brand: string }) => dealValue(o, defaults);
  const eur = t.BankBalances.rows.filter((b) => !b.is_archived && b.bank === "wise" && b.currency === "EUR");
  const cash = eur.length ? eur.reduce((a, b) => a + b.amount_minor, 0) : null;
  const mrrSnap = t.RevenueSnapshots.rows.filter((r) => !r.is_archived && r.currency === "EUR").sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  const events = dedupeEvents(t.ActivityEvents.rows);
  const open = t.Opportunities.rows.filter(isOpen);
  const weighted = Math.round(open.reduce((s, o) => s + val(o) * probs[o.stage], 0));
  const contacted = newBusinessesContacted(events, null, week, addDays(week, 6)).length;
  const nbTarget = await weeklyNewBusinessTarget(ctx, week);
  const upcoming = await upcomingEvents(ctx, founder, now, 7);
  const tasks = await listTasks(ctx, founder);
  const name = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));

  const attention: { title: string; detail: string; href: string }[] = [];
  for (const task of tasks.filter((x) => isOverdue(x, td) && (x.priority === "P0" || x.priority === "P1"))) attention.push({ title: `Overdue ${task.priority}: ${task.title}`, detail: `${task.owner ? task.owner : "Unassigned"} · due ${task.due_at}`, href: "/tasks" });
  for (const o of open.filter((o) => o.next_action_due && o.next_action_due < td)) attention.push({ title: `Follow-up overdue: ${name.get(o.account_id) ?? o.name}`, detail: `${o.next_action || "Follow up"} · due ${o.next_action_due}`, href: `/crm?account=${o.account_id}` });
  const noNext = open.filter((o) => hygieneFlags(o, td).includes("No next action with a date"));
  if (noNext.length) attention.push({ title: `${noNext.length} deal(s) without a dated next step`, detail: "Every open deal needs one", href: "/crm" });
  for (const s of t.IntegrationStatuses.rows.filter((s) => s.status === "error")) attention.push({ title: `${s.integration} sync failed`, detail: s.last_error, href: "/settings" });
  // Delivery (Stage 2B): overdue milestones, unassigned project tasks, potential negative margin, contractor over capacity.
  for (const a of await deliveryAttention(ctx, founder, now)) attention.push({ title: a.title, detail: a.detail, href: a.href });

  const sevenDays = addDays(td, -6);
  const perFounder = Object.fromEntries(FOUNDERS.map((f) => {
    const mine = events.filter((e) => e.founder_key === f && e.local_date >= week);
    const byMetric = Object.fromEntries(METRICS.filter((m) => m !== "new_businesses").map((m) => [m, mine.filter((e) => METRIC_OF_TYPE[e.activity_type] === m).length]));
    return [f, { byMetric, newBusinesses: newBusinessesContacted(events, f, week, addDays(week, 6)).length, funnel: funnelCounts(events, f, week, addDays(week, 6)) }];
  }));
  const market = Object.fromEntries(MARKETS.map((m) => [m, funnelCounts(events.filter((e) => e.market === m), null, week, addDays(week, 6))]));
  const brands = Object.fromEntries(["local", "consulting", "thirty"].map((b) => [b, events.filter((e) => e.brand === b && e.local_date >= week && isOutreach(e.activity_type)).length]));
  const byStage = STAGES.filter((s) => s !== "lost").map((s) => ({ stage: s, label: STAGE_LABELS[s], count: t.Opportunities.rows.filter((o) => !o.is_archived && o.stage === s).length, valueMinor: t.Opportunities.rows.filter((o) => !o.is_archived && o.stage === s).reduce((a, o) => a + val(o), 0) }));
  const monthStart = td.slice(0, 8) + "01";
  const wonThisMonth = t.Opportunities.rows.filter((o) => o.stage === "won" && o.updated_at.slice(0, 10) >= monthStart);

  return {
    today: td,
    weekStart: week,
    now: {
      // Exactly five primary numbers (spec 5.1 / scenario 23). Finance figures are Stage 3: shown as not tracked, never as 0.
      numbers: [
        cash === null
          ? { key: "cash", label: "Cash balance", value: null as number | null, display: "Not tracked yet", note: "Connect Wise in Money" }
          : { key: "cash", label: "Cash balance", value: cash as number | null, display: null as string | null, note: "Wise, EUR balances", money: true },
        mrrSnap
          ? { key: "mrr", label: "MRR", value: mrrSnap.mrr_minor as number | null, display: null as string | null, note: "Stripe, {n} active subscriptions".replace("{n}", String(mrrSnap.active_subscriptions)), money: true }
          : { key: "mrr", label: "MRR", value: null as number | null, display: "Not tracked yet", note: "Connect Stripe in Money" },
        { key: "weighted", label: "Weighted pipeline", value: weighted, display: null as string | null, note: `${open.length} open deals × stage probability`, money: true },
        { key: "contacted", label: "New businesses this week", value: contacted, display: null, note: nbTarget.target ? `target ${nbTarget.target} (${nbTarget.basis})` : "no weekly target set", target: nbTarget.target },
        { key: "meetings", label: "Meetings, next 7 days", value: upcoming.available ? upcoming.events.filter((e) => e.kind === "shared").length : null, display: upcoming.available ? null : "Calendar not connected", note: upcoming.available ? "on the shared Valemont calendar" : "Add calendars in Settings › Calendars" },
      ],
      attention: attention.slice(0, 5),
      attentionTotal: attention.length,
      sprint: await sprintProgress(ctx),
      nextEvents: upcoming.events.slice(0, 3),
    },
    sales: { perFounder, market, brands, byStage, sinceLabel: `Week of ${week}`, last7From: sevenDays },
    money: {
      pipelineValue: open.reduce((s, o) => s + val(o), 0),
      weighted,
      wonThisMonth: { count: wonThisMonth.length, valueMinor: wonThisMonth.reduce((s, o) => s + val(o), 0) },
      byStage,
      notTracked: ["Revenue recognized", "Cash collected", "Operating expenses", "Gross profit", "Estimated EBITDA", "Cash balance", "MRR", "ARR"],
    },
  };
}

/* ---------------- weekly review ---------------- */

export const weeklySchema = z.object({ week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), decisions: z.string().trim().max(4_000).default(""), notes: z.string().trim().max(4_000).default(""), priority_theo: z.string().trim().max(300).default(""), priority_pablo: z.string().trim().max(300).default(""), worked: z.string().trim().max(4_000).default(""), blocked: z.string().trim().max(4_000).default("") });

export async function weeklyReview(ctx: AppContext, founder: FounderKey, weekStart?: string, now = new Date()) {
  const td = await today(ctx, founder, now);
  const week = weekStart ? startOfWeek(weekStart) : startOfWeek(td);
  const end = addDays(week, 6);
  const t = await ctx.repo.listMany(["ActivityEvents", "DailyPlans", "WorkModes", "DailyTargets", "Users", "DailyResults", "WeeklyReviews", "FounderPointItems", "FounderPoints", "Opportunities", "DailyReviews", "DailyResultCorrections", "Accounts", "TrafficDaily", "OpportunityStageEvents"]);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const perFounder = Object.fromEntries(FOUNDERS.map((f) => {
    const u = t.Users.rows.find((x) => x.founder_key === f)!;
    const target: Partial<Record<Metric, number>> = {};
    const actual: Partial<Record<Metric, number>> = {};
    for (let d = week; d <= end && d <= td; d = addDays(d, 1)) {
      const plan = planFor(t, u, f, d);
      const tally = tallyDay(events, f, d);
      for (const m of METRICS) {
        target[m] = (target[m] ?? 0) + (plan?.is_workday ? plan.targets[m]?.target ?? 0 : 0);
        actual[m] = (actual[m] ?? 0) + tally[m];
      }
    }
    const days = t.DailyResults.rows.filter((r) => r.founder_key === f && r.local_date >= week && r.local_date <= end);
    return [f, { target, actual, funnel: funnelCounts(events, f, week, end), passed: days.filter((d) => d.status === "passed" || d.status === "perfect").length, scheduled: days.filter((d) => d.status !== "off").length }];
  }));
  const objections = new Map<string, number>();
  for (const e of events.filter((e) => e.local_date >= week && e.local_date <= end)) {
    for (const o of objectionsOf(e)) {
      const key = `${OBJECTION_LABELS[o as keyof typeof OBJECTION_LABELS] ?? o}${e.market ? ` (${e.market})` : ""}`;
      objections.set(key, (objections.get(key) ?? 0) + 1);
    }
  }
  const pointsThisWeek = new Set(t.FounderPoints.rows.filter((p) => p.start_at && p.start_at.slice(0, 10) >= week && p.start_at.slice(0, 10) <= end).map((p) => p.id));
  const decisions = t.FounderPointItems.rows.filter((i) => i.kind === "decision" && (pointsThisWeek.has(i.point_id) || (i.created_at.slice(0, 10) >= week && i.created_at.slice(0, 10) <= end)));
  const saved = t.WeeklyReviews.rows.find((w) => w.id === childId("weekly", week)) ?? null;

  // KPI targets (brief round 8): per founder qualified conversations per workday and qualified meetings per week;
  // team new contacts = the sum of the daily new-business targets over the week's workdays (a theoretical volume).
  const perDay = await numSetting(ctx.repo, "kpi_qualified_conversations_per_workday", 1);
  const perWeek = await numSetting(ctx.repo, "kpi_qualified_meetings_per_week", 2);
  const kpi = { qualified: 0, qualifiedTarget: 0, meetingsTarget: 0, contactsTheoretical: 0 };
  for (const f of FOUNDERS) {
    const u = t.Users.rows.find((x) => x.founder_key === f);
    let workdays = 0;
    for (let d = week; d <= end; d = addDays(d, 1)) {
      const mode = resolveMode(t.WorkModes.rows, f, d) as WorkMode | null;
      if (!mode || mode === "DAY_OFF" || mode === "VACATION" || !u?.workdays.includes(weekday(d))) continue;
      workdays++;
      kpi.contactsTheoretical += resolveTargets(t.DailyTargets.rows, f, mode, d).new_businesses.target;
    }
    kpi.qualifiedTarget += perDay * workdays;
    if (workdays) kpi.meetingsTarget += perWeek;
  }
  const inWeek = events.filter((e) => e.local_date >= week && e.local_date <= end);
  kpi.qualified = inWeek.filter((e) => e.activity_type === "qualified_conversation").length;

  // Friday review rules, highlighted from this week's numbers.
  const conversion = conversionByChannel({ events: t.ActivityEvents.rows, opps: t.Opportunities.rows, stageEvents: t.OpportunityStageEvents.rows, from: week, to: end, offerDefaults: await offerDefaults(ctx.repo) });
  const hours = { phone: 0, linkedin: 0 };
  for (const e of inWeek) { const ch = channelOf(e); if (ch === "phone" || ch === "linkedin") hours[ch] += minutesFor(e, MINUTES_PER_ACTION_SEED) / 60; }
  const nicheOf = new Map(t.Accounts.rows.map((a) => [a.id, a.niche.trim()]));
  const niches = new Map<string, { contacts: Set<string>; conversations: Set<string> }>();
  for (const e of inWeek) {
    const niche = nicheOf.get(e.account_id);
    if (!niche) continue;
    const n = niches.get(niche) ?? { contacts: new Set(), conversations: new Set() };
    if (isOutreach(e.activity_type)) n.contacts.add(e.account_id);
    if (e.activity_type === "qualified_conversation" || e.activity_type === "reply" || ["conversation", "interested", "callback_requested", "meeting_booked", "met_owner"].includes(e.outcome ?? "")) n.conversations.add(e.account_id);
    niches.set(niche, n);
  }
  const monthAgo = addDays(end, -29);
  const wonIds = new Set(t.OpportunityStageEvents.rows.filter((x) => x.to_stage === "won" && x.changed_at.slice(0, 10) >= monthAgo && x.changed_at.slice(0, 10) <= end).map((x) => x.opportunity_id));
  const won = t.Opportunities.rows.filter((o) => wonIds.has(o.id));
  const traffic = t.TrafficDaily.rows.filter((r) => !r.is_archived && r.brand === "thirty" && r.date >= week && r.date <= end);
  const friday = fridayRules({
    conversion, hours,
    seriousLocalRequests: t.Opportunities.rows.filter((o) => !o.is_archived && o.brand === "local" && isOpen(o) && ["discovery_scheduled", "qualified", "demo_shown", "proposal_sent", "negotiation"].includes(o.stage)).length,
    thirty: { visits: traffic.reduce((a, r) => a + (r.sessions ?? 0), 0), purchases: traffic.reduce((a, r) => a + (r.purchases ?? 0), 0) },
    niches: [...niches.entries()].map(([niche, n]) => ({ niche, contacts: n.contacts.size, conversations: n.conversations.size })),
    wonByOffer: (["consulting", "local"] as const).map((o) => ({ offer: OFFER_LABELS[o], won: won.filter((x) => (x.brand === "local" ? "local" : "consulting") === o).length })),
    minSample: Number(await settingValue(ctx.repo, "conversion_min_sample")) || 20,
  });
  return {
    weekStart: week, weekEnd: end, perFounder, kpi, friday,
    topObjections: [...objections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({ label, count })),
    decisions: decisions.map((d) => ({ id: d.id, text: d.text, at: d.created_at })),
    saved,
  };
}

export async function saveWeekly(ctx: AppContext, founder: FounderKey, input: z.infer<typeof weeklySchema>) {
  const week = startOfWeek(input.week_start);
  const id = childId("weekly", week);
  const cur = await ctx.repo.get("WeeklyReviews", id, { fresh: true });
  const data = { ...input, week_start: week };
  if (cur) return ctx.repo.update("WeeklyReviews", id, cur.version, data, { founder });
  return (await ctx.repo.insert("WeeklyReviews", [{ id, ...data }], { founder }))[0];
}

/* ---------------- reports ---------------- */

const CHANNELS: ActivityType[] = ["cold_call", "connected_call", "voicemail", "field_visit", "linkedin_invitation", "linkedin_dm", "inmail", "cold_email", "follow_up"];

/** Weekly founder scorecard: outreach by channel and conversions with explicit denominators. */
export async function scorecard(ctx: AppContext, founder: FounderKey, weekStart?: string, now = new Date()) {
  const td = await today(ctx, founder, now);
  const week = weekStart ? startOfWeek(weekStart) : startOfWeek(td);
  const end = addDays(week, 6);
  const events = dedupeEvents((await ctx.repo.list("ActivityEvents")).rows).filter((e) => e.local_date >= week && e.local_date <= end);
  const minSample = Number(await settingValue(ctx.repo, "conversion_min_sample")) || 20;
  const rows = FOUNDERS.map((f) => {
    const mine = events.filter((e) => e.founder_key === f);
    const byChannel = CHANNELS.map((c) => ({ channel: c, label: ACTIVITY_LABELS[c], count: mine.filter((e) => e.activity_type === c).length }));
    const fn = funnelCounts(mine, f, week, end);
    const rate = (num: number, den: number) => ({ num, den, pct: den >= minSample ? num / den : null });
    return {
      founder: f, byChannel, funnel: fn,
      conversion: { conversationsPerAttempt: rate(fn.conversations, fn.attempted), demosPerConversation: rate(fn.demos, fn.conversations), meetingsPerConversation: rate(fn.meetingsBooked, fn.conversations), salesPerProposal: rate(fn.sales, fn.proposals) },
    };
  });
  return { weekStart: week, weekEnd: end, minSample, rows };
}

export async function scorecardCsv(ctx: AppContext, founder: FounderKey, weekStart?: string) {
  const s = await scorecard(ctx, founder, weekStart);
  const lines = [["Founder", "Metric", "Value"].map((x) => `"${x}"`).join(",")];
  for (const r of s.rows) {
    for (const c of r.byChannel) lines.push([r.founder, c.label, String(c.count)].map((x) => `"${x}"`).join(","));
    for (const [k, v] of Object.entries(r.funnel)) lines.push([r.founder, k, String(v)].map((x) => `"${x}"`).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export { todaysTasks };
