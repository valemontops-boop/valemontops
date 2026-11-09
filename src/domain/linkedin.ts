import type { ActivityType, Outcome } from "./constants";
import { addDays } from "./time";
import type { LinkedInTemplate } from "./playbook";

/**
 * LinkedIn prospecting session (round 8). There is no LinkedIn API: the app opens the profile and copies the
 * message, the founder acts in LinkedIn / Sales Navigator, then taps the result. One tap = one ActivityEvent.
 * The sequence state of each prospect is derived from those events (invited → accepted → messaged → replied →
 * qualified → meeting); invitation and InMail limits are checked on the server before anything is logged.
 */
export const LINKEDIN_RESULTS = ["invited", "accepted", "messaged", "inmail", "replied", "qualified", "meeting", "not_interested"] as const;
export type LinkedInResult = (typeof LINKEDIN_RESULTS)[number];

export const LINKEDIN_RESULT_LABELS: Record<LinkedInResult, string> = {
  invited: "Invitation sent", accepted: "Accepted", messaged: "Message sent", inmail: "InMail sent", replied: "Replied",
  qualified: "Qualified conversation", meeting: "Meeting booked", not_interested: "Not interested",
};
/** Letters are read by character (AZERTY moves them), digits by physical key (`e.code`, so AZERTY needs no Shift). */
export const LINKEDIN_RESULT_KEYS: Record<LinkedInResult, string> = {
  invited: "I", accepted: "A", messaged: "M", inmail: "N", replied: "R", qualified: "Q", meeting: "7", not_interested: "4",
};
/** The result a key press stands for, if any. */
export function resultForKey(e: { key: string; code: string }): LinkedInResult | null {
  const digit = /^(Digit|Numpad)(\d)$/.exec(e.code)?.[2];
  const k = digit ?? e.key.toUpperCase();
  return (LINKEDIN_RESULTS.find((r) => LINKEDIN_RESULT_KEYS[r] === k) as LinkedInResult | undefined) ?? null;
}

export function linkedinEventFor(r: LinkedInResult): { activity_type: ActivityType; outcome: Outcome | null } {
  switch (r) {
    case "invited": return { activity_type: "linkedin_invitation", outcome: "sent" };
    case "accepted": return { activity_type: "linkedin_accepted", outcome: null };
    case "messaged": return { activity_type: "linkedin_dm", outcome: "sent" };
    case "inmail": return { activity_type: "inmail", outcome: "sent" };
    case "replied": return { activity_type: "reply", outcome: "conversation" };
    case "qualified": return { activity_type: "qualified_conversation", outcome: "interested" };
    case "meeting": return { activity_type: "meeting_booked", outcome: "meeting_booked" };
    case "not_interested": return { activity_type: "reply", outcome: "not_interested" };
  }
}
/** A yes on LinkedIn creates or advances the deal, like a yes on the phone. */
export const isLinkedInYes = (r: LinkedInResult) => r === "qualified" || r === "meeting";

export const LI_STAGES = ["new", "invited", "accepted", "messaged", "replied", "qualified", "meeting"] as const;
export type LiStage = (typeof LI_STAGES)[number] | "closed";
export const LI_STAGE_LABELS: Record<LiStage, string> = {
  new: "Not contacted", invited: "Invited", accepted: "Connected on LinkedIn", messaged: "Messaged", replied: "Replied", qualified: "Qualified", meeting: "Meeting booked", closed: "Not interested",
};

export interface LiEvent { activity_type: string; outcome: string | null; channel: string | null; occurred_at: string; local_date: string }
const LI_TYPES = ["linkedin_invitation", "linkedin_accepted", "linkedin_dm", "inmail"];
/** Events of the LinkedIn sequence: LinkedIn types, plus replies / qualified / meetings logged on the LinkedIn channel. */
export const isLinkedInEvent = (e: Pick<LiEvent, "activity_type" | "channel">) => LI_TYPES.includes(e.activity_type) || (e.channel === "linkedin" && ["reply", "qualified_conversation", "meeting_booked"].includes(e.activity_type));

