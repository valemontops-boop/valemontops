import { z } from "zod";
import ExcelJS from "exceljs";
import type { Row } from "@/data/repository";
import { ACTIVITY_LABELS, ACTIVITY_TYPES, FOUNDERS, FOUNDER_NAMES, OBJECTION_LABELS, OUTCOME_LABELS, STAGES, STAGE_LABELS, type FounderKey } from "@/domain/constants";
import { dedupeEvents, funnelCounts, newBusinessesContacted } from "@/domain/activity";
import { callStats, objectionsOf } from "@/domain/calls";
import { channelFunnels, CHANNEL_LABELS } from "@/domain/funnels";
import { dashboard } from "@/domain/dashboard";
import { growthVerdicts, moneyVerdicts, salesVerdicts, type Verdict } from "@/domain/verdicts";
import { CATEGORY_LABELS, NEUTRAL, isIncome, moneySummary, type BankCategory } from "@/domain/bank";
import { DELIVERABLE_LABELS } from "@/domain/content";
import { isOpen } from "@/domain/pipeline";
import { outreachBlock } from "@/domain/suppression";
import { MINUTES_PER_ACTION_SEED } from "@/domain/seeds";
import { localDate, startOfWeek } from "@/domain/time";
import { filterPeriod, inPeriod, isDay, major, periodDays, renderMarkdown, sheetName, sheetValue, type Cell, type ExportColumn, type ExportDoc, type ExportSection, type ExportTable } from "@/domain/export";
import { LOCALE_OF, tFor, type T } from "@/i18n";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { userRow } from "./common";
import { listTasks } from "./tasks";
import { pnlForExport } from "./finance";
import { COST_CENTERS, COST_CENTER_LABELS } from "@/domain/finance";

const day = z.string().refine(isDay, "Invalid date");
export const exportSchema = z.object({
  from: day,
  to: day,
  format: z.enum(["md", "xlsx"]).default("md"),
  scope: z.enum(["team", "me"]).default("team"),
});
export type ExportInput = z.infer<typeof exportSchema>;

const MAX_DAYS = 400;
const MAX_LOG_ROWS = 3_000;
const CALLS = ["cold_call", "connected_call", "voicemail"];
const YES = ["interested", "callback_requested", "meeting_booked"];

const col = (label: string, kind: ExportColumn["kind"] = "text"): ExportColumn => ({ label, kind });

/**
 * Everything over a period, read only through the repository, in the founder's language.
 * Privacy: no prospect phone numbers, emails or contact names; opted-out businesses are not named;
 * the other founder's private tasks are never read (listTasks reads only the requester's own spreadsheet).
 */
