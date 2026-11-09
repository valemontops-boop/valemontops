import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { MARKETS, type FounderKey } from "@/domain/constants";
import { dedupeEvents } from "@/domain/activity";
import {
  LINKEDIN_RESULTS, firstName, inmailCredits, invitationLimits, isLinkedInEvent, isLinkedInYes, linkedinEventFor, linkedinStats, nextAfter, nextStep,
  normalizeLinkedInUrl, sequenceState, type LinkedInResult, type LiEvent,
} from "@/domain/linkedin";
import { outreachBlock } from "@/domain/suppression";
import { addDays, localDate } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { logActivity, logActivitySchema } from "./activities";
import { LINKEDIN_SESSION, advanceDeal, startSession } from "./calls";
import { settingValue, userRow } from "./common";

/** Founder settings (Settings › Workspace); defaults follow LinkedIn's usual safe pace. */
export const LINKEDIN_DEFAULTS = { daily: 20, weekly: 100, inmails: 50 } as const;
const MARKET_OF: Record<FounderKey, "FR" | "ES"> = { theo: "FR", pablo: "ES" };

async function limitsFor(ctx: AppContext, founder: FounderKey, events: { founder_key: string; activity_type: string; local_date: string }[], today: string) {
  const num = async (k: string, d: number) => { const v = Number(await settingValue(ctx.repo, k)); return Number.isFinite(v) && v > 0 ? Math.floor(v) : d; };
  const daily = await num("linkedin_daily_invitation_limit", LINKEDIN_DEFAULTS.daily);
  const weekly = await num("linkedin_weekly_invitation_limit", LINKEDIN_DEFAULTS.weekly);
  const budget = await num("inmail_monthly_budget", LINKEDIN_DEFAULTS.inmails);
  return { invitations: invitationLimits(events, founder, today, daily, weekly), inmails: inmailCredits(events, founder, today, budget) };
}

export interface LiProspect {
  key: string; accountId: string; contactId: string; name: string; firstName: string; role: string; company: string; niche: string; city: string; country: "FR" | "ES" | null;
  linkedinUrl: string; listId: string; stage: ReturnType<typeof sequenceState>["stage"]; lastTouch: ReturnType<typeof sequenceState>["lastTouch"]; messagesSinceReply: number;
  next: ReturnType<typeof nextStep>;
}

/** Every prospect with a LinkedIn profile the founder may contact (owner = them or nobody), never a blocked one. */
async function prospects(ctx: AppContext, founder: FounderKey) {
  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList", "ActivityEvents", "CallLists"]);
  const events = dedupeEvents(t.ActivityEvents.rows).filter(isLinkedInEvent);
  const accounts = new Map(t.Accounts.rows.filter((a) => !a.is_archived && (!a.owner_founder || a.owner_founder === founder)).map((a) => [a.id, a]));
  const out: LiProspect[] = [];
  const withContact = new Set<string>();
  const build = (a: Row<"Accounts">, c: Row<"Contacts"> | null): LiProspect | null => {
    if (outreachBlock(c as never, a as never, t.SuppressionList.rows).blocked) return null;
    const ev = events.filter((e) => e.account_id === a.id && (!c || !e.contact_id || e.contact_id === c.id));
    const st = sequenceState(ev);
    const name = c?.full_name || a.name;
    return {
      key: c?.id ?? a.id, accountId: a.id, contactId: c?.id ?? "", name, firstName: c?.full_name ? firstName(c.full_name) : "", role: c?.role ?? "", company: a.name, niche: a.niche, city: a.city,
      country: a.country, linkedinUrl: (c?.linkedin_url || a.linkedin_url).trim(), listId: a.list_id || a.import_batch_id, stage: st.stage, lastTouch: st.lastTouch, messagesSinceReply: st.messagesSinceReply, next: nextStep(st),
    };
  };
  for (const c of t.Contacts.rows) {
    if (c.is_archived || !c.linkedin_url.trim()) continue;
    const a = accounts.get(c.account_id);
    if (!a) continue;
    withContact.add(a.id);
    const p = build(a, c);
    if (p) out.push(p);
  }
  for (const a of accounts.values()) {
    if (withContact.has(a.id) || !a.linkedin_url.trim()) continue;
    const p = build(a, null);
    if (p) out.push(p);
  }
  return { list: out, events, lists: t.CallLists.rows.filter((l) => !l.is_archived) };
}

/**
 * The LinkedIn session queue: follow-ups due first (invitation to check, first message after acceptance, J+3 / J+7
 * follow-ups, replies to qualify), then prospects never contacted. Limits come with it so the screen can warn first.
 */
