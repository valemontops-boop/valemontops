import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { CONTACT_TYPES, MARKETS, OBJECTIONS, STAGES, type FounderKey, type Stage } from "@/domain/constants";
import { dedupeEvents } from "@/domain/activity";
import { CALL_OUTCOMES, LADDER_STEPS, callStats, eventFor, isCallbackDue, isPositive, ladderRecord, ladderStats, objectionsOf, openCallbacks, type LadderOffer } from "@/domain/calls";
import { normalizePhone } from "@/domain/normalize";
import { OBJECTION_GUIDE, guideOf, pickVariant, replyStats } from "@/domain/objections";
import { isOpen } from "@/domain/pipeline";
import { outreachBlock } from "@/domain/suppression";
import { addDays, localDate } from "@/domain/time";
import { BlockedError, RuleError } from "../errors";
import type { AppContext } from "../context";
import { logActivity, logActivitySchema } from "./activities";
import { offerDefaults, userRow } from "./common";

/** LinkedIn sessions reuse the CallSessions tab, marked in `notes` (no new table). */
export const LINKEDIN_SESSION = "linkedin";
export const startSessionSchema = z.object({ id: z.string().uuid(), list_id: z.string().max(40).default(""), kind: z.enum(["calls", "linkedin"]).default("calls") });
export async function startSession(ctx: AppContext, founder: FounderKey, input: z.input<typeof startSessionSchema>) {
  const cur = await ctx.repo.get("CallSessions", input.id, { fresh: true });
  if (cur) return cur;
  return (await ctx.repo.insert("CallSessions", [{ id: input.id, founder_key: founder, list_id: input.list_id ?? "", started_at: new Date().toISOString(), ended_at: null, notes: input.kind === "linkedin" ? LINKEDIN_SESSION : "" }], { founder }))[0];
}
export const endSessionSchema = z.object({ id: z.string().uuid() });
export async function endSession(ctx: AppContext, founder: FounderKey, id: string) {
  const cur = await ctx.repo.get("CallSessions", id, { fresh: true });
  if (!cur) throw new RuleError("Session not found");
  if (cur.ended_at) return cur;
  return ctx.repo.update("CallSessions", id, cur.version, { ended_at: new Date().toISOString() }, { founder });
}

/**
 * Next numbers to call from a list: call-backs whose time has come first (soonest first, D080, from any list), then
 * due call-backs of open deals, then businesses never called. Blocked ones never appear. A business with a call-back
 * set for later waits for it.
 */
