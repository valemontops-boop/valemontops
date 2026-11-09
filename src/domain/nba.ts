import { isOutreach } from "./activity";
import { addDays } from "./time";

export interface NbaItem {
  tier: 1 | 2 | 3 | 4 | 5;
  accountId: string;
  opportunityId: string | null;
  title: string;
  why: string;
}

interface Opp { id: string; account_id: string; stage: string; owner_founder: string | null; next_action: string; next_action_due: string | null; next_action_priority: string | null; is_archived: boolean }
interface Acc { id: string; name: string; niche: string; owner_founder: string | null; is_archived: boolean }
interface Ev { account_id: string; activity_type: string; local_date: string; occurred_at: string; founder_key: string }

const HOT = ["replied", "discovery_scheduled", "qualified", "demo_shown", "proposal_sent", "negotiation"];
const TIER_LABEL = { 1: "Replied, waiting for you", 2: "High-priority follow-up overdue", 3: "Follow-up due", 4: "Hot lead going cold", 5: "New target in the sprint niche" } as const;
export { TIER_LABEL };

/**
 * Deterministic Next Best Action order (spec 5.5): replied and unanswered; overdue high-priority
 * follow-ups; follow-ups due today; hot leads untouched for N days; new targets in the sprint niche.
 * Blocked (opted-out/suppressed) businesses never enter the queue.
 */
export function nextBestActions(input: {
  founder: string;
  today: string;
  accounts: Acc[];
  opps: Opp[];
  events: Ev[]; // deduplicated
  blockedAccountIds: Set<string>;
  staleDays: number;
  sprintNiche: string | null;
  limit?: number;
}): NbaItem[] {
  const { founder, today } = input;
  const mine = (owner: string | null) => !owner || owner === founder;
  const name = new Map(input.accounts.map((a) => [a.id, a.name]));
  const lastEvent = new Map<string, Ev>();
  for (const e of [...input.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) if (e.account_id) lastEvent.set(e.account_id, e);
  const openOpps = input.opps.filter((o) => !o.is_archived && !["won", "lost"].includes(o.stage) && mine(o.owner_founder));
  const out: NbaItem[] = [];
  const seen = new Set<string>();
  const push = (i: NbaItem) => {
    if (seen.has(i.accountId) || input.blockedAccountIds.has(i.accountId)) return;
    seen.add(i.accountId);
    out.push(i);
  };
  const byDue = (a: Opp, b: Opp) => (a.next_action_due ?? "").localeCompare(b.next_action_due ?? "") || a.id.localeCompare(b.id);

  for (const [acc, e] of [...lastEvent].sort((a, b) => a[1].occurred_at.localeCompare(b[1].occurred_at))) {
    if (e.activity_type !== "reply") continue;
    const o = openOpps.find((x) => x.account_id === acc);
    const a = input.accounts.find((x) => x.id === acc);
    if (!o && !(a && mine(a.owner_founder))) continue;
    push({ tier: 1, accountId: acc, opportunityId: o?.id ?? null, title: `Answer ${name.get(acc) ?? "the business"}`, why: `Replied on ${e.local_date}; nothing sent since.` });
  }
  for (const o of openOpps.filter((o) => o.next_action_priority === "high" && o.next_action_due && o.next_action_due < today).sort(byDue))
    push({ tier: 2, accountId: o.account_id, opportunityId: o.id, title: o.next_action || "Follow up", why: `High priority, overdue since ${o.next_action_due}.` });
  for (const o of openOpps.filter((o) => o.next_action_due && o.next_action_due <= today).sort(byDue))
    push({ tier: 3, accountId: o.account_id, opportunityId: o.id, title: o.next_action || "Follow up", why: o.next_action_due! < today ? `Overdue since ${o.next_action_due}.` : "Due today." });
  const staleBefore = addDays(today, -input.staleDays);
  for (const o of openOpps.filter((o) => HOT.includes(o.stage)).sort(byDue)) {
    const last = lastEvent.get(o.account_id);
    if (!last || last.local_date <= staleBefore)
      push({ tier: 4, accountId: o.account_id, opportunityId: o.id, title: `Re-engage ${name.get(o.account_id) ?? ""}`.trim(), why: last ? `Hot lead, no touch since ${last.local_date} (${input.staleDays}+ days).` : "Hot lead with no logged touch." });
  }
  if (input.sprintNiche) {
    const niche = input.sprintNiche.toLowerCase();
    const touched = new Set(input.events.filter((e) => isOutreach(e.activity_type as never)).map((e) => e.account_id));
    for (const a of input.accounts.filter((a) => !a.is_archived && mine(a.owner_founder) && !touched.has(a.id) && a.niche.toLowerCase().includes(niche)).sort((x, y) => x.name.localeCompare(y.name)))
      push({ tier: 5, accountId: a.id, opportunityId: input.opps.find((o) => o.account_id === a.id)?.id ?? null, title: `First contact: ${a.name}`, why: `Never contacted; matches the sprint niche “${input.sprintNiche}”.` });
  }
  return out.slice(0, input.limit ?? 20);
}