export interface LiState {
  stage: LiStage;
  invitedAt: string | null;
  acceptedAt: string | null;
  /** Messages (DM or InMail) sent since the last reply, or since the start. */
  messagesSinceReply: number;
  lastTouch: { type: string; outcome: string | null; date: string } | null;
}

/** Sequence state of one prospect from their events (any order). The furthest stage wins; a "no" closes it. */
export function sequenceState(events: readonly LiEvent[]): LiState {
  const ev = events.filter(isLinkedInEvent).slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  let rank = 0;
  let closed = false;
  let invitedAt: string | null = null;
  let acceptedAt: string | null = null;
  let messages = 0;
  const up = (s: (typeof LI_STAGES)[number]) => { rank = Math.max(rank, LI_STAGES.indexOf(s)); };
  for (const e of ev) {
    if (e.activity_type === "linkedin_invitation") { up("invited"); invitedAt ??= e.local_date; }
    else if (e.activity_type === "linkedin_accepted") { up("accepted"); acceptedAt ??= e.local_date; }
    else if (e.activity_type === "linkedin_dm" || e.activity_type === "inmail") { up("messaged"); messages++; }
    else if (e.activity_type === "reply") {
      messages = 0;
      if (e.outcome === "not_interested") closed = true;
      else { up("replied"); closed = false; }
    } else if (e.activity_type === "qualified_conversation") { up("qualified"); closed = false; }
    else if (e.activity_type === "meeting_booked") { up("meeting"); closed = false; }
  }
  const last = ev.at(-1);
  return { stage: closed ? "closed" : LI_STAGES[rank], invitedAt, acceptedAt, messagesSinceReply: messages, lastTouch: last ? { type: last.activity_type, outcome: last.outcome, date: last.local_date } : null };
}

/** Follow-up cadence: J+7 to check an invitation, J+3 then J+7 after a message with no reply, then stop. */
export const LI_CADENCE = { invitationCheck: 7, firstNudge: 3, secondNudge: 7, maxMessages: 3 } as const;

export interface LiNext { template: LinkedInTemplate | null; action: string; due: string | null }
/** What to do next with this prospect and when (null due = nothing planned). Dates are local YYYY-MM-DD. */
export function nextStep(s: LiState): LiNext {
  const last = s.lastTouch?.date ?? null;
  switch (s.stage) {
    case "new": return { template: "invitation", action: "Send an invitation", due: null };
    case "invited": return { template: "first_dm", action: "Check if the invitation was accepted", due: s.invitedAt ? addDays(s.invitedAt, LI_CADENCE.invitationCheck) : null };
    case "accepted": return { template: "first_dm", action: "Send the first message", due: s.acceptedAt ?? last };
    case "messaged":
      if (s.messagesSinceReply >= LI_CADENCE.maxMessages || !last) return { template: null, action: "No reply: sequence finished", due: null };
      return { template: "follow_up", action: "Send a follow-up", due: addDays(last, s.messagesSinceReply === 1 ? LI_CADENCE.firstNudge : LI_CADENCE.secondNudge) };
    case "replied": return { template: null, action: "Qualify the conversation", due: last ? addDays(last, 1) : null };
    case "qualified": return { template: null, action: "Book the meeting", due: last ? addDays(last, 2) : null };
    default: return { template: null, action: "", due: null };
  }
}

/** Next action written on the event itself, so My Day and the follow-up queue pick it up. */
export function nextAfter(result: LinkedInResult, today: string, messagesSinceReply: number): { action: string; due: string } {
  switch (result) {
    case "invited": return { action: "LinkedIn: check if the invitation was accepted", due: addDays(today, LI_CADENCE.invitationCheck) };
    case "accepted": return { action: "LinkedIn: send the first message", due: today };
    case "messaged":
    case "inmail":
      return messagesSinceReply >= LI_CADENCE.maxMessages ? { action: "", due: "" } : { action: "LinkedIn: follow up", due: addDays(today, messagesSinceReply <= 1 ? LI_CADENCE.firstNudge : LI_CADENCE.secondNudge) };
    case "replied": return { action: "LinkedIn: qualify the conversation", due: addDays(today, 1) };
    case "qualified": return { action: "Book the meeting", due: addDays(today, 2) };
    case "meeting": return { action: "Meeting", due: addDays(today, 3) };
    case "not_interested": return { action: "", due: "" };
  }
}

