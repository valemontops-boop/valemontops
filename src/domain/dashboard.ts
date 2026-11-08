import { callStats } from "./calls";
import { businessKey, dedupeEvents, isOutreach, METRIC_OF_TYPE, type EventLike } from "./activity";
import { addDays } from "./time";

type Ev = EventLike & { objection: string | null; outcome?: string | null; market?: string | null };
export interface DashInput { events: Ev[]; accounts: { id: string; niche: string; country: string | null }[]; wonDates: string[]; contentDates: string[]; founder: string | null; tz: string; today: string; days: number }

const CALLS = ["cold_call", "connected_call", "voicemail"];
const isYes = (e: { outcome?: string | null }) => ["interested", "callback_requested", "meeting_booked"].includes(e.outcome ?? "");

function window(events: Ev[], from: string, to: string, founder: string | null) {
  return events.filter((e) => e.local_date >= from && e.local_date <= to && (!founder || e.founder_key === founder));
}

/** Period KPIs and their change vs the previous period of the same length. */
function kpis(evs: Ev[], all: Ev[], won: number, content: number, from: string) {
  const s = callStats(evs as never, "UTC");
  const firstTouch = new Map<string, string>();
  for (const e of all) { const k = businessKey(e); if (k && isOutreach(e.activity_type) && (!firstTouch.has(k) || e.local_date < firstTouch.get(k)!)) firstTouch.set(k, e.local_date); }
  const newBiz = new Set(evs.filter((e) => isOutreach(e.activity_type)).map(businessKey).filter((k) => k && firstTouch.get(k)! >= from)).size;
  return { dials: s.dials, pickupRate: s.pickupRate, yes: evs.filter(isYes).length, yesRate: s.pickedUp ? evs.filter(isYes).length / s.pickedUp : null, meetings: s.meetings + evs.filter((e) => e.activity_type === "meeting_booked").length, newBusinesses: newBiz, won, content };
}

export function dashboard(i: DashInput) {
  const events = dedupeEvents(i.events);
  const from = addDays(i.today, -i.days + 1);
  const prevFrom = addDays(from, -i.days);
  const prevTo = addDays(from, -1);
  const cur = window(events, from, i.today, i.founder);
  const prev = window(events, prevFrom, prevTo, i.founder);
  const cnt = (dates: string[], a: string, b: string) => dates.filter((d) => d >= a && d <= b).length;
  const now = kpis(cur, events, cnt(i.wonDates, from, i.today), cnt(i.contentDates, from, i.today), from);
  const before = kpis(prev, events, cnt(i.wonDates, prevFrom, prevTo), cnt(i.contentDates, prevFrom, prevTo), prevFrom);
  const delta = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : Math.round(((a - b) / b) * 100));

  const daily = [];
  for (let d = from; d <= i.today; d = addDays(d, 1)) {
    const de = cur.filter((e) => e.local_date === d);
    daily.push({ date: d, dials: de.filter((e) => CALLS.includes(e.activity_type)).length, yes: de.filter(isYes).length, outreach: de.filter((e) => isOutreach(e.activity_type)).length });
  }
  const s = callStats(cur as never, i.tz);
  const channels = (["calls", "field_visits", "dms", "invitations", "inmails", "cold_emails", "follow_ups"] as const).map((m) => ({ metric: m, count: cur.filter((e) => METRIC_OF_TYPE[e.activity_type] === m).length }));
  const niche = new Map(i.accounts.map((a) => [a.id, a.niche || "Unknown trade"]));
  const country = new Map(i.accounts.map((a) => [a.id, a.country]));
  const group = (keyOf: (e: Ev) => string) => {
    const m = new Map<string, { dials: number; picked: number; yes: number }>();
    for (const e of cur.filter((x) => CALLS.includes(x.activity_type))) {
      const k = keyOf(e);
      const g = m.get(k) ?? { dials: 0, picked: 0, yes: 0 };
      g.dials++;
      if (e.activity_type === "connected_call") g.picked++;
      if (isYes(e)) g.yes++;
      m.set(k, g);
    }
    return [...m.entries()].map(([key, g]) => ({ key, ...g, yesRate: g.picked ? g.yes / g.picked : null })).sort((a, b) => b.dials - a.dials);
  };
  return {
    from, to: i.today, days: i.days,
    kpis: Object.fromEntries((Object.keys(now) as (keyof typeof now)[]).map((k) => [k, { value: now[k], delta: delta(now[k] as number | null, before[k] as number | null) }])) as Record<keyof ReturnType<typeof kpis>, { value: number | null; delta: number | null }>,
    daily,
    funnel: [{ label: "Dials", value: s.dials }, { label: "Picked up", value: s.pickedUp }, { label: "Said yes", value: now.yes }, { label: "Meetings", value: now.meetings }, { label: "Won", value: now.won }],
    objections: s.objections.slice(0, 6),
    byHour: s.byHour.map((h) => ({ ...h, pickupRate: h.dials ? h.pickedUp / h.dials : null })),
    channels,
    byMarket: group((e) => e.market ?? country.get(e.account_id) ?? "Unknown"),
    byNiche: group((e) => niche.get(e.account_id) ?? "Free dialling").slice(0, 6),
  };
}
