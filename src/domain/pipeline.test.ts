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