export async function linkedinQueue(ctx: AppContext, founder: FounderKey, listId: string, limit = 40) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const p = await prospects(ctx, founder);
  const inList = (x: LiProspect) => !listId || x.listId === listId;
  const due = p.list.filter((x) => inList(x) && x.next.due && x.next.due <= today && !["new", "meeting", "closed"].includes(x.stage)).sort((a, b) => (a.next.due ?? "").localeCompare(b.next.due ?? ""));
  const fresh = p.list.filter((x) => inList(x) && x.stage === "new");
  const all = await ctx.repo.list("ActivityEvents");
  const limits = await limitsFor(ctx, founder, dedupeEvents(all.rows), today);
  const lists = p.lists.map((l) => ({ id: l.id, name: l.name, count: p.list.filter((x) => x.listId === l.id).length })).filter((l) => l.count > 0);
  return { today, due: due.slice(0, limit), fresh: fresh.slice(0, limit), dueCount: due.length, freshCount: fresh.length, total: p.list.length, lists, limits };
}

const optUuid = z.union([z.literal(""), z.string().uuid()]).default("");
export const linkedinSchema = z.object({
  idempotency_key: z.string().uuid(),
  session_id: z.string().uuid(),
  result: z.enum(LINKEDIN_RESULTS),
  account_id: optUuid,
  contact_id: optUuid,
  /** Free mode: the profile pasted by the founder (a business and contact are created on the first tap). */
  profile_url: z.string().trim().max(300).default(""),
  full_name: z.string().trim().max(200).default(""),
  company: z.string().trim().max(200).default(""),
  role: z.string().trim().max(120).default(""),
  market: z.enum(MARKETS).nullable().default(null),
  note: z.string().trim().max(500).default(""),
});

/** One tap in a LinkedIn session = one event. Limits are hard: an invitation or InMail past the limit is refused. */
export async function logLinkedIn(ctx: AppContext, founder: FounderKey, input: z.infer<typeof linkedinSchema>) {
  const session = (await ctx.repo.get("CallSessions", input.session_id, { fresh: true })) ?? (await startSession(ctx, founder, { id: input.session_id, list_id: "", kind: "linkedin" }));
  const fresh = dedupeEvents((await ctx.repo.list("ActivityEvents", { fresh: true })).rows);
  const dup = fresh.find((e) => e.idempotency_key === input.idempotency_key);
  if (dup) return { event: dup, duplicate: true, created: {}, warnings: [] as string[], opportunityId: null, limits: null };
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);

  const limits = await limitsFor(ctx, founder, fresh, today);
  if (input.result === "invited" && limits.invitations.blocked) {
    const l = limits.invitations;
    throw new RuleError(l.reason === "daily" ? `Daily invitation limit reached (${l.today}/${l.daily}). Continue tomorrow: going past it puts your LinkedIn account at risk.` : `Weekly invitation limit reached (${l.week}/${l.weekly}). Wait a few days: going past it puts your LinkedIn account at risk.`);
  }
  if (input.result === "inmail" && limits.inmails.blocked) throw new RuleError(`No InMail credit left this month (${limits.inmails.used}/${limits.inmails.budget}). Send an invitation instead.`);

  // Who: a prospect from the CRM, or a profile pasted in free mode (found by its URL, else created).
  let accountId = input.account_id;
  let contactId = input.contact_id;
  if (!accountId) {
    const url = normalizeLinkedInUrl(input.profile_url);
    if (!url) throw new RuleError("Paste the LinkedIn profile link (linkedin.com/in/…).");
    const t = await ctx.repo.listMany(["Accounts", "Contacts"]);
    const known = t.Contacts.rows.find((c) => !c.is_archived && normalizeLinkedInUrl(c.linkedin_url) === url);
    if (known) { accountId = known.account_id; contactId = known.id; }
    else {
      if (!input.company && !input.full_name) throw new RuleError("Add the person's name or company so the prospect lands in your CRM.");
      const accId = childId(input.idempotency_key, "li-account");
      const conId = childId(input.idempotency_key, "li-contact");
      const country = input.market ?? MARKET_OF[founder];
      if (!t.Accounts.rows.some((a) => a.id === accId)) {
        await ctx.repo.insert("Accounts", [{
          id: accId, name: input.company || input.full_name, sector: "", niche: "", country, city: "", website: "", domain_normalized: "", phone: "", email: "", linkedin_url: "",
          lead_source: "LinkedIn", lead_type: "outbound", brand: "consulting", owner_founder: founder, lead_status: "working", observed_problem: "", problem_evidence: "",
          language: country === "FR" ? "fr" : "es", notes: "", import_batch_id: "",
        }], { founder });
      }
      if (!t.Contacts.rows.some((c) => c.id === conId)) {
        await ctx.repo.insert("Contacts", [{
          id: conId, account_id: accId, full_name: input.full_name, role: input.role, is_decision_maker: false, phone: "", email: "", linkedin_url: url, contact_type: "professional_named",
          language: country === "FR" ? "fr" : "es", consent_status: "unknown", lawful_basis: "", source: "LinkedIn", retention_review_at: null, import_batch_id: "",
        }], { founder });
      }
      accountId = accId;
      contactId = conId;
    }
  }

  const before = sequenceState(fresh.filter((e) => isLinkedInEvent(e) && e.account_id === accountId && (!contactId || !e.contact_id || e.contact_id === contactId)) as LiEvent[]);
  const msgs = input.result === "messaged" || input.result === "inmail" ? before.messagesSinceReply + 1 : before.messagesSinceReply;
  const next = nextAfter(input.result, today, msgs);
  const ev = linkedinEventFor(input.result);
  const res = await logActivity(ctx.repo, founder, logActivitySchema.parse({
    idempotency_key: input.idempotency_key, activity_type: ev.activity_type, outcome: ev.outcome, channel: "linkedin", account_id: accountId, contact_id: contactId,
    notes: input.note, next_action: next.action, next_action_due: next.due, call_session_id: session.id, market: input.market,
  }));
  let opportunityId: string | null = null;
  if (!res.duplicate && isLinkedInYes(input.result)) {
    opportunityId = await advanceDeal(ctx, founder, {
      key: input.idempotency_key, eventId: res.event.id, accountId, contactId, target: input.result === "meeting" ? "discovery_scheduled" : "replied",
      nextAction: next.action, due: next.due, high: input.result === "meeting", name: input.company || input.full_name, market: input.market, reason: "LinkedIn session",
    });
  }
  const after = await limitsFor(ctx, founder, [...fresh, res.event], today);
  return { ...res, opportunityId, limits: after };
}

