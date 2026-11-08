import { describe, expect, it } from "vitest";
import { findMutualSlots } from "./slots";

const theo = { tz: "Europe/Paris", workdays: [1, 2, 3, 4, 5], availStart: "09:00", availEnd: "18:00" };
const pablo = { tz: "Europe/Madrid", workdays: [1, 2, 3, 4, 5], availStart: "10:00", availEnd: "12:00" };

describe("mutual free slots", () => {
  it("offers three slots inside both availabilities, skipping busy time and weekends", () => {
    const from = new Date("2026-11-07T08:00:00Z"); // Saturday
    const busy = [{ start: new Date("2026-11-09T09:00:00Z"), end: new Date("2026-11-09T10:00:00Z") }]; // Mon 10:00–11:00 Paris
    const slots = findMutualSlots({ busy, founders: [theo, pablo], from, days: 7, durationMin: 30 });
    expect(slots.map((s) => s.start.toISOString())).toEqual(["2026-11-09T10:00:00.000Z", "2026-11-09T10:30:00.000Z", "2026-11-10T09:00:00.000Z"]);
  });
  it("returns nothing when availabilities never overlap", () => {
    expect(findMutualSlots({ busy: [], founders: [{ ...theo, availEnd: "09:30" }, pablo], from: new Date("2026-11-09T00:00:00Z"), days: 3, durationMin: 30 })).toEqual([]);
  });
});
