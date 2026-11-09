import { classifyTraffic, type TrafficGroup } from "./marketing";

/**
 * Funnels across every channel (founder feedback round 5): calls, field visits, LinkedIn, email, WhatsApp
 * (outbound) and three inbound sources (round 8): web browser (search, direct, referral, paid), AI engines
 * (ChatGPT, Perplexity, Claude, Gemini…) and social networks (audience, then the website visits they bring). Results (meetings, deals won) are credited to the channel of
 * the last touch on that business before the result ("last touch"), so each meeting counts once.
 * Time cost uses the minutes-per-action settings, which gives "meetings per hour of work" per channel.
 */

export type ChannelKey = "phone" | "field" | "linkedin" | "email" | "whatsapp";
export type InboundKey = TrafficGroup;
export const CHANNEL_LABELS: Record<ChannelKey | InboundKey | "inbound", string> = {
  phone: "Cold calls", field: "Field visits", linkedin: "LinkedIn", email: "Email", whatsapp: "WhatsApp",
  web: "Web (browser)", ai: "AI engines", social: "Social networks", inbound: "All website visits",
};

interface Ev { activity_type: string; channel: string | null; outcome: string | null; account_id: string; target_key?: string; occurred_at: string; local_date: string }
interface Send { channel: "email" | "whatsapp"; status: string; account_id: string; sent_at: string | null; local_date: string | null; replied_at: string | null; reply_kind: string | null; is_archived?: boolean }
interface StageEv { opportunity_id: string; to_stage: string; changed_at: string }
interface Opp { id: string; account_id: string }
interface Traffic { date: string; source?: string; medium?: string; sessions: number | null; leads: number | null; meetings: number | null; purchases: number | null }

/** Which channel an activity belongs to, or null for non-outreach events. */
export function channelOf(e: { activity_type: string; channel: string | null }): ChannelKey | null {
  switch (e.activity_type) {
    case "cold_call": case "connected_call": case "voicemail": return "phone";
    case "field_visit": return "field";
    case "linkedin_invitation": case "linkedin_dm": case "inmail": case "comment": return "linkedin";
    case "cold_email": return "email";
    case "follow_up": return e.channel === "email" ? "email" : e.channel === "whatsapp" ? "whatsapp" : e.channel === "linkedin" ? "linkedin" : e.channel === "in_person" ? "field" : e.channel === "phone" ? "phone" : null;
    default: return null;
  }
}
/** Minutes of work per touch, from the minutes-per-action settings (spec 5.2 seeds). */
export function minutesFor(e: { activity_type: string }, m: Partial<Record<string, number>>): number {
  const key = { cold_call: "calls", connected_call: "calls", voicemail: "calls", field_visit: "field_visits", linkedin_dm: "dms", linkedin_invitation: "invitations", inmail: "inmails", comment: "comments", cold_email: "cold_emails", follow_up: "follow_ups" }[e.activity_type];
  return key ? m[key] ?? 0 : 0;
}

const YES = ["interested", "callback_requested", "meeting_booked"];
const isMeeting = (e: Ev) => e.activity_type === "meeting_booked" || e.outcome === "meeting_booked";

export interface ChannelFunnel {
  key: ChannelKey | InboundKey | "inbound";
  steps: { label: string; value: number }[];
  touches: number;
  meetings: number;
  won: number;
  hours: number | null;
  meetingsPerHour: number | null;
  touchesPerMeeting: number | null;
}