export async function callQueue(ctx: AppContext, founder: FounderKey, listId: string, limit = 25, now = new Date()) {
  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList", "ActivityEvents", "Opportunities"]);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(now, u.timezone);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const lastCall = new Map<string, (typeof events)[number]>();
  for (const e of events) if (e.account_id && ["cold_call", "connected_call", "voicemail", "field_visit"].includes(e.activity_type)) lastCall.set(e.account_id, e);
  const mine = (a: Row<"Accounts">) => !a.is_archived && a.phone && (!a.owner_founder || a.owner_founder === founder);
  const accounts = t.Accounts.rows.filter((a) => mine(a) && (listId ? a.list_id === listId || a.import_batch_id === listId : true));
  const blocked = (a: Row<"Accounts">) => {
    const cs = t.Contacts.rows.filter((c) => c.account_id === a.id);
    return outreachBlock(null, a, t.SuppressionList.rows).blocked || (cs.length > 0 && cs.every((c) => outreachBlock(c, a, t.SuppressionList.rows).blocked));
  };
  // Call-backs set with a time (D080): due ones lead the queue, later ones keep the business out of it until then.
  const timed = openCallbacks(events, founder).filter((e) => e.next_action_at);
  const callbackAt = new Map(timed.map((e) => [e.account_id, e.next_action_at!]));
  const byId = new Map(t.Accounts.rows.map((a) => [a.id, a]));
  const timedDue = timed.filter((e) => isCallbackDue(e, now, today)).map((e) => byId.get(e.account_id)).filter((a): a is Row<"Accounts"> => Boolean(a && mine(a)));
  const dueBack = accounts.filter((a) => {
    if (callbackAt.has(a.id)) return false;
    const o = t.Opportunities.rows.find((x) => x.account_id === a.id && isOpen(x));
    // Not twice the same day: someone just called is not "due" again until tomorrow.
    return o && o.next_action_due && o.next_action_due <= today && ["contacted", "replied"].includes(o.stage) && (lastCall.get(a.id)?.local_date ?? "") < today;
  });
  const fresh = accounts.filter((a) => !callbackAt.has(a.id) && (!lastCall.has(a.id) || (lastCall.get(a.id)!.outcome === "no_answer" && lastCall.get(a.id)!.local_date < today)));
  const seen = new Set<string>();
  const out = [];
  for (const [why, list] of [["Call back due", timedDue], ["Call back due", dueBack], ["New", fresh]] as const) {
    for (const a of list) {
      if (seen.has(a.id) || blocked(a)) continue;
      seen.add(a.id);
      const last = lastCall.get(a.id);
      const contacts = t.Contacts.rows.filter((c) => c.account_id === a.id);
      out.push({
        accountId: a.id, name: a.name, phone: a.phone, city: a.city, niche: a.niche, country: a.country, why: why === "New" && last ? `No answer on ${last.local_date}` : why,
        contactName: contacts[0]?.full_name ?? "", email: contacts.find((c) => c.email)?.email || a.email, brand: a.brand,
        callbackAt: callbackAt.get(a.id) ?? null, consent: contacts.some((c) => c.consent_status === "consented"),
      });
    }
  }
  return { remaining: out.length, queue: out.slice(0, limit) };
}

/* ---------------- Round 11 (D080): call-backs set after a call ---------------- */

export const callbackSchema = z.object({
  /** The call's own idempotency key: the call-back is written on that event. */
  idempotency_key: z.string().uuid(),
  at: z.string().datetime({ offset: true }),
  /** Free dialling, a number not in the CRM: the business to call back (created with the number, or matched by name). */
  account_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  business_name: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  market: z.enum(MARKETS).nullable().default(null),
});
const CALL_TYPES = ["cold_call", "connected_call", "voicemail"];

/**
 * Sets (or moves) the call-back of a logged call: written on the call's event (`next_action`, `next_action_due`, the
 * new `next_action_at`), version-checked, and on the open deal's next step. The same time twice changes nothing.
 * Suppression is checked again: an opted-out business is never scheduled.
 */
