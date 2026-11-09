/**
 * Conversion by channel and time split (founder brief round 8). Pure functions.
 *
 * Steps per outbound channel: contacts → conversations → meetings booked → meetings held → proposals sent → cash collected.
 * Contacts = distinct businesses touched on the channel in the period. Later steps are distinct businesses credited to the
 * channel of the event itself when it is an outreach event, else to the last outreach touch on that business before it
 * (same "last touch" rule as the Growth funnels, D050). Cash = value of deals moved to Won in the period: the deal's value,
 * or the default value of its offer (Consulting value / Local monthly price) when none was entered.
 */
import { businessKey, dedupeEvents, type EventLike } from "./activity";
import { channelOf, minutesFor, type ChannelKey } from "./funnels";

export const CONVERSION_CHANNELS: ChannelKey[] = ["phone", "linkedin", "email", "field", "whatsapp"];
export const CONVERSION_STEPS = ["contacts", "conversations", "meetingsBooked", "meetingsHeld", "proposals", "cashMinor"] as const;
export type ConversionStep = (typeof CONVERSION_STEPS)[number];
export const CONVERSION_STEP_LABELS: Record<ConversionStep, string> = {
  contacts: "Contacts",
  conversations: "Conversations",
  meetingsBooked: "Meetings booked",
  meetingsHeld: "Meetings held",
  proposals: "Proposals sent",
  cashMinor: "Cash collected",
};

type Ev = EventLike & { channel: string | null; outcome?: string | null };
interface Opp { id: string; account_id: string; value_minor: number | null; brand: string }
interface StageEv { opportunity_id: string; to_stage: string; changed_at: string }

const CONVERSATION_OUTCOMES = ["conversation", "interested", "callback_requested", "meeting_booked", "demo_booked", "met_owner"];
const isConversation = (e: Ev) =>
  e.activity_type === "qualified_conversation" || e.activity_type === "reply" ||
  ((e.activity_type === "connected_call" || e.activity_type === "field_visit") && CONVERSATION_OUTCOMES.includes(e.outcome ?? ""));
const isBooked = (e: Ev) => e.activity_type === "meeting_booked" || e.outcome === "meeting_booked";

export type ConversionRow = { channel: ChannelKey } & Record<ConversionStep, number>;

/** Deal value in cents: entered value, else the offer default (older "local" rows use the Local price; anything else Consulting). */
export const dealValue = (o: { value_minor: number | null; brand: string }, defaults: { consulting: number; local: number }) =>
  o.value_minor ?? (o.brand === "local" ? defaults.local : o.brand === "thirty" ? 0 : defaults.consulting);

