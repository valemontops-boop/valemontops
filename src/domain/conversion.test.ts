import { describe, expect, it } from "vitest";
import { conversionByChannel, dealValue, parseSplit, timeSplit } from "./conversion";

let n = 0;
const ev = (type: string, account: string, at: string, extra: Record<string, unknown> = {}) => {
  n++;
  return { id: `e${n}`, idempotency_key: `k${n}`, created_at: at, founder_key: "theo", activity_type: type as never, account_id: account, channel: null, outcome: null, local_date: at.slice(0, 10), occurred_at: at, ...extra };
};
const defaults = { consulting: 150000, local: 10000 };

describe("conversion by channel (iteration 8)", () => {
  it("counts contacts per channel and credits later steps to the last touch; cash uses the offer default", () => {
    const events = [
      ev("cold_call", "a", "2026-11-09T09:00:00Z"),
      ev("connected_call", "a", "2026-11-09T10:00:00Z", { outcome: "meeting_booked" }),
      ev("linkedin_invitation", "b", "2026-11-09T09:00:00Z"),
      ev("linkedin_dm", "b", "2026-11-10T09:00:00Z"),
      ev("qualified_conversation", "b", "2026-11-10T11:00:00Z"),
      ev("meeting_held", "a", "2026-11-11T09:00:00Z"),
      ev("proposal_sent", "a", "2026-11-11T15:00:00Z"),
      ev("cold_email", "c", "2026-11-09T09:00:00Z"),
      ev("cold_call", "c", "2026-11-01T09:00:00Z"), // before the period
    ];
    const rows = conversionByChannel({
      events, from: "2026-11-09", to: "2026-11-15", offerDefaults: defaults,
      opps: [{ id: "o1", account_id: "a", value_minor: null, brand: "consulting" }, { id: "o2", account_id: "b", value_minor: null, brand: "local" }],
      stageEvents: [{ opportunity_id: "o1", to_stage: "won", changed_at: "2026-11-12T10:00:00Z" }, { opportunity_id: "o2", to_stage: "won", changed_at: "2026-11-13T10:00:00Z" }],
    });
    expect(rows.find((r) => r.channel === "phone")).toMatchObject({ contacts: 1, conversations: 1, meetingsBooked: 1, meetingsHeld: 1, proposals: 1, cashMinor: 150000 });
    expect(rows.find((r) => r.channel === "linkedin")).toMatchObject({ contacts: 1, conversations: 1, meetingsBooked: 0, cashMinor: 10000 });
    expect(rows.find((r) => r.channel === "email")).toMatchObject({ contacts: 1, conversations: 0 });
    expect(rows.some((r) => r.channel === "whatsapp")).toBe(false);
  });
  it("uses the entered deal value first", () => {
    expect(dealValue({ value_minor: 300000, brand: "consulting" }, defaults)).toBe(300000);
    expect(dealValue({ value_minor: null, brand: "local" }, defaults)).toBe(10000);
  });
});

describe("time split", () => {
  it("parses the target and falls back to 75/15/10", () => {
    expect(parseSplit("70/20/10")).toEqual({ sales: 70, content: 20, ops: 10 });
    expect(parseSplit("70/20")).toEqual({ sales: 75, content: 15, ops: 10 });
  });
  it("adds outreach minutes to sales and done task minutes to their area", () => {
    const split = timeSplit({
      events: [ev("cold_call", "x", "2026-11-09T09:00:00Z"), ev("cold_call", "y", "2026-11-09T09:10:00Z")],
      minutes: { calls: 30 },
      tasks: [
        { area: "marketing", status: "done", estimated_minutes: 20, completed_at: "2026-11-09T12:00:00Z", owner: "theo" },
        { area: "ops", status: "done", estimated_minutes: 20, completed_at: "2026-11-09T12:00:00Z", owner: "theo" },
        { area: "ops", status: "todo", estimated_minutes: 500, completed_at: null, owner: "theo" },
      ],
      from: "2026-11-09", to: "2026-11-09", target: parseSplit("75/15/10"),
    });
    expect(split).toEqual([
      { area: "sales", minutes: 60, share: 0.6, target: 0.75 },
      { area: "content", minutes: 20, share: 0.2, target: 0.15 },
      { area: "ops", minutes: 20, share: 0.2, target: 0.1 },
    ]);
  });
});
