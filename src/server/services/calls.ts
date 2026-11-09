import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { CONTACT_TYPES, MARKETS, OBJECTIONS, STAGES, type FounderKey, type Stage } from "@/domain/constants";
import { dedupeEvents } from "@/domain/activity";
import { CALL_OUTCOMES, callStats, eventFor, isPositive, objectionsOf } from "@/domain/calls";
import { OBJECTION_GUIDE, guideOf, pickVariant, replyStats } from "@/domain/objections";
import { isOpen } from "@/domain/pipeline";
import { outreachBlock } from "@/domain/suppression";
import { addDays, localDate } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { logActivity, logActivitySchema } from "./activities";
import { userRow } from "./common";

export const startSessionSchema = z.object({ id: z.string().uuid(), list_id: z.string().max(40).default("") });
export async function startSession(ctx: AppContext, founder: FounderKey, input: z.infer<typeof startSessionSchema>) {
  const cur = await ctx.repo.get("CallSessions", input.id, { fresh: true });
  if (cur) return cur;
  return (await ctx.repo.insert("CallSessions", [{ id: input.id, founder_key: founder, list_id: input.list_id, started_at: new Date().toISOString(), ended_at: null, notes: "" }], { founder }))[0];
}
export const endSessionSchema = z.object({ id: z.string().uuid() });
export async function endSession(ctx: AppContext, founder: FounderKey, id: string) {
  const cur = await ctx.repo.get("CallSessions", id, { fresh: true });
  if (!cur) throw new RuleError("Session not found");
  if (cur.ended_at) return cur;
  return ctx.repo.update("CallSessions", id, cur.version, { ended_at: new Date().toISOString() }, { founder });
}

/** Next numbers to call from a list: due call-backs first, then businesses never called. Blocked ones never appear. */
export async function callQueue(ctx: AppContext, founder: FounderKey, listId: string, limit = 25) {
  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList", "ActivityEvents", "Opportunities"]);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const lastCall = new Map<string, (typeof events)[number]>();
  for (const e of events) if (e.account_id && ["cold_call", "connected_call", "voicemail", "field_visit"].includes(e.activity_type)) lastCall.set(e.account_id, e);
  const accounts = t.Accounts.rows.filter((a) => !a.is_archived && a.phone && (listId ? a.list_id === listId || a.import_batch_id === listId : true) && (!a.owner_founder || a.owner_founder === founder));
  const blocked = (a: Row<"Accounts">) => {
    const cs = t.Contacts.rows.filter((c) => c.account_id === a.id);
    return outreachBlock(null, a, t.SuppressionList.rows).blocked || (cs.length > 0 && cs.every((c) => outreachBlock(c, a, t.SuppressionList.rows).blocked));
  };
  const dueBack = accounts.filter((a) => {
    const o = t.Opportunities.rows.find((x) => x.account_id === a.id && isOpen(x));
    // Not twice the same day: someone just called is not "due" again until tomorrow.
    return o && o.next_action_due && o.next_action_due <= today && ["contacted", "replied"].includes(o.stage) && (lastCall.get(a.id)?.local_date ?? "") < today;
  });
  const fresh = accounts.filter((a) => !lastCall.has(a.id) || (lastCall.get(a.id)!.outcome === "no_answer" && lastCall.get(a.id)!.local_date < today));
  const seen = new Set<string>();
  const out = [];
  for (const [why, list] of [["Call back due", dueBack], ["New", fresh]] as const) {
    for (const a of list) {
      if (seen.has(a.id) || blocked(a)) continue;
      seen.add(a.id);
      const last = lastCall.get(a.id);
      out.push({ accountId: a.id, name: a.name, phone: a.phone, city: a.city, niche: a.niche, country: a.country, why: why === "New" && last ? `No answer on ${last.local_date}` : why, contactName: t.Contacts.rows.find((c) => c.account_id === a.id)?.full_name ?? "", email: t.Contacts.rows.find((c) => c.account_id === a.id && c.email)?.email || a.email, brand: a.brand });
    }
  }
  return { remaining: out.length, queue: out.slice(0, limit) };
}

