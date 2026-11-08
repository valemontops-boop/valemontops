import { describe, expect, it } from "vitest";
import { hygieneFlags, stageChangeErrors, weightedValueMinor, type OppLike } from "./pipeline";

const o = (p: Partial<OppLike> = {}): OppLike => ({
  stage: "contacted", next_action: "", next_action_due: null, value_minor: 100_00,
  anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "", is_archived: false, ...p,
});

describe("pipeline hygiene", () => {
  it("flags open opportunities without a dated next action", () => {
    expect(hygieneFlags(o(), "2026-11-09")).toEqual(["No next action with a date"]);
    expect(hygieneFlags(o({ next_action: "Call", next_action_due: "2026-11-08" }), "2026-11-09")).toEqual(["Next action overdue"]);
    expect(hygieneFlags(o({ stage: "won" }), "2026-11-09")).toEqual([]);
  });
  it("requires ANUM to qualify and a reason to lose", () => {
    expect(stageChangeErrors(o(), "qualified", "")[0]).toMatch(/authority, need, urgency, money/);
    expect(stageChangeErrors(o({ anum_authority: "a", anum_need: "n", anum_urgency: "u", anum_money: "m" }), "qualified", "")).toEqual([]);
    expect(stageChangeErrors(o(), "lost", "")).toEqual(["A lost reason is required"]);
  });
  it("weights only open opportunities", () => {
    expect(weightedValueMinor([{ ...o(), probability: 0.5 }, { ...o({ stage: "won" }), probability: 1 }])).toBe(50_00);
  });
});

import { groupOf, leadStatus, nextGroup, stageForGroup, PIPELINE_GROUPS } from "./pipeline";
import { STAGES } from "./constants";

describe("yes-only pipeline", () => {
  it("covers every stage after first contact exactly once; targeted/contacted/lost stay off the board", () => {
    const all = PIPELINE_GROUPS.flatMap((g) => g.stages);
    expect(new Set(all).size).toBe(all.length);
    expect(STAGES.filter((s) => !all.includes(s))).toEqual(["targeted", "contacted", "lost"]);
  });
  it("moves to the column entry stage, keeps a stage already in the column", () => {
    expect(stageForGroup("replied", "meeting")).toBe("discovery_scheduled");
    expect(stageForGroup("demo_shown", "met")).toBe("demo_shown");
    expect(groupOf("negotiation")).toBe("proposal");
    expect(nextGroup("replied")).toBe("meeting");
    expect(nextGroup("won")).toBeNull();
  });
  it("derives a one-word status per business", () => {
    expect(leadStatus({ blocked: false, stage: null, lastOutcome: null, called: false })).toBe("not_called");
    expect(leadStatus({ blocked: false, stage: "contacted", lastOutcome: "not_interested", called: true })).toBe("refused");
    expect(leadStatus({ blocked: false, stage: "replied", lastOutcome: "interested", called: true })).toBe("yes");
    expect(leadStatus({ blocked: true, stage: "replied", lastOutcome: null, called: true })).toBe("opted_out");
  });
});