export async function buildExport(ctx: AppContext, founder: FounderKey, input: Pick<ExportInput, "from" | "to" | "scope">, now = new Date()): Promise<ExportDoc> {
  const { from, to, scope } = input;
  if (from > to) throw new RuleError("The start date must be before the end date.");
  if (periodDays(from, to) > MAX_DAYS) throw new RuleError("Choose a period of at most 400 days.");
  const t: T = tFor(LOCALE_OF[founder]);
  const me = scope === "me";
  const who = (f: string | null | undefined) => !me || f === founder;
  const founders: FounderKey[] = me ? [founder] : [...FOUNDERS];
  const u = await userRow(ctx.repo, founder);

  const db = await ctx.repo.listMany([
    "ActivityEvents", "Accounts", "Contacts", "SuppressionList", "Opportunities", "OpportunityStageEvents", "EmailSends",
    "ContentLog", "TrafficDaily", "SocialAccounts", "SocialAccountDaily", "BankTransactions", "BankBalances", "RevenueSnapshots", "WeeklyReviews",
  ]);
  const allEvents = dedupeEvents(db.ActivityEvents.rows.filter((e) => !e.is_archived));
  const events = filterPeriod(allEvents, (e) => e.local_date, from, to).filter((e) => who(e.founder_key));
  const accounts = new Map(db.Accounts.rows.map((a) => [a.id, a]));

  // Opted-out / suppressed businesses are never named (spec 5.5): business name only for the others.
  const blocked = new Set<string>();
  for (const a of db.Accounts.rows) {
    const contacts = db.Contacts.rows.filter((c) => c.account_id === a.id);
    if (outreachBlock(null, a, db.SuppressionList.rows).blocked) blocked.add(a.id);
    else if (contacts.some((c) => c.consent_status === "opted_out") || (contacts.length && contacts.every((c) => outreachBlock(c, a, db.SuppressionList.rows).blocked))) blocked.add(a.id);
  }
  const business = (accountId: string) => {
    if (!accountId) return t("Number outside the CRM");
    if (blocked.has(accountId)) return t("Opted out (name withheld)");
    return accounts.get(accountId)?.name ?? t("Unknown business");
  };
  const fname = (f: string | null | undefined) => (f ? FOUNDER_NAMES[f as FounderKey] ?? f : t("Unassigned"));
  const yesNo = (b: boolean) => (b ? t("Yes") : t("No"));
  const tv = (v?: Record<string, string | number>) => (v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? t(x) : x])) : undefined);
  const verdictText = (v: Verdict) => `${t(v.key, tv(v.vars))}${v.action ? ` → ${t(v.action.key, tv(v.action.vars))}` : ""}`;

  const sections: ExportSection[] = [];

  /* ---- 1. summary KPIs per founder and team ---- */
  const wonEvents = db.OpportunityStageEvents.rows.filter((s) => s.to_stage === "won" && inPeriod(s.changed_at, from, to));
  const opps = new Map(db.Opportunities.rows.map((o) => [o.id, o]));
  const sendsAll = db.EmailSends.rows.filter((s) => !s.is_archived && s.status === "sent" && inPeriod(s.local_date ?? s.sent_at, from, to));
  const kpiCols = [...founders.map((f) => FOUNDER_NAMES[f]), ...(me ? [] : [t("Team")])];
  const per = (fn: (f: FounderKey | null) => number | null) => [...founders.map((f) => fn(f)), ...(me ? [] : [fn(null)])];
  const evOf = (f: FounderKey | null) => events.filter((e) => !f || e.founder_key === f);
  const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
  const kpiRows: [string, Cell[], ExportColumn["kind"]][] = [];
  const addKpi = (label: string, fn: (f: FounderKey | null) => number | null, kind: ExportColumn["kind"] = "int") => kpiRows.push([label, per(fn), kind]);
  addKpi("Outreach actions", (f) => funnelCounts(evOf(f), null, from, to).attempted);
  addKpi("New businesses contacted", (f) => newBusinessesContacted(allEvents, f, from, to).length);
  addKpi("Dials", (f) => evOf(f).filter((e) => CALLS.includes(e.activity_type)).length);
  addKpi("Call, connected", (f) => evOf(f).filter((e) => e.activity_type === "connected_call").length);
  addKpi("Pick-up rate", (f) => ratio(evOf(f).filter((e) => e.activity_type === "connected_call").length, evOf(f).filter((e) => CALLS.includes(e.activity_type)).length), "pct");
  addKpi("Said yes", (f) => evOf(f).filter((e) => YES.includes(e.outcome ?? "")).length);
  addKpi("Conversations", (f) => funnelCounts(evOf(f), null, from, to).conversations);
  addKpi("Qualified conversation", (f) => evOf(f).filter((e) => e.activity_type === "qualified_conversation").length);
  addKpi("Meetings booked", (f) => funnelCounts(evOf(f), null, from, to).meetingsBooked);
  addKpi("Meeting held", (f) => evOf(f).filter((e) => e.activity_type === "meeting_held").length);
  addKpi("Proposal sent", (f) => evOf(f).filter((e) => e.activity_type === "proposal_sent").length);
  addKpi("Sale", (f) => evOf(f).filter((e) => e.activity_type === "sale").length);
  addKpi("Deals won", (f) => wonEvents.filter((s) => (f ? opps.get(s.opportunity_id)?.owner_founder === f : who(opps.get(s.opportunity_id)?.owner_founder))).length);
  addKpi("Emails sent", (f) => sendsAll.filter((s) => s.channel === "email" && (f ? s.founder_key === f : who(s.founder_key))).length);
  addKpi("WhatsApp messages sent", (f) => sendsAll.filter((s) => s.channel === "whatsapp" && (f ? s.founder_key === f : who(s.founder_key))).length);
  const byType: [string, Cell[], ExportColumn["kind"]][] = ACTIVITY_TYPES.map((a) => [ACTIVITY_LABELS[a], per((f) => evOf(f).filter((e) => e.activity_type === a).length), "int"]);
  sections.push({
    key: "summary", title: t("Summary"),
    intro: t("Counts over the period, derived from the activity log (one tap = one event, duplicates removed)."),
    tables: [
      { title: t("Key numbers"), columns: [col(t("Metric")), ...kpiCols.map((c) => col(c, "int"))], rows: kpiRows.map(([l, v, kind]) => [t(l), ...v.map((x) => (kind === "pct" && typeof x === "number" ? `${Math.round(x * 100)}%` : x))]) },
      { title: t("Activity by type"), columns: [col(t("Activity")), ...kpiCols.map((c) => col(c, "int"))], rows: byType.filter(([, v]) => v.some((x) => (x as number) > 0)).map(([l, v]) => [t(l), ...v]) },
    ],
  });

  /* ---- 2. conversion by channel ---- */
  const sendsScope = db.EmailSends.rows.filter((s) => who(s.founder_key));
  const funnels = channelFunnels({
    events: allEvents.filter((e) => who(e.founder_key)), sends: sendsScope, opps: db.Opportunities.rows, stageEvents: db.OpportunityStageEvents.rows,
    traffic: me ? [] : db.TrafficDaily.rows.filter((x) => !x.is_archived), from, to, minutes: MINUTES_PER_ACTION_SEED,
  });
  const chLabel = (k: string) => t(CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS] ?? k);
  sections.push({
    key: "channels", title: t("Conversion by channel"),
    intro: t("Meetings and deals won are credited to the channel of the last touch on that business before the result."),
    tables: [
      {
        title: t("Channels"),
        columns: [col(t("Channel")), col(t("Touches"), "int"), col(t("Meetings"), "int"), col(t("Won"), "int"), col(t("Hours of work"), "num"), col(t("Meetings per hour"), "num"), col(t("Touches per meeting"), "int")],
        rows: [...funnels.all, ...(me ? [] : [funnels.inbound])].map((c) => [chLabel(c.key), c.touches, c.meetings, c.won, c.hours, c.meetingsPerHour, c.touchesPerMeeting]),
      },
      { title: t("Funnel steps"), columns: [col(t("Channel")), col(t("Step")), col(t("Value"), "int")], rows: [...funnels.all, ...(me ? [] : [funnels.inbound])].flatMap((c) => c.steps.map((s) => [chLabel(c.key), t(s.label), s.value])) },
    ],
  });

  /* ---- 3. objections ---- */
  const stats = callStats(events as never, u.timezone);
  const objLabel = (k: string) => t(OBJECTION_LABELS[k as keyof typeof OBJECTION_LABELS] ?? k);
  sections.push({
    key: "objections", title: t("Objections"),
    intro: t("On connected calls: how often each objection came up, and how often the call still ended in a yes (interested, call back, meeting)."),
    tables: [{ title: t("Objections heard"), columns: [col(t("Objection")), col(t("Heard"), "int"), col(t("Turned around"), "int"), col(t("Turned around (%)"), "pct")], rows: stats.objections.map((o) => [objLabel(o.key), o.count, o.won, o.wonRate]) }],
  });

  /* ---- 4. calls log ---- */
  const calls = events.filter((e) => CALLS.includes(e.activity_type));
  const hm = (iso: string, tz: string) => { try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso)); } catch { return iso.slice(11, 16); } };
  sections.push({
    key: "calls", title: t("Calls log"),
    intro: t("One row per call. No phone numbers: calls to numbers outside the CRM are shown without a name."),
    tables: [{
      title: t("Calls"),
      columns: [col(t("Date"), "date"), col(t("Time")), col(t("Founder")), col(t("Business")), col(t("Market")), col(t("Trade")), col(t("Result")), col(t("Outcome")), col(t("Duration (s)"), "int"), col(t("Objections"))],
      rows: calls.slice(-MAX_LOG_ROWS).map((e) => {
        const a = accounts.get(e.account_id);
        return [e.local_date, hm(e.occurred_at, e.timezone), fname(e.founder_key), business(e.account_id), e.market ?? a?.country ?? "", a && !blocked.has(a.id) ? a.niche : "", t(ACTIVITY_LABELS[e.activity_type]), e.outcome ? t(OUTCOME_LABELS[e.outcome]) : "", e.duration_sec, objectionsOf(e).map(objLabel).join(", ")];
      }),
      note: calls.length > MAX_LOG_ROWS ? t("Only the last {n} calls are listed.", { n: MAX_LOG_ROWS }) : undefined,
    }],
  });

  /* ---- 5. emails & WhatsApp ---- */
  const sends = sendsAll.filter((s) => who(s.founder_key));
  const sendSummary = (["email", "whatsapp"] as const).map((ch) => {
    const s = sends.filter((x) => x.channel === ch);
    const replies = s.filter((x) => x.replied_at && x.reply_kind !== "bounce").length;
    return [ch === "email" ? t("Email") : t("WhatsApp"), s.length, replies, s.filter((x) => x.reply_kind === "positive").length, s.filter((x) => x.reply_kind === "bounce").length, ratio(replies, s.length)] as Cell[];
  });
  const replyEvents = events.filter((e) => e.activity_type === "reply");
  sections.push({
    key: "messages", title: t("Emails and WhatsApp"),
    intro: t("Messages sent from Valemont OS and the replies marked by a founder. No addresses or message bodies."),
    bullets: [t("Replies logged in the period (all channels): {n}", { n: replyEvents.length })],
    tables: [
      { title: t("Sent and replies"), columns: [col(t("Channel")), col(t("Sent"), "int"), col(t("Replies"), "int"), col(t("Interested"), "int"), col(t("Bounced"), "int"), col(t("Reply rate"), "pct")], rows: sendSummary },
      {
        title: t("Messages"),
        columns: [col(t("Date"), "date"), col(t("Founder")), col(t("Channel")), col(t("Context")), col(t("Template")), col(t("Business")), col(t("Language")), col(t("Replied")), col(t("Reply"))],
        rows: sends.sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? "")).slice(-MAX_LOG_ROWS).map((s) => [
          s.local_date ?? (s.sent_at ?? "").slice(0, 10), fname(s.founder_key), s.channel === "email" ? t("Email") : t("WhatsApp"), s.context === "after_call" ? t("After a call") : t("Cold"),
          s.template_key, business(s.account_id), s.language ?? "", yesNo(Boolean(s.replied_at)), s.reply_kind ? t(REPLY_KIND[s.reply_kind]) : "",
        ]),
      },
    ],
  });

  /* ---- 6. pipeline ---- */
  const myOpps = db.Opportunities.rows.filter((o) => !o.is_archived && who(o.owner_founder));
  const open = myOpps.filter(isOpen).sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage));
  const oppName = (o: Row<"Opportunities">) => (blocked.has(o.account_id) ? t("Opted out (name withheld)") : o.name);
  const lostInPeriod = db.OpportunityStageEvents.rows.filter((s) => s.to_stage === "lost" && inPeriod(s.changed_at, from, to) && myOpps.some((o) => o.id === s.opportunity_id)).length;
  sections.push({
    key: "pipeline", title: t("Pipeline"),
    intro: t("Deals as they are today (values in euros). Won and lost count the stage changes inside the period."),
    bullets: [
      t("Deals won in the period: {n}", { n: wonEvents.filter((s) => myOpps.some((o) => o.id === s.opportunity_id)).length }),
      t("Deals lost in the period: {n}", { n: lostInPeriod }),
    ],
    tables: [
      { title: t("Deals by stage"), columns: [col(t("Stage")), col(t("Deals"), "int"), col(t("Value (EUR)"), "money")], rows: STAGES.map((s) => { const xs = myOpps.filter((o) => o.stage === s); return [t(STAGE_LABELS[s]), xs.length, major(xs.reduce((a, o) => a + (o.value_minor ?? 0), 0))] as Cell[]; }).filter((r) => (r[1] as number) > 0) },
      {
        title: t("Open deals and next actions"),
        columns: [col(t("Deal")), col(t("Business")), col(t("Stage")), col(t("Owner")), col(t("Value (EUR)"), "money"), col(t("Next action")), col(t("Due"), "date"), col(t("Expected close"), "date")],
        rows: open.map((o) => [oppName(o), business(o.account_id), t(STAGE_LABELS[o.stage]), fname(o.owner_founder), major(o.value_minor), o.next_action ? t(o.next_action) : "", o.next_action_due ?? "", o.expected_close ?? ""]),
      },
    ],
  });

  /* ---- 7. tasks (shared + the requester's own private tasks only) ---- */
  const tasks = (await listTasks(ctx, founder)).filter((x) => !me || x.owner === founder || (!x.owner && x.created_by_founder === founder));
  const done = tasks.filter((x) => x.status === "done" && inPeriod(x.completed_at, from, to));
  const openTasks = tasks.filter((x) => x.status === "todo" || x.status === "in_progress");
  const today = localDate(now, u.timezone);
  sections.push({
    key: "tasks", title: t("Tasks"),
    bullets: [t("Done in the period: {n}", { n: done.length }), t("Open now: {n}", { n: openTasks.length }), t("Overdue now: {n}", { n: openTasks.filter((x) => x.due_at && x.due_at < today).length })],
    tables: [
      { title: t("Done"), columns: [col(t("Task")), col(t("Owner")), col(t("Priority")), col(t("Completed"), "date"), col(t("Private"))], rows: done.map((x) => [x.title, fname(x.owner), x.priority, (x.completed_at ?? "").slice(0, 10), yesNo(x.private)]) },
      { title: t("Open"), columns: [col(t("Task")), col(t("Owner")), col(t("Priority")), col(t("Status")), col(t("Due"), "date"), col(t("Overdue")), col(t("Private"))], rows: openTasks.map((x) => [x.title, fname(x.owner), x.priority, x.status === "in_progress" ? t("In progress") : t("To do"), x.due_at ?? "", yesNo(Boolean(x.due_at && x.due_at < today)), yesNo(x.private)]) },
    ],
  });

  /* ---- 8. content published ---- */
  const content = filterPeriod(db.ContentLog.rows.filter((c) => !c.is_archived && who(c.founder_key)), (c) => c.local_date, from, to);
  const delivLabel = (k: string) => t(DELIVERABLE_LABELS[k as keyof typeof DELIVERABLE_LABELS] ?? k);
  sections.push({
    key: "content", title: t("Content published"),
    tables: [
      { title: t("By type"), columns: [col(t("Type")), ...kpiCols.map((c) => col(c, "int"))], rows: Object.keys(DELIVERABLE_LABELS).map((k) => [delivLabel(k), ...per((f) => content.filter((c) => c.deliverable === k && (!f || c.founder_key === f)).length)]).filter((r) => r.slice(1).some((x) => (x as number) > 0)) },
      { title: t("Published"), columns: [col(t("Date"), "date"), col(t("Founder")), col(t("Type")), col(t("Brand")), col(t("Language")), col(t("Title"))], rows: content.sort((a, b) => a.local_date.localeCompare(b.local_date)).map((c) => [c.local_date, fname(c.founder_key), delivLabel(c.deliverable), c.brand ?? "", c.language ?? "", c.title]) },
    ],
  });

  /* ---- 9. website traffic & social audience ---- */
  const traffic = filterPeriod(db.TrafficDaily.rows.filter((x) => !x.is_archived), (x) => x.date, from, to);
  const bySource = new Map<string, number[]>();
  for (const x of traffic) {
    const k = `${x.source}${x.medium ? ` / ${x.medium}` : ""}`;
    const s = bySource.get(k) ?? [0, 0, 0, 0, 0];
    [x.sessions, x.leads, x.meetings, x.purchases, x.revenue_minor].forEach((v, i) => (s[i] += v ?? 0));
    bySource.set(k, s);
  }
  const social = db.SocialAccounts.rows.filter((a) => !a.is_archived && (a.visibility !== "owner" || a.owner_founder === founder) && (!me || a.owner_founder === founder || a.owner_founder === null));
  const socialRows = social.map((a) => {
    const days = filterPeriod(db.SocialAccountDaily.rows.filter((d) => d.account_id === a.id && !d.is_archived), (d) => d.date, from, to).sort((x, y) => x.date.localeCompare(y.date));
    const fol = days.filter((d) => d.followers !== null);
    const sum = (k: "views" | "impressions" | "interactions" | "profile_visits") => days.reduce((s, d) => s + (d[k] ?? 0), 0);
    const start = fol[0]?.followers ?? null, end = fol.at(-1)?.followers ?? null;
    return [t(PLATFORM[a.platform]), a.handle, start, end, start !== null && end !== null ? end - start : null, sum("views"), sum("impressions"), sum("interactions"), sum("profile_visits")] as Cell[];
  });
  sections.push({
    key: "audience", title: t("Website traffic and social audience"),
    tables: [
      ...(me ? [] : [{ title: t("Website traffic by source"), columns: [col(t("Source")), col(t("Visits"), "int"), col(t("Leads"), "int"), col(t("Meetings"), "int"), col(t("Purchases"), "int"), col(t("Revenue (EUR)"), "money")], rows: [...bySource.entries()].sort((a, b) => b[1][0] - a[1][0]).map(([k, v]) => [k, v[0], v[1], v[2], v[3], major(v[4])]) }]),
      { title: t("Social accounts"), columns: [col(t("Platform")), col(t("Account")), col(t("Followers at start"), "int"), col(t("Followers at end"), "int"), col(t("Change"), "int"), col(t("Views"), "int"), col(t("Impressions"), "int"), col(t("Interactions"), "int"), col(t("Profile visits"), "int")], rows: socialRows },
    ],
  });

  /* ---- 10. money (company level: team scope only) ---- */
  const tx = filterPeriod(db.BankTransactions.rows.filter((r) => !r.is_archived && r.currency === "EUR"), (r) => r.date, from, to);
  const snaps = db.RevenueSnapshots.rows.filter((r) => !r.is_archived && r.currency === "EUR").sort((a, b) => a.date.localeCompare(b.date));
  const snapAt = (d: string) => [...snaps].reverse().find((r) => r.date <= d) ?? null;
  const mrrStart = snapAt(from) ?? snaps.find((r) => inPeriod(r.date, from, to)) ?? null;
  const mrrEnd = snapAt(to);
  let moneyVerdictList: Verdict[] = [];
  if (!me) {
    const cats = new Map<BankCategory, { amount: number; n: number }>();
    for (const r of tx) {
      if (NEUTRAL.includes(r.category)) continue;
      if (!isIncome(r.category) && r.direction !== "debit") continue;
      const c = cats.get(r.category) ?? { amount: 0, n: 0 };
      c.amount += isIncome(r.category) ? r.amount_minor : -r.amount_minor;
      c.n++;
      cats.set(r.category, c);
    }
    const income = [...cats.entries()].filter(([c]) => isIncome(c)).reduce((a, [, v]) => a + v.amount, 0);
    const expenses = [...cats.entries()].filter(([c]) => !isIncome(c)).reduce((a, [, v]) => a + v.amount, 0);
    const summary = moneySummary(db.BankTransactions.rows as never, "EUR", to);
    const eur = db.BankBalances.rows.filter((b) => !b.is_archived && b.bank === "wise" && b.currency === "EUR");
    moneyVerdictList = moneyVerdicts({ ...summary, balance: eur.length ? eur.reduce((a, b) => a + b.amount_minor, 0) : null, mrr: mrrEnd?.mrr_minor ?? null, mrrPrevious: mrrStart && mrrStart !== mrrEnd ? mrrStart.mrr_minor : null }, (m) => `${(m / 100).toFixed(2)} €`, (k) => CATEGORY_LABELS[k as BankCategory] ?? k);
    sections.push({
      key: "money", title: t("Money"),
      intro: t("Bank movements in euros (Wise and Stripe). Founder contributions and transfers between our balances are neither income nor expenses."),
      bullets: [
        `${t("Income")}: ${(income / 100).toFixed(2)} €`, `${t("Expenses")}: ${(expenses / 100).toFixed(2)} €`, `${t("Net")}: ${((income - expenses) / 100).toFixed(2)} €`,
        mrrEnd ? `${t("MRR at the end of the period")}: ${(mrrEnd.mrr_minor / 100).toFixed(2)} € (${t("{n} active subscriptions", { n: mrrEnd.active_subscriptions })})` : t("MRR: not tracked (Stripe not connected)."),
        ...(mrrStart && mrrEnd && mrrStart !== mrrEnd ? [`${t("MRR at the start of the period")}: ${(mrrStart.mrr_minor / 100).toFixed(2)} €`] : []),
      ],
      tables: [
        { title: t("Income and expenses by category"), columns: [col(t("Category")), col(t("Type")), col(t("Amount (EUR)"), "money"), col(t("Movements"), "int")], rows: [...cats.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([c, v]) => [t(CATEGORY_LABELS[c]), isIncome(c) ? t("Income") : t("Expense"), major(v.amount), v.n]) },
        { title: t("Recurring revenue (MRR)"), columns: [col(t("Date"), "date"), col(t("MRR (EUR)"), "money"), col(t("Active subscriptions"), "int")], rows: filterPeriod(snaps, (r) => r.date, from, to).map((r) => [r.date, major(r.mrr_minor), r.active_subscriptions]) },
        // Stage 3 (D078): managerial P&L by month (recognized revenue, direct costs, gross margin, opex, estimated EBITDA; cash apart).
        ...(await pnlForExport(ctx, from, to).then((p) => [{
          title: t("Managerial P&L by month (EUR, ex VAT)"),
          note: t("Management accounting, not statutory accounts. Estimated EBITDA = recognized revenue − direct costs − operating expenses. Provisional = part of the revenue recognized on the payment date (invoice-based estimate)."),
          columns: [col(t("Month")), ...COST_CENTERS.map((c) => col(t(COST_CENTER_LABELS[c]), "money")), col(t("Recognized revenue"), "money"), col(t("Direct costs"), "money"), col(t("Gross profit"), "money"), col(t("Gross margin"), "pct"), col(t("Operating expenses"), "money"), col(t("Estimated EBITDA"), "money"), col(t("Provisional")), col(t("Cash received"), "money"), col(t("Cash paid"), "money"), col(t("VAT collected"), "money")],
          rows: p.months.map((m) => [m.month, ...COST_CENTERS.map((c) => major(m.revenue[c])), major(m.revenue.total), major(m.direct), major(m.gross_profit), m.gross_margin, major(m.opex), major(m.ebitda), m.provisional ? t("Yes") : t("No"), major(m.cash_in), major(m.cash_out), major(m.vat_in)] as Cell[]),
        } satisfies ExportTable]).catch(() => [])),
      ],
    });
  }

  /* ---- 11. verdicts ---- */
  const dash = dashboard({
    events: allEvents, accounts: db.Accounts.rows, contentDates: db.ContentLog.rows.filter((c) => who(c.founder_key)).map((c) => c.local_date),
    wonDates: db.OpportunityStageEvents.rows.filter((s) => s.to_stage === "won" && who(opps.get(s.opportunity_id)?.owner_founder)).map((s) => s.changed_at.slice(0, 10)),
    founder: me ? founder : null, tz: u.timezone, today: to, days: periodDays(from, to),
  });
  // Verdict builders get English labels: verdictText translates every string var once.
  const verdicts = [...salesVerdicts(dash, (k) => OBJECTION_LABELS[k as keyof typeof OBJECTION_LABELS] ?? k), ...growthVerdicts(funnels, (k) => CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS] ?? k), ...moneyVerdictList];
  const groups: [Verdict["kind"], string][] = [["good", "What works"], ["watch", "To watch"], ["fix", "To improve"]];
  sections.push({
    key: "verdicts", title: t("What the numbers say"),
    intro: t("Rules applied by Valemont OS with minimum samples (20 calls, 10 people reached, 20 emails, 200 visits)."),
    tables: [{ title: t("Verdicts"), columns: [col(t("Kind")), col(t("Verdict"))], rows: groups.flatMap(([k, label]) => verdicts.filter((v) => v.kind === k).map((v) => [t(label), verdictText(v)])) }],
  });

  /* ---- 12. weekly reviews ---- */
  const reviews = db.WeeklyReviews.rows.filter((w) => !w.is_archived && w.week_start >= startOfWeek(from) && w.week_start <= to).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const quotes: { heading: string; text: string }[] = [];
  for (const w of reviews) {
    const wk = `${t("Week of")} ${w.week_start}`;
    const fields: [string, string][] = [["What worked", w.worked], ["What blocked", w.blocked], ["Decisions", w.decisions], ["Notes", w.notes], ...(founders.includes("theo") ? [["Priority for Théo", w.priority_theo] as [string, string]] : []), ...(founders.includes("pablo") ? [["Priority for Pablo", w.priority_pablo] as [string, string]] : [])];
    for (const [k, v] of fields) if (v.trim()) quotes.push({ heading: `${wk} · ${t(k)}`, text: v.trim() });
  }
  sections.push({ key: "weekly", title: t("Weekly reviews"), intro: quotes.length ? undefined : t("No weekly review written in this period."), quotes, tables: [] });

  const questions = [
    "Which channel brings the most meetings per hour of work, and where should we put more time next week?",
    "Which objections cost us the most yeses, and how should we answer them?",
    ...(me ? [] : ["Compare Théo and Pablo: what does each do better, and what can the other copy?"]),
    "Which trades and markets answer best? Which lists should we call next?",
    ...(me ? [] : ["Are we on track with money: income vs expenses, recurring revenue and months of cash?"]),
    "Which deals are at risk (no next step, overdue) and what should we do this week?",
    "Give us three priorities for the next 7 days, each with a number to reach.",
  ].map((q) => t(q));

  return {
    title: t("Valemont OS — data for AI analysis"),
    meta: [
      [t("Period"), `${from} → ${to} (${t("{n} days", { n: periodDays(from, to) })})`],
      [t("Generated"), `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`],
      [t("Requested by"), FOUNDER_NAMES[founder]],
      [t("Scope"), me ? t("Only my data") : t("Team (Théo and Pablo)")],
      [t("Currency"), t("Amounts in euros (EUR)")],
      [t("Privacy"), t("No prospect phone numbers, emails or contact names. Opted-out businesses are not named. The other founder's private tasks are never included.")],
    ],
    definitionsTitle: t("Definitions"),
    definitions: DEFINITIONS.map(([k, v]) => [t(k), t(v)]),
    sections,
    questionsTitle: t("Questions to ask the AI"),
    questions,
    labels: { term: t("Metric"), definition: t("Definition"), field: t("Field"), value: t("Value"), empty: t("Nothing in this period."), readme: t("Read me") },
  };
}