export const callSchema = z.object({
  idempotency_key: z.string().uuid(),
  session_id: z.string().uuid(),
  outcome: z.enum(CALL_OUTCOMES),
  account_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  phone: z.string().trim().max(40).default(""),
  market: z.enum(MARKETS).nullable().default(null),
  objection: z.enum(OBJECTIONS).nullable().default(null),
  /** Objections ticked live during the call, whatever the outcome. */
  objections: z.array(z.enum(OBJECTIONS)).max(12).default([]),
  /** Reply variant shown for each objection when the outcome was tapped ("too_expensive#2"). */
  replies: z.array(z.string().regex(/^[a-z_]+#\d{1,2}$/)).max(12).default([]),
  /** The list being called, so a session unknown to the server can be recreated as it was. */
  list_id: z.string().max(40).default(""),
  /** Seconds from "Dial" to the outcome tap, when the timer ran. */
  duration_sec: z.number().int().min(0).max(4 * 3600).nullable().default(null),
  follow_up_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
  note: z.string().trim().max(500).default(""),
  /** Only for a "yes" from free dialling: who said yes. Refusals need nothing. */
  business_name: z.string().trim().max(200).default(""),
  contact_name: z.string().trim().max(200).default(""),
  contact_type: z.enum(CONTACT_TYPES).default("professional_named"),
});

const ORDER = STAGES;
function forward(cur: Stage, to: Stage): Stage {
  return ORDER.indexOf(to) > ORDER.indexOf(cur) ? to : cur;
}

/** One tap = one event. A "yes" (call back / interested / meeting) creates or advances the deal with a dated next step. */
export async function logCall(ctx: AppContext, founder: FounderKey, input: z.infer<typeof callSchema>) {
  // A session can be unknown to the server after a reload or a restart: recreate it instead of losing the tap.
  const session = (await ctx.repo.get("CallSessions", input.session_id, { fresh: true })) ?? (await startSession(ctx, founder, { id: input.session_id, list_id: input.list_id }));
  if (isPositive(input.outcome) && !input.account_id && !input.business_name.trim()) throw new RuleError("Name the business that said yes so it lands in your pipeline.");
  const ev = eventFor(input.outcome);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const due = input.follow_up_date || (input.outcome === "call_back" ? addDays(today, 2) : input.outcome === "interested" ? addDays(today, 1) : input.outcome === "meeting" ? addDays(today, 3) : "");
  const nextAction = input.outcome === "meeting" ? "Meeting" : input.outcome === "interested" ? "Call back: they want to talk" : input.outcome === "call_back" ? "Call back" : "";
  const positiveNew = isPositive(input.outcome) && !input.account_id;
  const res = await logActivity(ctx.repo, founder, logActivitySchema.parse({
    idempotency_key: input.idempotency_key,
    activity_type: ev.activity_type,
    outcome: ev.outcome,
    account_id: input.account_id,
    objection: input.objection,
    objections: input.objections,
    replies: input.replies,
    duration_sec: input.duration_sec,
    notes: input.note,
    next_action: nextAction,
    next_action_due: due,
    call_session_id: input.session_id,
    list_id: session.list_id,
    phone_dialled: input.account_id || positiveNew ? "" : input.phone,
    market: input.market,
    fast_contact: positiveNew ? { company_name: input.business_name, contact_name: input.contact_name, phone: input.phone, email: "", country: input.market ?? "FR", contact_type: input.contact_type, niche: "" } : null,
  }));
  if (res.duplicate || !isPositive(input.outcome)) return { ...res, opportunityId: null };
  const accountId = res.event.account_id;
  const target: Stage = input.outcome === "meeting" ? "discovery_scheduled" : "replied";
  const { rows } = await ctx.repo.list("Opportunities", { fresh: true });
  const opp = rows.find((o) => o.account_id === accountId && isOpen(o));
  const acc = await ctx.repo.get("Accounts", accountId);
  if (!opp) {
    const id = childId(input.idempotency_key, "opportunity");
    await ctx.repo.insert("Opportunities", [{
      id, account_id: accountId, primary_contact_id: res.event.contact_id, name: acc?.name ?? input.business_name, brand: acc?.brand ?? "local", market: acc?.country ?? input.market,
      stage: target, owner_founder: founder, value_minor: null, currency: "EUR", expected_close: null, next_action: nextAction, next_action_due: due || null,
      next_action_priority: input.outcome === "meeting" ? "high" : "normal", next_action_reason: "", lost_reason: "", anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "",
    }], { founder });
    await ctx.repo.insert("OpportunityStageEvents", [{ id: childId(id, "created"), opportunity_id: id, from_stage: null, to_stage: target, changed_at: new Date().toISOString(), changed_by: founder, reason: "Call mode" }], { founder });
    return { ...res, opportunityId: id };
  }
  const stage = forward(opp.stage, target);
  await ctx.repo.update("Opportunities", opp.id, opp.version, { stage, next_action: nextAction, next_action_due: due || null, owner_founder: opp.owner_founder ?? founder }, { founder });
  if (stage !== opp.stage) await ctx.repo.insert("OpportunityStageEvents", [{ id: childId(opp.id, "stage", res.event.id), opportunity_id: opp.id, from_stage: opp.stage, to_stage: stage, changed_at: new Date().toISOString(), changed_by: founder, reason: "Call mode" }], { founder });
  return { ...res, opportunityId: opp.id };
}

export async function sessionSummary(ctx: AppContext, founder: FounderKey, id: string) {
  const t = await ctx.repo.listMany(["CallSessions", "ActivityEvents", "EmailSends"]);
  const s = t.CallSessions.rows.find((x) => x.id === id);
  if (!s) throw new RuleError("Session not found");
  const u = await userRow(ctx.repo, founder);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const stats = callStats(events.filter((e) => e.call_session_id === id), u.timezone, s);
  // Comparison with this founder's previous sessions (average), to see if a session went better or worse.
  const previous = t.CallSessions.rows.filter((x) => x.founder_key === s.founder_key && x.id !== id && x.started_at < s.started_at).map((x) => callStats(events.filter((e) => e.call_session_id === x.id), u.timezone, x)).filter((x) => x.dials > 0);
  const avg = (f: (x: (typeof previous)[number]) => number | null) => {
    const v = previous.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const messages = t.EmailSends.rows.filter((r) => r.call_session_id === id && r.status === "sent" && !r.is_archived).length;
  return { session: s, stats, messages, previous: { sessions: previous.length, pickupRate: avg((x) => x.pickupRate), positiveRate: avg((x) => x.positiveRate), dials: avg((x) => x.dials) } };
}

export async function listSessions(ctx: AppContext, founder: FounderKey) {
  const t = await ctx.repo.listMany(["CallSessions", "ActivityEvents"]);
  const u = await userRow(ctx.repo, founder);
  const events = dedupeEvents(t.ActivityEvents.rows);
  return t.CallSessions.rows.filter((s) => s.founder_key === founder).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 20)
    .map((s) => ({ session: s, stats: callStats(events.filter((e) => e.call_session_id === s.id), u.timezone, s) }));
}

/* ---------------- call lists ---------------- */

export async function callLists(ctx: AppContext) {
  const t = await ctx.repo.listMany(["CallLists", "Accounts", "ActivityEvents", "Opportunities"]);
  const events = dedupeEvents(t.ActivityEvents.rows);
  return t.CallLists.rows.filter((l) => !l.is_archived).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((l) => {
    const accs = t.Accounts.rows.filter((a) => (a.list_id === l.id || a.import_batch_id === l.id) && !a.is_archived);
    const ids = new Set(accs.map((a) => a.id));
    const calls = events.filter((e) => ids.has(e.account_id) && ["cold_call", "connected_call", "voicemail"].includes(e.activity_type));
    const called = new Set(calls.map((e) => e.account_id));
    const reached = new Set(calls.filter((e) => e.activity_type === "connected_call").map((e) => e.account_id));
    const positive = new Set(calls.filter((e) => e.outcome === "interested" || e.outcome === "meeting_booked" || e.outcome === "callback_requested").map((e) => e.account_id));
    const meetings = new Set(calls.filter((e) => e.outcome === "meeting_booked").map((e) => e.account_id));
    return { list: l, total: accs.length, called: called.size, reached: reached.size, positive: positive.size, meetings: meetings.size, remaining: accs.length - called.size };
  });
}

/**
 * Objections heard in the last N days (team-wide), how often each was turned into a yes, which reply
 * variant works best (90 days of data), and where objections come from (country, trade).
 */
export async function objectionReport(ctx: AppContext, founder: FounderKey, days = 30) {
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts"]);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const from = addDays(today, -days + 1);
  const all90 = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.local_date >= addDays(today, -89));
  const events = all90.filter((e) => e.local_date >= from);
  const all = callStats(events, u.timezone);
  const mine = callStats(events.filter((e) => e.founder_key === founder), u.timezone);
  const variants = replyStats(all90);
  const picks = Object.fromEntries(OBJECTION_GUIDE.map((g) => [g.key, pickVariant(g.key, variants)]));
  const niche = new Map(t.Accounts.rows.map((a) => [a.id, a.niche]));
  const split = (keyOf: (e: (typeof events)[number]) => string) => {
    const m = new Map<string, Map<string, number>>();
    for (const e of events.filter((x) => x.activity_type === "connected_call")) {
      const k = keyOf(e);
      if (!k) continue;
      for (const o of objectionsOf(e)) {
        const inner = m.get(k) ?? new Map<string, number>();
        inner.set(o, (inner.get(o) ?? 0) + 1);
        m.set(k, inner);
      }
    }
    return [...m.entries()].map(([key, inner]) => ({ key, total: [...inner.values()].reduce((a, b) => a + b, 0), top: [...inner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([o, n]) => ({ key: o, count: n })) })).sort((a, b) => b.total - a.total);
  };
  const heard = all.objections.reduce((a, o) => a + o.count, 0);
  const brushOffs = all.objections.filter((o) => guideOf(o.key)?.type === "brush_off").reduce((a, o) => a + o.count, 0);
  return {
    days, team: all.objections, mine: mine.objections, pickedUp: all.pickedUp, avgTalkSec: all.avgTalkSec,
    heard, brushOffShare: heard ? brushOffs / heard : null,
    variants, picks,
    byMarket: split((e) => e.market ?? ""),
    byNiche: split((e) => niche.get(e.account_id) ?? "").slice(0, 6),
  };
}

/* ---------------- call log: every call, one line ---------------- */
export const callLogSchema = z.object({ session_id: z.union([z.literal(""), z.string().uuid()]).default(""), days: z.coerce.number().int().min(1).max(90).default(14) });
const OUTCOME_OF = (e: { activity_type: string; outcome: string | null }) =>
  e.activity_type === "voicemail" ? "voicemail" : e.activity_type === "cold_call" ? "no_answer" : e.outcome === "gatekeeper" ? "gatekeeper" : e.outcome === "not_interested" ? "not_interested" : e.outcome === "callback_requested" ? "call_back" : e.outcome === "meeting_booked" ? "meeting" : e.outcome === "interested" ? "interested" : "no_answer";
/** The founder's calls (one session, or the last N days), newest first: who, outcome, objections, length, message sent after. */
export async function callLog(ctx: AppContext, founder: FounderKey, input: z.infer<typeof callLogSchema>) {
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts", "EmailSends", "Contacts"]);
  const u = await userRow(ctx.repo, founder);
  const from = addDays(localDate(new Date(), u.timezone), -input.days + 1);
  const acc = new Map(t.Accounts.rows.map((a) => [a.id, a]));
  const sends = t.EmailSends.rows.filter((x) => !x.is_archived && x.status === "sent");
  const calls = dedupeEvents(t.ActivityEvents.rows)
    .filter((e) => e.founder_key === founder && ["cold_call", "connected_call", "voicemail"].includes(e.activity_type) && (input.session_id ? e.call_session_id === input.session_id : e.local_date >= from))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 300);
  return calls.map((e) => {
    const a = e.account_id ? acc.get(e.account_id) : undefined;
    const msg = e.account_id ? sends.filter((x) => x.account_id === e.account_id && (x.sent_at ?? "") >= e.occurred_at).sort((x, y) => (x.sent_at ?? "").localeCompare(y.sent_at ?? ""))[0] : undefined;
    return {
      id: e.id, at: e.occurred_at, date: e.local_date, outcome: OUTCOME_OF(e), objections: objectionsOf(e), duration_sec: e.duration_sec,
      name: a?.name ?? "", niche: a?.niche ?? "", phone: a?.phone ?? "", accountId: e.account_id, contact: t.Contacts.rows.find((c) => c.account_id === e.account_id)?.full_name ?? "",
      message: msg ? { channel: msg.channel, template: msg.template_key, at: msg.sent_at } : null, next_action: e.next_action, next_action_due: e.next_action_due,
    };
  });
}
