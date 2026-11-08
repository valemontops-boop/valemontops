import { describe, expect, it } from "vitest";
import { testingGuard } from "./ideas";

const i = (id: string, status: string) => ({ id, status, is_archived: false });
describe("Scenario 19: idea focus guard", () => {
  it("a third idea in Testing during a sprint asks which one to park", () => {
    const ideas = [i("a", "testing"), i("b", "testing"), i("c", "new")];
    expect(testingGuard(ideas, "c", true, 2)).toEqual({ ok: false, mustPark: ["a", "b"] });
    expect(testingGuard(ideas, "c", false, 2).ok).toBe(true);
    expect(testingGuard(ideas, "a", true, 2).ok).toBe(true);
  });
});
