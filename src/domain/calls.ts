import type { ActivityType, Outcome } from "./constants";

/** One tap in call mode = one outcome = one activity event (spec 4.2). */
export const CALL_OUTCOMES = ["no_answer", "voicemail", "gatekeeper", "not_interested", "call_back", "interested", "meeting"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No answer",
  voicemail: "Voicemail",
  gatekeeper: "Gatekeeper",
  not_interested: "Not interested",
  call_back: "Call back later",
  interested: "Wants to talk again",
  meeting: "Meeting booked",
};

export function eventFor(o: CallOutcome): { activity_type: ActivityType; outcome: Outcome } {
  switch (o) {
    case "no_answer": return { activity_type: "cold_call", outcome: "no_answer" };
    case "voicemail": return { activity_type: "voicemail", outcome: "no_answer" };
    case "gatekeeper": return { activity_type: "connected_call", outcome: "gatekeeper" };
    case "not_interested": return { activity_type: "connected_call", outcome: "not_interested" };
    case "call_back": return { activity_type: "connected_call", outcome: "callback_requested" };
    case "interested": return { activity_type: "connected_call", outcome: "interested" };
    case "meeting": return { activity_type: "connected_call", outcome: "meeting_booked" };
  }
}

/** Positive outcomes create or advance a deal; refusals are only counted. */
export const isPositive = (o: CallOutcome) => o === "interested" || o === "meeting" || o === "call_back";

interface CallEv { activity_type: string; outcome: string | null; objection: string | null; objections?: string[] | null; occurred_at: string; duration_sec?: number | null }

/** All objections of a call: the multi-select list plus the legacy single field. */
export const objectionsOf = (e: CallEv) => [...new Set([...(e.objection ? [e.objection] : []), ...(e.objections ?? [])])];
const POSITIVE_OUTCOMES = ["interested", "meeting_booked", "callback_requested"];

export interface CallStats {
  dials: number;
  pickedUp: number;
  decisionMakerReached: number;
  refusals: number;
  callBacks: number;
  interested: number;
  meetings: number;
  pickupRate: number | null;
  positiveRate: number | null; // (interested + meetings) / picked up
  meetingRate: number | null; // meetings / dials
  /** count = calls where it came up; won = of those, calls that still ended in a yes (call back, interested, meeting). */
  objections: { key: string; count: number; won: number; wonRate: number | null }[];
  /** Average talk time of picked-up calls that had the timer running. */
  avgTalkSec: number | null;
  minutes: number | null;
  dialsPerHour: number | null;
  byHour: { hour: number; dials: number; pickedUp: number; positive: number }[];
}

const CALL_TYPES = ["cold_call", "connected_call", "voicemail"];

/** Session / period analytics, from deduplicated events. Rates are null when the denominator is 0. */
export function callStats(events: CallEv[], tz: string, session?: { started_at: string; ended_at: string | null }): CallStats {
  const calls = events.filter((e) => CALL_TYPES.includes(e.activity_type)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const picked = calls.filter((e) => e.activity_type === "connected_call");
  const meetings = picked.filter((e) => e.outcome === "meeting_booked").length;
  const interested = picked.filter((e) => e.outcome === "interested").length;
  const objections = new Map<string, { count: number; won: number }>();
  for (const e of picked) {
    for (const k of objectionsOf(e)) {
      const o = objections.get(k) ?? { count: 0, won: 0 };
      o.count++;
      if (e.outcome && POSITIVE_OUTCOMES.includes(e.outcome)) o.won++;
      objections.set(k, o);
    }
  }
  const timed = picked.filter((e) => typeof e.duration_sec === "number" && e.duration_sec > 0);
  const start = session?.started_at ?? calls[0]?.occurred_at;
  const end = session?.ended_at ?? calls.at(-1)?.occurred_at;
  const minutes = start && end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 60_000) : null;
  const hourFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz });
  const byHour = new Map<number, { dials: number; pickedUp: number; positive: number }>();
  for (const e of calls) {
    const h = Number(hourFmt.format(new Date(e.occurred_at)));
    const b = byHour.get(h) ?? { dials: 0, pickedUp: 0, positive: 0 };
    b.dials++;
    if (e.activity_type === "connected_call") b.pickedUp++;
    if (e.outcome === "interested" || e.outcome === "meeting_booked") b.positive++;
    byHour.set(h, b);
  }
  const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
  return {
    dials: calls.length,
    pickedUp: picked.length,
    decisionMakerReached: picked.filter((e) => e.outcome !== "gatekeeper").length,
    refusals: picked.filter((e) => e.outcome === "not_interested").length,
    callBacks: picked.filter((e) => e.outcome === "callback_requested").length,
    interested,
    meetings,
    pickupRate: ratio(picked.length, calls.length),
    positiveRate: ratio(interested + meetings, picked.length),
    meetingRate: ratio(meetings, calls.length),
    objections: [...objections.entries()].sort((a, b) => b[1].count - a[1].count).map(([key, o]) => ({ key, count: o.count, won: o.won, wonRate: ratio(o.won, o.count) })),
    avgTalkSec: timed.length ? Math.round(timed.reduce((a, e) => a + (e.duration_sec ?? 0), 0) / timed.length) : null,
    minutes: minutes === null ? null : Math.round(minutes),
    dialsPerHour: minutes && minutes >= 5 ? Math.round((calls.length / minutes) * 60) : null,
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, ...v })),
  };
}

/* ---------------- Round 9 (D071): the click path of a live call and the downsell ladder ---------------- */