export async function scheduleCallback(ctx: AppContext, founder: FounderKey, input: z.infer<typeof callbackSchema>, now = new Date()) {
  const { rows } = await ctx.repo.list("ActivityEvents", { fresh: true });
  const ev = dedupeEvents(rows).find((e) => e.idempotency_key === input.idempotency_key);
  if (!ev || ev.founder_key !== founder || !CALL_TYPES.includes(ev.activity_type)) throw new RuleError("Call not found: log it first.");
  const at = new Date(input.at).toISOString();
  if (Date.parse(at) < now.getTime() - 5 * 60_000) throw new RuleError("Pick a time in the future.");
  const u = await userRow(ctx.repo, founder);
  const due = localDate(new Date(at), u.timezone);
  let accountId = ev.account_id;
  if (!accountId) {
    accountId = (input.account_id || (input.business_name ? await findByName(ctx, founder, input.business_name) : null)) ?? "";
    if (!accountId) {
      if (!input.business_name) throw new RuleError("Name the business to call back.");
      const supp = (await ctx.repo.list("SuppressionList", { fresh: true })).rows;
      const n = normalizePhone(input.phone, input.market ?? ev.market);
      if (n && supp.some((x) => !x.is_archived && x.kind === "phone" && x.value_normalized === n)) throw new BlockedError("This phone number is on the suppression list.");
      accountId = childId(input.idempotency_key, "callback-account");
      if (!(await ctx.repo.get("Accounts", accountId, { fresh: true }))) {
        const country = input.market ?? ev.market ?? "FR";
        await ctx.repo.insert("Accounts", [{
          id: accountId, name: input.business_name, sector: "", niche: "", country, city: "", website: "", domain_normalized: "", phone: input.phone, email: "", linkedin_url: "",
          lead_source: "Call mode", lead_type: "outbound", brand: null, owner_founder: founder, lead_status: "working", observed_problem: "", problem_evidence: "",
          language: country === "FR" ? "fr" : "es", notes: "", import_batch_id: "",
        }], { founder });
      }
    }
  }
  const acc = await ctx.repo.get("Accounts", accountId, { fresh: true });
  if (!acc || acc.is_archived) throw new RuleError("The selected business no longer exists.");
  const supp = (await ctx.repo.list("SuppressionList", { fresh: true })).rows;
  const contacts = (await ctx.repo.list("Contacts", { fresh: true })).rows.filter((c) => c.account_id === acc.id && !c.is_archived);
  const block = outreachBlock(null, acc, supp);
  if (block.blocked || (contacts.length > 0 && contacts.every((c) => outreachBlock(c, acc, supp).blocked))) throw new BlockedError(block.reason ?? "Outreach to this contact is blocked.");
  const duplicate = ev.next_action_at === at && ev.account_id === accountId;
  if (!duplicate) {
    await ctx.repo.update("ActivityEvents", ev.id, ev.version, { account_id: accountId, next_action: "Call back", next_action_due: due, next_action_at: at }, { founder });
    const opp = (await ctx.repo.list("Opportunities", { fresh: true })).rows.find((o) => o.account_id === accountId && isOpen(o));
    if (opp && (opp.next_action_due !== due || opp.next_action !== "Call back")) await ctx.repo.update("Opportunities", opp.id, opp.version, { next_action: "Call back", next_action_due: due }, { founder });
  }
  return { duplicate, at, due, accountId, name: acc.name };
}

/** The founder's call-backs still to make (My Day, Agenda, reminders): soonest first, with whether each is due. */
export async function listCallbacks(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts", "Contacts", "SuppressionList"]);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(now, u.timezone);
  const acc = new Map(t.Accounts.rows.map((a) => [a.id, a]));
  return openCallbacks(dedupeEvents(t.ActivityEvents.rows), founder).flatMap((e) => {
    const a = acc.get(e.account_id);
    if (!a || a.is_archived || outreachBlock(null, a, t.SuppressionList.rows).blocked) return [];
    return [{ key: e.idempotency_key, eventId: e.id, accountId: a.id, name: a.name, phone: a.phone, contact: t.Contacts.rows.find((c) => c.account_id === a.id)?.full_name ?? "", at: e.next_action_at, due: e.next_action_due, isDue: isCallbackDue(e, now, today) }];
  });
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
  /** Downsell ladder (D071): the offer the prospect said yes to (Local or 30/30), only with a positive outcome. */
  offer: z.enum(["local", "thirty"]).nullable().optional(),
  /** Ladder steps offered during the call ("local", "thirty"; the server marks the accepted one "_yes"). */
  offers_pitched: z.array(z.enum(LADDER_STEPS)).max(4).optional(),
});

const ORDER = STAGES;
function forward(cur: Stage, to: Stage): Stage {
  return ORDER.indexOf(to) > ORDER.indexOf(cur) ? to : cur;
}

/**
 * One tap = one event. A "yes" (call back / interested / meeting) creates or advances the deal with a dated next step.
 * Ladder (D071): a yes to Local creates or moves the deal with the Local offer and its monthly price; a yes to 30/30
 * creates no Consulting deal, it marks the business as a 30/30 lead (brand thirty). Offers made are stored on the event.
 */
