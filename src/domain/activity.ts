import type { ActivityType, FounderKey, Metric } from "./constants";
import { OUTREACH_TYPES } from "./constants";

export interface EventLike {
  id: string;
  idempotency_key: string;
  created_at: string;
  founder_key: FounderKey | string;
  activity_type: ActivityType;
  account_id: string;
  contact_id?: string;
  opportunity_id?: string;
  local_date: string;
  occurred_at: string;
  outcome?: string | null;
  /** Keyed hash of a dialled number that is not in the CRM (call mode). */
  target_key?: string;
}

/** The business an event touches: its account, or the hashed number for a call outside the CRM. */
export const businessKey = (e: Pick<EventLike, "account_id" | "target_key">) => e.account_id || (e.target_key ? `n:${e.target_key}` : "");

/**
 * Exactly-once by derivation (spec 4.2): one logical event per idempotency_key.
 * Earliest created_at wins, then the lowest id.
 */
export function dedupeEvents<E extends EventLike>(events: E[]): E[] {
  const best = new Map<string, E>();
  for (const e of events) {
    // An undone tap (call mode "Undo", within seconds) is archived: the row stays for audit, it no longer counts.
    if ((e as { is_archived?: boolean }).is_archived) continue;
    const prev = best.get(e.idempotency_key);
    if (!prev || e.created_at < prev.created_at || (e.created_at === prev.created_at && e.id < prev.id)) {
      best.set(e.idempotency_key, e);
    }
  }
  return [...best.values()].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
}

export const METRIC_OF_TYPE: Partial<Record<ActivityType, Metric>> = {
  cold_call: "calls",
  connected_call: "calls",
  voicemail: "calls",
  field_visit: "field_visits",
  linkedin_dm: "dms",
  linkedin_invitation: "invitations",
  inmail: "inmails",
  cold_email: "cold_emails",
  follow_up: "follow_ups",
  comment: "comments",
};

export function isOutreach(t: ActivityType): boolean {
  return OUTREACH_TYPES.includes(t);
}

/** Earliest outreach event per account across all founders (dedupe first). */
export function firstTouchByAccount<E extends EventLike>(events: E[]): Map<string, E> {
  const first = new Map<string, E>();
  for (const e of dedupeEvents(events)) {
    const key = businessKey(e);
    if (!key || !isOutreach(e.activity_type)) continue;
    const prev = first.get(key);
    if (!prev || e.occurred_at < prev.occurred_at) first.set(key, e);
  }
  return first;
}

/** Businesses whose first-ever outreach was by `founder` (or anyone if null) within [from, to]. */
export function newBusinessesContacted<E extends EventLike>(
  events: E[],
  founder: string | null,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  for (const [accountId, e] of firstTouchByAccount(events)) {
    if (founder && e.founder_key !== founder) continue;
    if (e.local_date >= from && e.local_date <= to) out.push(accountId);
  }
  return out;
}

export type Tally = Record<Metric, number>;

export function emptyTally(): Tally {
  return { calls: 0, field_visits: 0, dms: 0, invitations: 0, inmails: 0, cold_emails: 0, follow_ups: 0, comments: 0, new_businesses: 0 };
}

/** Counters for one founder and one local day, derived from deduplicated events. */
export function tallyDay<E extends EventLike>(events: E[], founder: string, date: string): Tally {
  const t = emptyTally();
  for (const e of dedupeEvents(events)) {
    if (e.founder_key !== founder || e.local_date !== date) continue;
    const m = METRIC_OF_TYPE[e.activity_type];
    if (m) t[m]++;
  }
  t.new_businesses = newBusinessesContacted(events, founder, date, date).length;
  return t;
}

/** Separate states, never merged (spec 5 Quick Actions). */
export function funnelCounts<E extends EventLike>(events: E[], founder: string | null, from: string, to: string) {
  const c = { attempted: 0, conversations: 0, demos: 0, meetingsBooked: 0, meetingsHeld: 0, proposals: 0, sales: 0 };
  for (const e of dedupeEvents(events)) {
    if (founder && e.founder_key !== founder) continue;
    if (e.local_date < from || e.local_date > to) continue;
    if (isOutreach(e.activity_type)) c.attempted++;
    if (
      e.activity_type === "connected_call" ||
      e.activity_type === "reply" ||
      e.activity_type === "meeting_held" ||
      (e.activity_type === "field_visit" && (e.outcome === "met_owner" || e.outcome === "conversation" || e.outcome === "interested"))
    )
      c.conversations++;
    if (e.activity_type === "demo_shown") c.demos++;
    if (e.activity_type === "meeting_booked" || (e.activity_type === "connected_call" && e.outcome === "meeting_booked")) c.meetingsBooked++;
    if (e.activity_type === "meeting_held") c.meetingsHeld++;
    if (e.activity_type === "proposal_sent") c.proposals++;
    if (e.activity_type === "sale") c.sales++;
  }
  return c;
}