export const linkedinSummarySchema = z.object({ id: z.string().uuid() });
/** Session counts, and the acceptance rate of the founder's invitations over the last 30 days (acceptances come later). */
export async function linkedinSummary(ctx: AppContext, founder: FounderKey, id: string) {
  const t = await ctx.repo.listMany(["CallSessions", "ActivityEvents"]);
  const s = t.CallSessions.rows.find((x) => x.id === id);
  if (!s) throw new RuleError("Session not found");
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const stats = linkedinStats(events.filter((e) => e.call_session_id === id));
  const month = linkedinStats(events.filter((e) => e.founder_key === founder && e.local_date >= addDays(today, -29)));
  return { session: s, stats, last30: month, limits: await limitsFor(ctx, founder, events, today) };
}

export const linkedinLogSchema = z.object({ session_id: z.union([z.literal(""), z.string().uuid()]).default(""), days: z.coerce.number().int().min(1).max(90).default(14) });
const RESULT_OF = (e: { activity_type: string; outcome: string | null }): LinkedInResult =>
  e.activity_type === "linkedin_invitation" ? "invited" : e.activity_type === "linkedin_accepted" ? "accepted" : e.activity_type === "linkedin_dm" ? "messaged" : e.activity_type === "inmail" ? "inmail"
    : e.activity_type === "qualified_conversation" ? "qualified" : e.activity_type === "meeting_booked" ? "meeting" : e.outcome === "not_interested" ? "not_interested" : "replied";
/** Every LinkedIn tap of the founder (one session, or the last N days), newest first. */
export async function linkedinLog(ctx: AppContext, founder: FounderKey, input: z.infer<typeof linkedinLogSchema>) {
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts", "Contacts"]);
  const u = await userRow(ctx.repo, founder);
  const from = addDays(localDate(new Date(), u.timezone), -input.days + 1);
  const acc = new Map(t.Accounts.rows.map((a) => [a.id, a]));
  const con = new Map(t.Contacts.rows.map((c) => [c.id, c]));
  return dedupeEvents(t.ActivityEvents.rows)
    .filter((e) => e.founder_key === founder && isLinkedInEvent(e) && (input.session_id ? e.call_session_id === input.session_id : e.local_date >= from))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 300)
    .map((e) => {
      const c = e.contact_id ? con.get(e.contact_id) : undefined;
      const a = acc.get(e.account_id);
      return { id: e.id, at: e.occurred_at, date: e.local_date, result: RESULT_OF(e), name: c?.full_name || a?.name || "", company: a?.name ?? "", accountId: e.account_id, linkedinUrl: c?.linkedin_url || a?.linkedin_url || "", next_action: e.next_action, next_action_due: e.next_action_due };
    });
}

/** The founder's recent LinkedIn sessions with their counts. */
export async function linkedinSessions(ctx: AppContext, founder: FounderKey) {
  const t = await ctx.repo.listMany(["CallSessions", "ActivityEvents"]);
  const events = dedupeEvents(t.ActivityEvents.rows);
  return t.CallSessions.rows.filter((s) => s.founder_key === founder && s.notes === LINKEDIN_SESSION).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 10)
    .map((s) => ({ session: s, stats: linkedinStats(events.filter((e) => e.call_session_id === s.id)) }));
}