export async function logCall(ctx: AppContext, founder: FounderKey, input: z.infer<typeof callSchema>) {
  // A session can be unknown to the server after a reload or a restart: recreate it instead of losing the tap.
  const session = (await ctx.repo.get("CallSessions", input.session_id, { fresh: true })) ?? (await startSession(ctx, founder, { id: input.session_id, list_id: input.list_id }));
  if (isPositive(input.outcome) && !input.account_id && !input.business_name.trim()) throw new RuleError("Name the business that said yes so it lands in your pipeline.");
  const offer: LadderOffer | null = input.offer ?? null;
  if (offer && !isPositive(input.outcome)) throw new RuleError("A yes to an offer needs a positive outcome.");
  const pitched = (input.offers_pitched ?? []).map((x) => x.replace(/_yes$/, "") as LadderOffer);
  const offersPitched = ladderRecord(pitched, offer);
  const ev = eventFor(input.outcome);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const due = input.follow_up_date || (input.outcome === "call_back" ? addDays(today, 2) : input.outcome === "interested" ? addDays(today, 1) : input.outcome === "meeting" ? addDays(today, 3) : "");
  const nextAction = offer === "thirty" ? "30/30 lead: check they opened the link" : offer === "local" && input.outcome === "interested" ? "Local: send the offer and start" : input.outcome === "meeting" ? "Meeting" : input.outcome === "interested" ? "Call back: they want to talk" : input.outcome === "call_back" ? "Call back" : "";
  // Free dialling: a business already created during this call (an instant mail named it) is reused, not created twice.
  const sameName = isPositive(input.outcome) && !input.account_id && input.business_name.trim() ? await findByName(ctx, founder, input.business_name) : null;
  if (sameName) input = { ...input, account_id: sameName };
  const positiveNew = isPositive(input.outcome) && !input.account_id;
  // What an offer changes, kept on the event so "Undo" can put it back.
  let before = "";
  if (offer && input.account_id) {
    const acc = await ctx.repo.get("Accounts", input.account_id, { fresh: true });
    const open = (await ctx.repo.list("Opportunities", { fresh: true })).rows.find((o) => o.account_id === input.account_id && isOpen(o));
    before = offer === "thirty" ? `[brand_before=${acc?.brand ?? ""}]` : open ? `[deal_before=${open.brand ?? ""}:${open.value_minor ?? ""}]` : "";
  }
  const res = await logActivity(ctx.repo, founder, logActivitySchema.parse({
    idempotency_key: input.idempotency_key,
    activity_type: ev.activity_type,
    outcome: ev.outcome,
    account_id: input.account_id,
    brand: offer,
    objection: input.objection,
    objections: input.objections,
    replies: input.replies,
    offers_pitched: offersPitched,
    duration_sec: input.duration_sec,
    notes: [input.note, before].filter(Boolean).join(" "),
    next_action: nextAction,
    next_action_due: due,
    call_session_id: input.session_id,
    list_id: session.list_id,
    phone_dialled: input.account_id || positiveNew ? "" : input.phone,
    market: input.market,
    fast_contact: positiveNew ? { company_name: input.business_name, contact_name: input.contact_name, phone: input.phone, email: "", country: input.market ?? "FR", contact_type: input.contact_type, niche: "" } : null,
  }));
  if (res.duplicate || !isPositive(input.outcome)) return { ...res, opportunityId: null };
  if (offer === "thirty") {
    // A 30/30 lead: no Consulting deal, the business carries the 30/30 brand.
    const acc = await ctx.repo.get("Accounts", res.event.account_id, { fresh: true });
    if (acc && acc.brand !== "thirty") await ctx.repo.update("Accounts", acc.id, acc.version, { brand: "thirty" }, { founder });
    return { ...res, opportunityId: null };
  }
  const opportunityId = await advanceDeal(ctx, founder, {
    key: input.idempotency_key, eventId: res.event.id, accountId: res.event.account_id, contactId: res.event.contact_id, target: input.outcome === "meeting" ? "discovery_scheduled" : "replied",
    nextAction, due, high: input.outcome === "meeting", name: input.business_name, market: input.market, reason: offer === "local" ? "Call mode · yes to Local" : "Call mode", offer: offer === "local" ? "local" : null,
  });
  return { ...res, opportunityId };
}