/** Which results make sense now (the others stay available but less prominent). */
export function resultsFor(stage: LiStage): LinkedInResult[] {
  switch (stage) {
    case "new": return ["invited", "inmail", "messaged"];
    case "invited": return ["accepted", "messaged", "inmail"];
    case "accepted": return ["messaged", "replied"];
    case "messaged": return ["replied", "messaged", "qualified", "not_interested"];
    case "replied": return ["qualified", "meeting", "messaged", "not_interested"];
    case "qualified": return ["meeting", "messaged", "not_interested"];
    default: return ["messaged", "replied"];
  }
}

export interface LimitEvent { founder_key: string; activity_type: string; local_date: string }
export interface InvitationLimits { today: number; week: number; daily: number; weekly: number; left: number; blocked: boolean; reason: string | null }
/** Invitations today and over the last 7 days (rolling, like LinkedIn) against the founder's limits. */
export function invitationLimits(events: readonly LimitEvent[], founder: string, today: string, daily: number, weekly: number): InvitationLimits {
  const mine = events.filter((e) => e.founder_key === founder && e.activity_type === "linkedin_invitation");
  const from = addDays(today, -6);
  const todayN = mine.filter((e) => e.local_date === today).length;
  const weekN = mine.filter((e) => e.local_date >= from && e.local_date <= today).length;
  const left = Math.max(0, Math.min(daily - todayN, weekly - weekN));
  const reason = todayN >= daily ? "daily" : weekN >= weekly ? "weekly" : null;
  return { today: todayN, week: weekN, daily, weekly, left, blocked: reason !== null, reason };
}

/** InMail credits used this calendar month (YYYY-MM) against the monthly budget. */
export function inmailCredits(events: readonly LimitEvent[], founder: string, today: string, budget: number): { used: number; budget: number; left: number; blocked: boolean } {
  const month = today.slice(0, 7);
  const used = events.filter((e) => e.founder_key === founder && e.activity_type === "inmail" && e.local_date.startsWith(month)).length;
  return { used, budget, left: Math.max(0, budget - used), blocked: used >= budget };
}

export interface LiStats { invitations: number; accepted: number; messages: number; inmails: number; replies: number; qualified: number; meetings: number; notInterested: number; acceptanceRate: number | null }
/** Session or period counts. Acceptance rate = acceptances / invitations (null below 1 invitation). */
export function linkedinStats(events: readonly LiEvent[]): LiStats {
  const li = events.filter(isLinkedInEvent);
  const n = (f: (e: LiEvent) => boolean) => li.filter(f).length;
  const invitations = n((e) => e.activity_type === "linkedin_invitation");
  const accepted = n((e) => e.activity_type === "linkedin_accepted");
  return {
    invitations, accepted,
    messages: n((e) => e.activity_type === "linkedin_dm"),
    inmails: n((e) => e.activity_type === "inmail"),
    replies: n((e) => e.activity_type === "reply" && e.outcome !== "not_interested"),
    qualified: n((e) => e.activity_type === "qualified_conversation"),
    meetings: n((e) => e.activity_type === "meeting_booked"),
    notInterested: n((e) => e.activity_type === "reply" && e.outcome === "not_interested"),
    acceptanceRate: invitations > 0 ? Math.min(1, accepted / invitations) : null,
  };
}

/** First name from a full name ("Alex Demo" → "Alex"). */
export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";

/** linkedin.com profile URLs only (https, any sub-domain such as fr. or es.); returns the normalised URL or null. */
export function normalizeLinkedInUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    if (!/^\/(in|sales\/lead|sales\/people|pub)\//i.test(u.pathname)) return null;
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