const REPLY_KIND: Record<string, string> = { positive: "Positive", neutral: "Neutral", negative: "Negative", bounce: "Bounced" };
const PLATFORM: Record<string, string> = { instagram: "Instagram", linkedin_page: "LinkedIn page", linkedin_personal: "Personal LinkedIn" };
const DEFINITIONS: [string, string][] = [
  ["Outreach actions", "Calls, field visits, LinkedIn invitations and messages, InMails, cold emails and follow-ups logged in the period."],
  ["New businesses contacted", "Businesses whose very first outreach (by either founder, on any channel) falls in the period."],
  ["Dials", "Every call: no answer, voicemail or connected."],
  ["Call, connected", "Someone picked up."],
  ["Pick-up rate", "Connected calls divided by dials."],
  ["Said yes", "Outcome interested, callback requested or meeting booked."],
  ["Conversations", "Connected calls, replies received, meetings held and field visits where the owner was met."],
  ["Qualified conversation", "A conversation logged as qualified by the founder (real need, right person)."],
  ["Meetings booked", "Meetings booked, including calls that ended with a booked meeting."],
  ["Deals won", "Deals moved to Won during the period."],
  ["Turned around", "Calls where the objection came up and the call still ended in a yes."],
  ["Meetings per hour", "Meetings credited to a channel divided by the hours of work on it (minutes per action settings)."],
  ["MRR", "Monthly recurring revenue from active Stripe subscriptions (yearly plans divided by 12)."],
];