/** A business of this founder with exactly this name (case and spaces ignored), for free dialling. */
export async function findByName(ctx: AppContext, founder: FounderKey, name: string): Promise<string | null> {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return null;
  const { rows } = await ctx.repo.list("Accounts", { fresh: true });
  return rows.find((a) => !a.is_archived && (!a.owner_founder || a.owner_founder === founder) && a.name.trim().toLowerCase().replace(/\s+/g, " ") === n)?.id ?? null;
}

/**
 * A "yes" (phone or LinkedIn) creates the deal, or moves the open one forward (never backwards), with a dated next step.
 * Ids derive from the tap's idempotency key, so a retry never creates a second deal.
 */
export async function advanceDeal(ctx: AppContext, founder: FounderKey, d: { key: string; eventId: string; accountId: string; contactId: string; target: Stage; nextAction: string; due: string; high: boolean; name: string; market: "FR" | "ES" | null; reason: string; offer?: "local" | null }) {
  // A yes to Local (ladder, D071): the deal carries the Local offer and its monthly price.
  const local = d.offer === "local" ? { brand: "local" as const, value_minor: (await offerDefaults(ctx.repo)).local } : null;
  const { rows } = await ctx.repo.list("Opportunities", { fresh: true });
  const opp = rows.find((o) => o.account_id === d.accountId && isOpen(o));
  const acc = await ctx.repo.get("Accounts", d.accountId);
  if (!opp) {
    const id = childId(d.key, "opportunity");
    if (rows.some((o) => o.id === id)) return id;
    await ctx.repo.insert("Opportunities", [{
      id, account_id: d.accountId, primary_contact_id: d.contactId, name: acc?.name ?? d.name, brand: local?.brand ?? "consulting", market: acc?.country ?? d.market,
      stage: d.target, owner_founder: founder, value_minor: local?.value_minor ?? null, currency: "EUR", expected_close: null, next_action: d.nextAction, next_action_due: d.due || null,
      next_action_priority: d.high ? "high" : "normal", next_action_reason: "", lost_reason: "", anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "",
    }], { founder });
    await ctx.repo.insert("OpportunityStageEvents", [{ id: childId(id, "created"), opportunity_id: id, from_stage: null, to_stage: d.target, changed_at: new Date().toISOString(), changed_by: founder, reason: d.reason }], { founder });
    return id;
  }
  const stage = forward(opp.stage, d.target);
  await ctx.repo.update("Opportunities", opp.id, opp.version, { stage, next_action: d.nextAction, next_action_due: d.due || null, owner_founder: opp.owner_founder ?? founder, ...(local ?? {}) }, { founder });
  if (stage !== opp.stage) await ctx.repo.insert("OpportunityStageEvents", [{ id: childId(opp.id, "stage", d.eventId), opportunity_id: opp.id, from_stage: opp.stage, to_stage: stage, changed_at: new Date().toISOString(), changed_by: founder, reason: d.reason }], { founder });
  return opp.id;
}

/** "Undo" right after a tap (call mode shows it for 10 seconds; the server accepts it for 2 minutes). */
export const UNDO_WINDOW_MS = 120_000;
export const undoSchema = z.object({ idempotency_key: z.string().uuid() });
/**
 * Undoes the founder's last tap: the event is archived (the row stays, it no longer counts, D069). A deal created by
 * that tap is archived too; a deal it moved forward goes back to its previous stage.
 */