export function channelFunnels(input: { events: Ev[]; sends: Send[]; opps: Opp[]; stageEvents: StageEv[]; traffic: Traffic[]; from: string; to: string; minutes: Partial<Record<string, number>>; socialReach?: number }) {
  const { from, to } = input;
  const inPeriod = (d: string | null) => Boolean(d && d >= from && d <= to);
  const events = input.events.filter((e) => inPeriod(e.local_date));
  const sends = input.sends.filter((s) => !s.is_archived && s.status === "sent" && inPeriod(s.local_date));

  // Last-touch attribution: every touch on a business, all time (a meeting this month may follow a touch last month).
  const touches = new Map<string, { at: string; ch: ChannelKey }[]>();
  const addTouch = (acc: string, at: string, ch: ChannelKey) => { if (acc) touches.set(acc, [...(touches.get(acc) ?? []), { at, ch }]); };
  for (const e of input.events) { const ch = channelOf(e); if (ch) addTouch(e.account_id, e.occurred_at, ch); }
  for (const s of input.sends) if (!s.is_archived && s.status === "sent" && s.sent_at) addTouch(s.account_id, s.sent_at, s.channel);
  for (const list of touches.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const lastTouch = (acc: string, at: string): ChannelKey | null => {
    const l = touches.get(acc);
    if (!l) return null;
    let found: ChannelKey | null = null;
    for (const x of l) { if (x.at <= at) found = x.ch; else break; }
    return found;
  };

  const meetings = new Map<ChannelKey, Set<string>>();
  for (const e of events.filter(isMeeting)) {
    const ch = channelOf(e) ?? lastTouch(e.account_id, e.occurred_at);
    // Free-dial meetings may have no business record yet: count them by their hashed number.
    const who = e.account_id || (e.target_key ? `n:${e.target_key}` : "");
    if (ch && who) meetings.set(ch, (meetings.get(ch) ?? new Set()).add(who));
  }
  const accOf = new Map(input.opps.map((o) => [o.id, o.account_id]));
  const won = new Map<ChannelKey, Set<string>>();
  for (const s of input.stageEvents.filter((x) => x.to_stage === "won" && inPeriod(x.changed_at.slice(0, 10)))) {
    const acc = accOf.get(s.opportunity_id);
    const ch = acc ? lastTouch(acc, s.changed_at) : null;
    if (ch && acc) won.set(ch, (won.get(ch) ?? new Set()).add(acc));
  }
  const distinct = (xs: { account_id: string; target_key?: string }[]) => new Set(xs.map((x) => x.account_id || (x.target_key ? `n:${x.target_key}` : "")).filter(Boolean)).size;

  const out: ChannelFunnel[] = [];
  const push = (key: ChannelKey, chEvents: Ev[], steps: { label: string; value: number }[]) => {
    const min = chEvents.reduce((a, e) => a + minutesFor(e, input.minutes), 0);
    const m = meetings.get(key)?.size ?? 0;
    const touchesN = steps[0]?.value ?? 0;
    const hours = min > 0 ? min / 60 : null;
    out.push({ key, steps: [...steps, { label: "Meetings", value: m }, { label: "Won", value: won.get(key)?.size ?? 0 }], touches: touchesN, meetings: m, won: won.get(key)?.size ?? 0, hours: hours === null ? null : Math.round(hours * 10) / 10, meetingsPerHour: hours ? Math.round((m / hours) * 100) / 100 : null, touchesPerMeeting: m ? Math.round(touchesN / m) : null });
  };
  const by = (ch: ChannelKey) => events.filter((e) => channelOf(e) === ch);

  const calls = by("phone");
  push("phone", calls, [
    { label: "Dials", value: calls.length },
    { label: "Picked up", value: calls.filter((e) => e.activity_type === "connected_call").length },
    { label: "Said yes", value: calls.filter((e) => YES.includes(e.outcome ?? "")).length },
  ]);
  const visits = by("field");
  push("field", visits, [
    { label: "Visits", value: visits.length },
    { label: "Met the owner", value: visits.filter((e) => ["met_owner", "conversation", "interested"].includes(e.outcome ?? "")).length },
    { label: "Said yes", value: visits.filter((e) => YES.includes(e.outcome ?? "")).length },
  ]);
  const li = by("linkedin");
  const liAccounts = new Set(li.map((e) => e.account_id).filter(Boolean));
  const liReplies = events.filter((e) => e.activity_type === "reply" && (e.channel === "linkedin" || (liAccounts.has(e.account_id) && lastTouch(e.account_id, e.occurred_at) === "linkedin")));
  push("linkedin", li, [
    { label: "Invitations & messages", value: li.length },
    { label: "People reached", value: distinct(li) },
    { label: "Replies", value: new Set(liReplies.map((e) => e.account_id)).size },
  ]);
  for (const ch of ["email", "whatsapp"] as const) {
    const s = sends.filter((x) => x.channel === ch);
    // Every app send also logs an event; emails logged by hand only exist as events. Take the larger count.
    push(ch, by(ch), [
      { label: "Sent", value: Math.max(s.length, by(ch).length) },
      { label: "Replies", value: s.filter((x) => x.replied_at && x.reply_kind !== "bounce").length },
      { label: "Interested", value: s.filter((x) => x.reply_kind === "positive").length },
    ]);
  }
  const tr = input.traffic.filter((x) => inPeriod(x.date));
  const webFunnel = (key: InboundKey | "inbound", rows: Traffic[], first: { label: string; value: number }[] = []): ChannelFunnel => {
    const sum = (k: keyof Traffic) => rows.reduce((a, x) => a + (Number(x[k]) || 0), 0);
    return {
      key,
      steps: [...first, { label: "Visits", value: sum("sessions") }, { label: "Leads", value: sum("leads") }, { label: "Meetings", value: sum("meetings") }, { label: "Purchases", value: sum("purchases") }],
      touches: sum("sessions"), meetings: sum("meetings"), won: sum("purchases"), hours: null, meetingsPerHour: null, touchesPerMeeting: sum("meetings") ? Math.round(sum("sessions") / sum("meetings")) : null,
    };
  };
  // All website visits (kept for the website verdicts), then one funnel per source group.
  const inbound = webFunnel("inbound", tr);
  const groupOf = (x: Traffic) => classifyTraffic(x.source ?? "", x.medium ?? "").group;
  const inboundSources: ChannelFunnel[] = [
    webFunnel("web", tr.filter((x) => groupOf(x) === "web")),
    webFunnel("ai", tr.filter((x) => groupOf(x) === "ai")),
    webFunnel("social", tr.filter((x) => groupOf(x) === "social"), input.socialReach ? [{ label: "Views & impressions", value: input.socialReach }] : []),
  ];

  const outbound = out.filter((c) => c.touches > 0);
  const ranked = outbound.filter((c) => c.meetingsPerHour !== null && c.meetings > 0).sort((a, b) => (b.meetingsPerHour ?? 0) - (a.meetingsPerHour ?? 0));
  const insights: string[] = [];
  if (ranked[0]) insights.push(`Best return on time: ${CHANNEL_LABELS[ranked[0].key]} (${ranked[0].meetingsPerHour} meetings per hour of work).`);
  for (const c of outbound.filter((x) => x.touches >= 20 && x.meetings === 0)) insights.push(`${CHANNEL_LABELS[c.key]}: ${c.touches} touches and no meeting yet. Change the message or the target.`);
  const totalMeetings = outbound.reduce((a, c) => a + c.meetings, 0) + inbound.meetings;
  if (totalMeetings === 0 && outbound.length) insights.push("No meeting in this period yet: keep volume up on the channel with the most replies.");
  return { channels: outbound, all: out, inbound, sources: inboundSources, best: ranked[0]?.key ?? null, totalMeetings, insights };
}
export type Funnels = ReturnType<typeof channelFunnels>;
