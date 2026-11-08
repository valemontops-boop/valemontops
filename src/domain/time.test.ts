import { describe, expect, it } from "vitest";
import { addDays, cutoffOf, isLateLogged, localDate, startOfLocalDay, startOfWeek, weekday } from "./time";

describe("time", () => {
  it("computes the local date per founder time zone", () => {
    const t = "2026-11-08T23:30:00Z";
    expect(localDate(t, "Europe/Paris")).toBe("2026-11-09");
    expect(localDate(t, "UTC")).toBe("2026-11-08");
  });
  it("finds local midnight across DST", () => {
    expect(startOfLocalDay("2026-07-01", "Europe/Paris").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfLocalDay("2026-12-01", "Europe/Madrid").toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(cutoffOf("2026-03-28", "Europe/Paris").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(cutoffOf("2026-03-29", "Europe/Paris").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
  it("flags late logging after the local cutoff", () => {
    expect(isLateLogged("2026-11-09T17:00:00Z", "2026-11-09T22:59:00Z", "Europe/Paris")).toBe(false);
    expect(isLateLogged("2026-11-09T17:00:00Z", "2026-11-09T23:00:00Z", "Europe/Paris")).toBe(true);
  });
  it("handles weeks", () => {
    expect(weekday("2026-11-08")).toBe(0);
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