export async function undoCall(ctx: AppContext, founder: FounderKey, input: z.infer<typeof undoSchema>) {
  const { rows } = await ctx.repo.list("ActivityEvents", { fresh: true });
  const ev = dedupeEvents(rows).find((e) => e.idempotency_key === input.idempotency_key);
  if (!ev || ev.founder_key !== founder) throw new RuleError("Nothing to undo.");
  if (Date.now() - Date.parse(ev.logged_at) > UNDO_WINDOW_MS) throw new RuleError("Too late to undo: correct it in the CRM.");
  const sends = (await ctx.repo.list("EmailSends", { fresh: true })).rows;
  if (ev.account_id && sends.some((x) => x.account_id === ev.account_id && x.status === "sent" && !x.is_archived && (x.sent_at ?? "") >= ev.occurred_at)) throw new RuleError("A message already went out after this call: correct it in the CRM.");
  await ctx.repo.update("ActivityEvents", ev.id, ev.version, { is_archived: true }, { founder });
  // A yes to 30/30 marked the business; a yes to Local changed the open deal's offer: put them back.
  const brandBefore = /\[brand_before=([a-z]*)\]/.exec(ev.notes)?.[1];
  if (brandBefore !== undefined && ev.account_id) {
    const acc = await ctx.repo.get("Accounts", ev.account_id, { fresh: true });
    if (acc && acc.brand === "thirty") await ctx.repo.update("Accounts", acc.id, acc.version, { brand: (brandBefore || null) as Row<"Accounts">["brand"] }, { founder });
  }
  const dealBefore = /\[deal_before=([a-z]*):(\d*)\]/.exec(ev.notes);
  if (dealBefore && ev.account_id) {
    const open = (await ctx.repo.list("Opportunities", { fresh: true })).rows.find((o) => o.account_id === ev.account_id && isOpen(o));
    if (open) await ctx.repo.update("Opportunities", open.id, open.version, { brand: (dealBefore[1] || null) as Row<"Opportunities">["brand"], value_minor: dealBefore[2] ? Number(dealBefore[2]) : null }, { founder });
  }
  const oppId = childId(input.idempotency_key, "opportunity");
  const created = await ctx.repo.get("Opportunities", oppId, { fresh: true });
  if (created && !created.is_archived) await ctx.repo.update("Opportunities", oppId, created.version, { is_archived: true }, { founder });
  else {
    const stageEvents = (await ctx.repo.list("OpportunityStageEvents", { fresh: true })).rows.filter((x) => !x.is_archived && x.id === childId(x.opportunity_id, "stage", ev.id));
    for (const se of stageEvents) {
      const opp = await ctx.repo.get("Opportunities", se.opportunity_id, { fresh: true });
      if (opp && opp.stage === se.to_stage && se.from_stage) await ctx.repo.update("Opportunities", opp.id, opp.version, { stage: se.from_stage }, { founder });
      await ctx.repo.update("OpportunityStageEvents", se.id, se.version, { is_archived: true }, { founder });
    }
  }
  return { undone: true, eventId: ev.id };
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
  const ladder = ladderStats(events.filter((e) => e.call_session_id === id));
  return { session: s, stats, messages, ladder, previous: { sessions: previous.length, pickupRate: avg((x) => x.pickupRate), positiveRate: avg((x) => x.positiveRate), dials: avg((x) => x.dials) } };
}

export async function listSessions(ctx: AppContext, founder: FounderKey) {
  const t = await ctx.repo.listMany(["CallSessions", "ActivityEvents"]);
  const u = await userRow(ctx.repo, founder);
  const events = dedupeEvents(t.ActivityEvents.rows);
  return t.CallSessions.rows.filter((s) => s.founder_key === founder && s.notes !== LINKEDIN_SESSION).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 20)
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
      offer: e.offers_pitched.includes("local_yes") ? "local" : e.offers_pitched.includes("thirty_yes") ? "thirty" : null, offered: e.offers_pitched.map((x) => x.replace(/_yes$/, "")),
    };
  });
}
