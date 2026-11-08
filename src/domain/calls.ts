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

interface CallEv { activity_type: string; outcome: string | null; objection: string | null; occurred_at: string; duration_sec?: number | null }

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
  objections: { key: string; count: number }[];
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
  const objections = new Map<string, number>();
  for (const e of picked) if (e.objection) objections.set(e.objection, (objections.get(e.objection) ?? 0) + 1);
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
    objections: [...objections.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
    minutes: minutes === null ? null : Math.round(minutes),
    dialsPerHour: minutes && minutes >= 5 ? Math.round((calls.length / minutes) * 60) : null,
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ hour, ...v })),
  };
}