/* ---------------- files ---------------- */

export async function toXlsx(doc: ExportDoc): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Valemont OS";
  wb.created = new Date();
  const used = new Set<string>();
  const info = wb.addWorksheet(sheetName(doc.labels.readme, used));
  info.columns = [{ width: 28 }, { width: 100 }];
  const addRows = (ws: ExcelJS.Worksheet, rows: Cell[][]) => rows.forEach((r) => ws.addRow(r.map((v) => sheetValue(v, "text"))));
  info.addRow([sheetValue(doc.title, "text")]).font = { bold: true, size: 14 };
  addRows(info, doc.meta);
  info.addRow([]);
  info.addRow([sheetValue(doc.definitionsTitle, "text")]).font = { bold: true };
  addRows(info, doc.definitions);
  info.addRow([]);
  info.addRow([sheetValue(doc.questionsTitle, "text")]).font = { bold: true };
  addRows(info, doc.questions.map((q, i) => [String(i + 1), q]));
  for (const s of doc.sections) {
    const tables: ExportTable[] = [...s.tables];
    if (s.bullets?.length) tables.unshift({ title: s.title, columns: [{ label: doc.labels.value, kind: "text" }], rows: s.bullets.map((b) => [b]) });
    if (s.quotes?.length) tables.push({ title: s.title, columns: [{ label: doc.labels.field, kind: "text" }, { label: doc.labels.value, kind: "text" }], rows: s.quotes.map((q) => [q.heading, q.text]) });
    for (const tb of tables) {
      const ws = wb.addWorksheet(sheetName(tb.title && tb.title !== s.title ? `${s.title} - ${tb.title}` : s.title, used));
      ws.addRow(tb.columns.map((c) => sheetValue(c.label, "text"))).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      for (const r of tb.rows) ws.addRow(tb.columns.map((c, i) => sheetValue(r[i] ?? null, c.kind)));
      tb.columns.forEach((c, i) => {
        const column = ws.getColumn(i + 1);
        column.width = c.kind === "text" ? Math.min(60, Math.max(12, c.label.length + 2, ...tb.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 2))) : Math.max(12, c.label.length + 2);
        if (c.kind === "money") column.numFmt = "#,##0.00";
        if (c.kind === "pct") column.numFmt = "0%";
        if (c.kind === "num") column.numFmt = "0.0#";
      });
      if (tb.note) ws.addRow([sheetValue(tb.note, "text")]);
    }
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export async function exportFile(ctx: AppContext, founder: FounderKey, input: ExportInput, now = new Date()) {
  const doc = await buildExport(ctx, founder, input, now);
  const filename = `valemont-${input.scope === "me" ? founder : "team"}-${input.from}_${input.to}.${input.format}`;
  if (input.format === "xlsx") return { filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: await toXlsx(doc) };
  return { filename, contentType: "text/markdown; charset=utf-8", body: renderMarkdown(doc) };
}
