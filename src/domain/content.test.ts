import { describe, expect, it } from "vitest";
import { PUBLISHING_CALENDAR, WEEKLY_CONTENT_GOALS, contentProgress, postsFor } from "./content";

describe("content plan (brief round 8)", () => {
  it("3 video concepts a week: 30/30 2 concepts + 4 Reels FR/ES, Valemont 1 concept + 2 Reels FR/ES", () => {
    const sum = (f: (g: (typeof WEEKLY_CONTENT_GOALS)[number]) => boolean) => WEEKLY_CONTENT_GOALS.filter(f).reduce((a, g) => a + g.target, 0);
    expect(sum((g) => g.deliverable === "concept")).toBe(3);
    expect(sum((g) => g.deliverable === "reel" && g.brand === "thirty")).toBe(4);
    expect(sum((g) => g.deliverable === "reel" && g.brand === "consulting")).toBe(2);
  });
  it("counts this week's pieces by brand and language; older Local rows count as Valemont", () => {
    const logs = [
      { deliverable: "reel" as const, brand: "thirty", language: "FR", local_date: "2026-11-09", founder_key: "theo" },
      { deliverable: "reel" as const, brand: "thirty", language: "ES", local_date: "2026-11-10", founder_key: "pablo" },
      { deliverable: "reel" as const, brand: "local", language: "ES", local_date: "2026-11-10", founder_key: "pablo" },
      { deliverable: "reel" as const, brand: "thirty", language: "FR", local_date: "2026-11-01", founder_key: "pablo" }, // last week
    ];
    const p = contentProgress(logs, "2026-11-09", "2026-11-15");
    expect(p.find((x) => x.key === "reel-thirty-fr")).toMatchObject({ done: 1, target: 2, byFounder: { theo: 1, pablo: 0 } });
    expect(p.find((x) => x.key === "reel-valemont-es")).toMatchObject({ done: 1, target: 1 });
  });
  it("lists the weekday's planned posts and marks the ones published", () => {
    expect(PUBLISHING_CALENDAR.filter((s) => s.weekday === 0)).toHaveLength(0); // nothing on Sunday
    const posts = postsFor([{ deliverable: "story", brand: "thirty", language: "ES", local_date: "2026-11-09", founder_key: "pablo" }], "2026-11-09", 1);
    expect(posts.map((p) => [p.label, p.done])).toEqual([["Instagram Stories FR", false], ["Instagram Stories ES", true], ["LinkedIn Valemont FR", false]]);
  });
});