export function conversionByChannel(input: { events: Ev[]; opps: Opp[]; stageEvents: StageEv[]; from: string; to: string; founder?: string | null; offerDefaults: { consulting: number; local: number } }): ConversionRow[] {
  const all = dedupeEvents(input.events);
  const inPeriod = (d: string) => d >= input.from && d <= input.to;
  const mineOnly = (e: Ev) => !input.founder || e.founder_key === input.founder;
  const touches = new Map<string, { at: string; ch: ChannelKey }[]>();
  for (const e of all) {
    const ch = channelOf(e);
    const k = businessKey(e);
    if (ch && k) touches.set(k, [...(touches.get(k) ?? []), { at: e.occurred_at, ch }]);
  }
  const lastTouch = (k: string, at: string): ChannelKey | null => {
    let found: ChannelKey | null = null;
    for (const x of touches.get(k) ?? []) { if (x.at <= at) found = x.ch; else break; }
    return found;
  };
  const sets = new Map<string, Set<string>>();
  const credit = (step: ConversionStep, ch: ChannelKey | null, k: string) => {
    if (!ch || !k) return;
    const key = `${ch}|${step}`;
    sets.set(key, (sets.get(key) ?? new Set()).add(k));
  };
  for (const e of all.filter((x) => inPeriod(x.local_date) && mineOnly(x))) {
    const k = businessKey(e);
    const ch = channelOf(e) ?? lastTouch(k, e.occurred_at);
    if (channelOf(e)) credit("contacts", ch, k);
    if (isConversation(e)) credit("conversations", ch, k);
    if (isBooked(e)) credit("meetingsBooked", ch, k);
    if (e.activity_type === "meeting_held") credit("meetingsHeld", ch, k);
    if (e.activity_type === "proposal_sent") credit("proposals", ch, k);
  }
  const cash = new Map<ChannelKey, number>();
  const opp = new Map(input.opps.map((o) => [o.id, o]));
  const wonOnce = new Set<string>();
  for (const s of input.stageEvents) {
    const o = opp.get(s.opportunity_id);
    if (s.to_stage !== "won" || !o || wonOnce.has(o.id) || !inPeriod(s.changed_at.slice(0, 10))) continue;
    wonOnce.add(o.id);
    const ch = lastTouch(o.account_id, s.changed_at);
    if (ch) cash.set(ch, (cash.get(ch) ?? 0) + dealValue(o, input.offerDefaults));
  }
  const size = (ch: ChannelKey, step: ConversionStep) => sets.get(`${ch}|${step}`)?.size ?? 0;
  return CONVERSION_CHANNELS.map((channel) => ({
    channel,
    contacts: size(channel, "contacts"),
    conversations: size(channel, "conversations"),
    meetingsBooked: size(channel, "meetingsBooked"),
    meetingsHeld: size(channel, "meetingsHeld"),
    proposals: size(channel, "proposals"),
    cashMinor: cash.get(channel) ?? 0,
  })).filter((r) => CONVERSION_STEPS.some((s) => r[s] > 0));
}

/* ---------------- time split ---------------- */

export type TimeArea = "sales" | "content" | "ops";
export const TIME_AREA_LABELS: Record<TimeArea, string> = { sales: "Sales", content: "Content", ops: "Site, tools and analysis" };
export const TIME_SPLIT_SEED: Record<TimeArea, number> = { sales: 75, content: 15, ops: 10 };

/** "75/15/10" → { sales: 75, content: 15, ops: 10 }; anything malformed returns the seed. */
export function parseSplit(raw: string | null | undefined): Record<TimeArea, number> {
  const m = /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/.exec(raw ?? "");
  if (!m) return TIME_SPLIT_SEED;
  const [sales, content, ops] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return sales + content + ops === 100 ? { sales, content, ops } : TIME_SPLIT_SEED;
}

/**
 * Actual working time per area over the period: sales = logged outreach × minutes per action + done sales tasks;
 * content = done marketing tasks; site, tools and analysis = done ops tasks (estimated minutes). Shares are null without data.
 */
export function timeSplit(input: {
  events: Ev[];
  minutes: Partial<Record<string, number>>;
  tasks: { area: string; status: string; estimated_minutes: number | null; completed_at: string | null; owner: string | null }[];
  from: string;
  to: string;
  founder?: string | null;
  target: Record<TimeArea, number>;
}) {
  const min: Record<TimeArea, number> = { sales: 0, content: 0, ops: 0 };
  for (const e of dedupeEvents(input.events)) {
    if (e.local_date < input.from || e.local_date > input.to || (input.founder && e.founder_key !== input.founder)) continue;
    min.sales += minutesFor(e, input.minutes);
  }
  for (const t of input.tasks) {
    const d = t.completed_at?.slice(0, 10);
    if (t.status !== "done" || !d || d < input.from || d > input.to || !t.estimated_minutes || (input.founder && t.owner !== input.founder)) continue;
    min[t.area === "marketing" ? "content" : t.area === "ops" ? "ops" : "sales"] += t.estimated_minutes;
  }
  const total = min.sales + min.content + min.ops;
  return (["sales", "content", "ops"] as const).map((area) => ({ area, minutes: Math.round(min[area]), share: total ? min[area] / total : null, target: input.target[area] / 100 }));
}
