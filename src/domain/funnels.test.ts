import { describe, expect, it } from "vitest";
import { channelFunnels, channelOf } from "./funnels";

const ev = (p: Partial<{ activity_type: string; channel: string | null; outcome: string | null; account_id: string; occurred_at: string; local_date: string }>) => ({ activity_type: "cold_call", channel: null, outcome: null, account_id: "a1", occurred_at: "2026-11-02T09:00:00.000Z", local_date: "2026-11-02", ...p });

describe("channel funnels", () => {
  it("classifies every outreach channel", () => {
    expect(channelOf({ activity_type: "connected_call", channel: null })).toBe("phone");
    expect(channelOf({ activity_type: "follow_up", channel: "whatsapp" })).toBe("whatsapp");
    expect(channelOf({ activity_type: "linkedin_dm", channel: null })).toBe("linkedin");
    expect(channelOf({ activity_type: "reply", channel: "email" })).toBeNull();
  });
  it("credits a meeting to the last channel that touched the business, and computes meetings per hour", () => {
    const events = [
      ev({ activity_type: "linkedin_dm", account_id: "a1", occurred_at: "2026-11-01T09:00:00.000Z", local_date: "2026-11-01" }),
      ev({ activity_type: "cold_call", account_id: "a2" }),
      ev({ activity_type: "connected_call", outcome: "interested", account_id: "a1", occurred_at: "2026-11-02T10:00:00.000Z" }),
      ev({ activity_type: "follow_up", channel: "email", account_id: "a1", occurred_at: "2026-11-02T11:00:00.000Z" }),
      ev({ activity_type: "meeting_booked", account_id: "a1", occurred_at: "2026-11-03T09:00:00.000Z", local_date: "2026-11-03" }),
      ev({ activity_type: "connected_call", outcome: "meeting_booked", account_id: "a3" }),
    ];
    const sends = [{ channel: "email" as const, status: "sent", account_id: "a1", sent_at: "2026-11-02T11:00:00.000Z", local_date: "2026-11-02", replied_at: "2026-11-02T15:00:00.000Z", reply_kind: "positive" }];
    const r = channelFunnels({ events, sends, opps: [], stageEvents: [], traffic: [{ date: "2026-11-02", sessions: 100, leads: 3, meetings: 1, purchases: 0 }], from: "2026-11-01", to: "2026-11-30", minutes: { calls: 4, dms: 3, follow_ups: 3 } });
    const phone = r.all.find((c) => c.key === "phone")!;
    const email = r.all.find((c) => c.key === "email")!;
    expect(phone.steps.map((s) => s.value)).toEqual([3, 2, 2, 1, 0]); // dials, picked up, yes, meetings (a3), won
    expect(email.meetings).toBe(1); // a1: last touch before the meeting was the email
    expect(email.steps[1].value).toBe(1); // one reply
    expect(phone.hours).toBe(0.2);
    expect(phone.meetingsPerHour).toBe(5);
    expect(r.inbound.steps.map((s) => s.value)).toEqual([100, 3, 1, 0]);
    expect(r.totalMeetings).toBe(3);
  });
  it("splits inbound traffic into web browser, AI engines and social networks, each with its own funnel", () => {
    const traffic = [
      { date: "2026-11-02", source: "google", medium: "organic", sessions: 40, leads: 2, meetings: 1, purchases: 0 },
      { date: "2026-11-02", source: "(direct)", medium: "(none)", sessions: 10, leads: 0, meetings: null, purchases: 1 },
      { date: "2026-11-02", source: "chatgpt.com", medium: "referral", sessions: 5, leads: 1, meetings: null, purchases: 0 },
      { date: "2026-11-02", source: "instagram", medium: "social", sessions: 20, leads: 0, meetings: null, purchases: 0 },
      { date: "2026-10-01", source: "perplexity.ai", medium: "referral", sessions: 99, leads: 9, meetings: null, purchases: 0 },
    ];
    const r = channelFunnels({ events: [], sends: [], opps: [], stageEvents: [], traffic, from: "2026-11-01", to: "2026-11-30", minutes: {}, socialReach: 1200 });
    const by = (k: string) => r.sources.find((c) => c.key === k)!;
    expect(by("web").steps.map((s) => s.value)).toEqual([50, 2, 1, 1]);
    expect(by("ai").steps.map((s) => s.value)).toEqual([5, 1, 0, 0]);
    expect(by("social").steps.map((s) => [s.label, s.value])).toEqual([["Views & impressions", 1200], ["Visits", 20], ["Leads", 0], ["Meetings", 0], ["Purchases", 0]]);
    expect(r.inbound.touches).toBe(75); // every website visit, once
    expect(r.totalMeetings).toBe(1);
  });
});