/**
 * The live call, step by step: [New call] → ringing → [Picked up] (live) or [Not picked up] (missed: no answer or
 * voicemail, logged at once) → during the call: objections, instant mail, the ladder → [Hung up] → one outcome.
 * Round 10 (D076): the ringing screen offers picked up (1), no answer (2) and voicemail (3) side by side, so a missed
 * call is one tap and the next prospect comes up at once ("missed" stays for older callers). "← Back" goes one step
 * back (hungup → live → ringing → ready) and never logs anything.
 */
export type CallStep = "ready" | "ringing" | "missed" | "live" | "hungup";
export type CallFlowAction = "dial" | "picked_up" | "not_picked_up" | "hang_up" | "back" | "logged";
export function nextStep(step: CallStep, a: CallFlowAction): CallStep {
  if (a === "logged") return "ready";
  switch (step) {
    case "ready": return a === "dial" || a === "hang_up" ? "ringing" : step;
    case "ringing": return a === "picked_up" ? "live" : a === "not_picked_up" || a === "hang_up" ? "missed" : a === "back" ? "ready" : step;
    case "missed": return a === "back" ? "ringing" : a === "picked_up" ? "live" : step;
    case "live": return a === "hang_up" ? "hungup" : a === "back" ? "ringing" : step; // "← Back": tapped "picked up" by mistake
    case "hungup": return a === "back" ? "live" : step;
  }
}

/** The two outcomes of a call nobody picked up. */
export const MISSED_OUTCOMES = ["no_answer", "voicemail"] as const satisfies readonly CallOutcome[];

/**
 * Offers (founders, round 9): effort goes 100% to Consulting. Someone who says no to Consulting is offered Local
 * (cheaper, monthly), then 30/30 (the AI product, marketing effort). Each step offered is stored on the call's event
 * (`offers_pitched`): "local" = offered, "local_yes" = offered and accepted; same for "thirty".
 */
export const LADDER_STEPS = ["local", "local_yes", "thirty", "thirty_yes"] as const;
export type LadderStep = (typeof LADDER_STEPS)[number];
export type LadderOffer = "local" | "thirty";
export interface LadderState { at: "idle" | "local" | "thirty" | "done"; pitched: LadderOffer[]; accepted: LadderOffer | null }
export const LADDER_START: LadderState = { at: "idle", pitched: [], accepted: null };
export function ladder(s: LadderState, a: "propose" | "yes" | "no" | "reset"): LadderState {
  if (a === "reset") return LADDER_START;
  if (s.at === "idle") return a === "propose" ? { at: "local", pitched: ["local"], accepted: null } : s;
  if (s.at === "local") return a === "yes" ? { ...s, at: "done", accepted: "local" } : a === "no" ? { at: "thirty", pitched: ["local", "thirty"], accepted: null } : s;
  if (s.at === "thirty") return a === "yes" ? { ...s, at: "done", accepted: "thirty" } : a === "no" ? { ...s, at: "done", accepted: null } : s;
  return s;
}
/** What is stored on the event: each offer pitched, "_yes" for the one the call ended on. */
export function ladderRecord(pitched: readonly LadderOffer[], offer: LadderOffer | null): LadderStep[] {
  const all = [...new Set([...pitched, ...(offer ? [offer] : [])])];
  return all.map((o) => (o === offer ? (`${o}_yes` as LadderStep) : o));
}

/** Outcomes of a picked-up call, in the order of their keys 1–7. Local / 30/30 appear once the ladder offered them. */
export const AFTER_OUTCOMES = ["meeting", "call_back", "interested", "not_interested", "gatekeeper", "local_yes", "thirty_yes"] as const;
export type AfterOutcome = (typeof AFTER_OUTCOMES)[number];
export const AFTER_OUTCOME_LABELS: Record<AfterOutcome, string> = {
  meeting: "Meeting booked", call_back: "Call back", interested: "Interested", not_interested: "Not interested", gatekeeper: "Gatekeeper / switchboard", local_yes: "Yes Local", thirty_yes: "Yes 30/30",
};
export function afterOutcomes(l: LadderState): AfterOutcome[] {
  return AFTER_OUTCOMES.filter((o) => (o === "local_yes" ? l.pitched.includes("local") : o === "thirty_yes" ? l.pitched.includes("thirty") : true));
}
/** The outcome Enter picks after hanging up: the offer accepted on the ladder, a refusal when both were declined. */
export function suggestedAfter(l: LadderState): AfterOutcome | null {
  if (l.accepted === "local") return "local_yes";
  if (l.accepted === "thirty") return "thirty_yes";
  if (l.at === "done") return "not_interested";
  return null;
}
/** An outcome tap → the event's outcome and the offer it carries (Local / 30/30 yes are "interested" with an offer). */
export function resolveAfter(o: AfterOutcome): { outcome: CallOutcome; offer: LadderOffer | null } {
  if (o === "local_yes") return { outcome: "interested", offer: "local" };
  if (o === "thirty_yes") return { outcome: "interested", offer: "thirty" };
  return { outcome: o, offer: null };
}

/** Ladder conversions from deduplicated events: how many were offered Local / 30/30 and how many said yes. */
export function ladderStats(events: readonly { offers_pitched?: readonly string[] | null }[]) {
  const n = (k: string) => events.filter((e) => e.offers_pitched?.includes(k)).length;
  return { localOffered: n("local") + n("local_yes"), localYes: n("local_yes"), thirtyOffered: n("thirty") + n("thirty_yes"), thirtyYes: n("thirty_yes") };
}
