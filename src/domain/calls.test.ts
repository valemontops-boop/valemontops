import { describe, expect, it } from "vitest";
import { AFTER_OUTCOMES, LADDER_START, afterOutcomes, callbackChoices, callbackTime, isCallbackDue, openCallbacks, callStats, eventFor, isPositive, ladder, ladderRecord, ladderStats, nextStep, resolveAfter, suggestedAfter } from "./calls";
import { afterCallSuggestion, inCallChips } from "./messages";

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
    expect(s.objections).toMatchObject([{ key: "too_expensive", count: 2 }]);
    expect(s.byHour).toEqual([{ hour: 9, dials: 5, pickedUp: 3, positive: 0 }, { hour: 10, dials: 2, pickedUp: 2, positive: 2 }]);
  });
  it("returns null rates instead of dividing by zero", () => {
    expect(callStats([], "UTC")).toMatchObject({ dials: 0, pickupRate: null, positiveRate: null, minutes: null });
  });
});


describe("live call click path (D071)", () => {
  it("new call → picked up → hung up → outcome; not picked up → missed; logged → ready", () => {
    expect(nextStep("ready", "dial")).toBe("ringing");
    expect(nextStep("ringing", "picked_up")).toBe("live");
    expect(nextStep("ringing", "not_picked_up")).toBe("missed");
    expect(nextStep("ringing", "hang_up")).toBe("missed"); // X while it rings = nobody answered
    expect(nextStep("live", "hang_up")).toBe("hungup");
    expect(nextStep("live", "not_picked_up")).toBe("live"); // no way back to "missed" once on the phone
    expect(nextStep("hungup", "back")).toBe("live");
    expect(nextStep("missed", "back")).toBe("ringing");
    expect(nextStep("live", "back")).toBe("ringing"); // "picked up" tapped by mistake: back, nothing logged
    expect(nextStep("ringing", "back")).toBe("ready");
    for (const s of ["ringing", "missed", "live", "hungup"] as const) expect(nextStep(s, "logged")).toBe("ready");
    expect(nextStep("ready", "hang_up")).toBe("ringing"); // "Already called? Log the outcome"
  });
});

describe("downsell ladder: Consulting → Local → 30/30", () => {
  it("offers Local, then 30/30 after a no, and records what was offered and accepted", () => {
    const local = ladder(LADDER_START, "propose");
    expect(local).toEqual({ at: "local", pitched: ["local"], accepted: null });
    expect(ladder(LADDER_START, "yes")).toBe(LADDER_START); // nothing to accept before an offer
    const yesLocal = ladder(local, "yes");
    expect(yesLocal).toMatchObject({ at: "done", accepted: "local" });
    expect(suggestedAfter(yesLocal)).toBe("local_yes");
    const thirty = ladder(local, "no");
    expect(thirty).toEqual({ at: "thirty", pitched: ["local", "thirty"], accepted: null });
    expect(suggestedAfter(ladder(thirty, "yes"))).toBe("thirty_yes");
    const none = ladder(thirty, "no");
    expect(none).toMatchObject({ at: "done", accepted: null });
    expect(suggestedAfter(none)).toBe("not_interested");
    expect(ladder(none, "reset")).toBe(LADDER_START);
  });
  it("shows Local / 30/30 outcomes only once offered", () => {
    expect(afterOutcomes(LADDER_START)).toEqual(["meeting", "call_back", "interested", "not_interested", "gatekeeper"]);
    expect(afterOutcomes(ladder(LADDER_START, "propose"))).toContain("local_yes");
    expect(afterOutcomes(ladder(ladder(LADDER_START, "propose"), "no"))).toEqual([...AFTER_OUTCOMES]);
    expect(resolveAfter("local_yes")).toEqual({ outcome: "interested", offer: "local" });
    expect(resolveAfter("thirty_yes")).toEqual({ outcome: "interested", offer: "thirty" });
    expect(resolveAfter("gatekeeper")).toEqual({ outcome: "gatekeeper", offer: null });
  });
  it("stores offers on the event and counts conversions", () => {
    expect(ladderRecord(["local", "thirty"], "thirty")).toEqual(["local", "thirty_yes"]);
    expect(ladderRecord(["local"], null)).toEqual(["local"]);
    expect(ladderRecord([], "local")).toEqual(["local_yes"]);
    expect(ladderStats([{ offers_pitched: ["local_yes"] }, { offers_pitched: ["local", "thirty_yes"] }, { offers_pitched: ["local", "thirty"] }, { offers_pitched: [] }]))
      .toEqual({ localOffered: 3, localYes: 1, thirtyOffered: 2, thirtyYes: 1 });
  });
});

