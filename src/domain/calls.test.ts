import { describe, expect, it } from "vitest";
import { callStats, eventFor, isPositive } from "./calls";

const ev = (activity_type: string, outcome: string | null, at: string, objection: string | null = null) => ({ activity_type, outcome, objection, occurred_at: at });

describe("call mode", () => {
  it("maps each tap to exactly one event", () => {
    expect(eventFor("no_answer")).toEqual({ activity_type: "cold_call", outcome: "no_answer" });
    expect(eventFor("meeting")).toEqual({ activity_type: "connected_call", outcome: "meeting_booked" });
    expect(isPositive("not_interested")).toBe(false);
    expect(isPositive("meeting")).toBe(true);
  });
  it("computes dials, pick-ups, refusals, meetings, objections and rates", () => {
    const s = callStats([
      ev("cold_call", "no_answer", "2026-11-09T08:00:00Z"),
      ev("voicemail", "no_answer", "2026-11-09T08:05:00Z"),
      ev("connected_call", "not_interested", "2026-11-09T08:10:00Z", "too_expensive"),
      ev("connected_call", "not_interested", "2026-11-09T08:15:00Z", "too_expensive"),
      ev("connected_call", "gatekeeper", "2026-11-09T08:20:00Z"),
      ev("connected_call", "interested", "2026-11-09T09:00:00Z"),
      ev("connected_call", "meeting_booked", "2026-11-09T09:30:00Z"),
      ev("demo_shown", null, "2026-11-09T09:40:00Z"),
    ], "Europe/Paris");
    expect(s).toMatchObject({ dials: 7, pickedUp: 5, decisionMakerReached: 4, refusals: 2, interested: 1, meetings: 1, minutes: 90, dialsPerHour: 5 });
    expect(s.pickupRate).toBeCloseTo(5 / 7);
    expect(s.positiveRate).toBeCloseTo(2 / 5);
    expect(s.objections).toEqual([{ key: "too_expensive", count: 2 }]);
    expect(s.byHour).toEqual([{ hour: 9, dials: 5, pickedUp: 3, positive: 0 }, { hour: 10, dials: 2, pickedUp: 2, positive: 2 }]);
  });
  it("returns null rates instead of dividing by zero", () => {
    expect(callStats([], "UTC")).toMatchObject({ dials: 0, pickupRate: null, positiveRate: null, minutes: null });
  });
});