describe("instant mail during the call", () => {
  it("suggests the deck for 'send me info' / 'no time', the offer's mail after a yes, and 'tried to reach you' when nobody picked up", () => {
    expect(inCallChips({ picked: true, market: "FR", objections: ["send_info"], accepted: null, sent: [] }).suggested).toBe("deck");
    expect(inCallChips({ picked: true, market: "FR", objections: ["no_time"], accepted: null, sent: ["deck"] }).suggested).toBeNull();
    expect(inCallChips({ picked: true, market: "ES", objections: [], accepted: "thirty", sent: [] })).toMatchObject({ suggested: "thirty", chips: ["calendly", "confirm", "deck", "local", "thirty", "thanks"] });
    expect(inCallChips({ picked: false, market: "FR", objections: [], accepted: null, sent: [] })).toEqual({ chips: ["missed", "deck"], suggested: "missed" });
    expect(inCallChips({ picked: false, market: "ES", objections: [], accepted: null, sent: [] }).chips).not.toContain("missed"); // cold: Spain needs consent
  });
  it("does not suggest a message after the call when one already went out during it", () => {
    expect(afterCallSuggestion("meeting", [], "FR", null, ["confirm"])).toBeNull();
    expect(afterCallSuggestion("meeting", [], "FR", null, [])?.suggested).toBe("confirm");
    expect(afterCallSuggestion("interested", [], "FR", "thirty", [])?.suggested).toBe("thirty");
    expect(afterCallSuggestion("gatekeeper", [], "FR", null, [])).toBeNull();
  });
});

describe("call-backs after a missed call (D080)", () => {
  // Local clock: built with the same local-time methods the screen uses, whatever the machine's time zone.
  const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
  it("offers in 2 h, tonight 18:00, tomorrow 9:00 / 14:00 and Monday 9:00, dropping times already past", () => {
    const tue = local(2026, 11, 10, 10, 3); // a Tuesday morning
    expect(callbackTime("in_2h", tue)).toEqual(local(2026, 11, 10, 12, 5)); // rounded up to 5 minutes
    expect(callbackTime("tonight", tue)).toEqual(local(2026, 11, 10, 18));
    expect(callbackTime("tomorrow_9", tue)).toEqual(local(2026, 11, 11, 9));
    expect(callbackTime("tomorrow_14", tue)).toEqual(local(2026, 11, 11, 14));
    expect(callbackTime("monday_9", tue)).toEqual(local(2026, 11, 16, 9));
    expect(callbackChoices(tue).map((c) => c.choice)).toEqual(["in_2h", "tonight", "tomorrow_9", "tomorrow_14", "monday_9"]);
    // 19:00: "tonight 18:00" is gone.
    expect(callbackChoices(local(2026, 11, 10, 19)).map((c) => c.choice)).toEqual(["in_2h", "tomorrow_9", "tomorrow_14", "monday_9"]);
    // Sunday: Monday 9:00 is tomorrow 9:00, shown once. Monday: next Monday.
    expect(callbackChoices(local(2026, 11, 15, 10)).map((c) => c.choice)).toEqual(["in_2h", "tonight", "tomorrow_9", "tomorrow_14"]);
    expect(callbackTime("monday_9", local(2026, 11, 16, 8))).toEqual(local(2026, 11, 23, 9));
  });
  it("is due once its time has come, or from its day when only a date was kept", () => {
    const now = new Date("2026-11-10T14:00:00.000Z");
    expect(isCallbackDue({ next_action_at: "2026-11-10T13:59:00.000Z", next_action_due: "2026-11-10" }, now, "2026-11-10")).toBe(true);
    expect(isCallbackDue({ next_action_at: "2026-11-10T16:00:00.000Z", next_action_due: "2026-11-10" }, now, "2026-11-10")).toBe(false);
    expect(isCallbackDue({ next_action_at: null, next_action_due: "2026-11-10" }, now, "2026-11-10")).toBe(true);
    expect(isCallbackDue({ next_action_at: null, next_action_due: null }, now, "2026-11-10")).toBe(false);
  });
  it("keeps the latest call per business: a later call closes the call-back; soonest first; only the founder's own", () => {
    const c = (account_id: string, occurred_at: string, p: Record<string, unknown> = {}) => ({ account_id, founder_key: "theo", activity_type: "cold_call", outcome: "no_answer", occurred_at, next_action_at: null as string | null, next_action_due: null as string | null, ...p });
    const events = [
      c("a", "2026-11-10T09:00:00Z", { next_action_at: "2026-11-11T08:00:00.000Z" }),
      c("b", "2026-11-10T09:01:00Z", { next_action_at: "2026-11-10T16:00:00.000Z" }),
      c("c", "2026-11-10T09:02:00Z", { next_action_at: "2026-11-10T12:00:00.000Z" }),
      c("c", "2026-11-10T12:05:00Z"), // called again: closed
      c("d", "2026-11-10T09:03:00Z", { activity_type: "connected_call", outcome: "callback_requested", next_action_due: "2026-11-12" }),
      c("e", "2026-11-10T09:04:00Z", { founder_key: "pablo", next_action_at: "2026-11-10T10:00:00.000Z" }),
      c("f", "2026-11-10T09:05:00Z"), // no call-back
    ];
    expect(openCallbacks(events, "theo").map((e) => e.account_id)).toEqual(["b", "a", "d"]);
  });
});
