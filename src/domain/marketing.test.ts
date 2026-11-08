import { describe, expect, it } from "vitest";
import { audienceFit, bySource, countryCode, mapTrafficGrid, recommendations } from "./marketing";

describe("marketing decisions", () => {
  it("normalises countries", () => {
    expect(countryCode("Paris Area, France")).toBe("FR");
    expect(countryCode("España")).toBe("ES");
    expect(countryCode("Lebanon")).toBe("Lebanon");
  });
  it("measures how much of an audience sits in the target markets", () => {
    const f = audienceFit([{ key: "France", value: 300 }, { key: "Belgium", value: 100 }, { key: "Morocco", value: 100 }, { key: "Spain", value: 50 }], ["FR", "ES"])!;
    expect(f.inTarget).toBeCloseTo(350 / 550);
    expect(f.countries[0]).toMatchObject({ country: "FR", target: true });
  });
  it("maps a GA4 traffic export and ranks sources", () => {
    const grid = [
      ["Session source / medium", "Country", "Sessions", "Key events", "Engagement rate"],
      ["instagram / social", "France", "120", "6", "0.4"],
      ["linkedin.com / referral", "Spain", "80", "1", "0.5"],
      ["google / organic", "France", "60", "0", "0.6"],
      ["Grand total", "", "260", "7", ""],
    ];
    const m = mapTrafficGrid(grid, "2026-11-09");
    expect(m.unrecognized).toEqual(["Engagement rate"]);
    expect(m.rows).toHaveLength(3);
    expect(m.rows[0]).toMatchObject({ source: "instagram", medium: "social", sessions: 120, leads: 6, date: "2026-11-09", country: "France" });
    const s = bySource(m.rows.map((r) => ({ ...r, brand: null })));
    expect(s[0]).toMatchObject({ source: "instagram", conversion: 0.05 });
  });
  it("recommends from evidence and never from tiny samples", () => {
    const sources = bySource([
      { date: "d", brand: null, source: "instagram", medium: "social", campaign: "", country: "", sessions: 200, leads: 20, meetings: null, purchases: 0, revenue_minor: 0 },
      { date: "d", brand: null, source: "linkedin", medium: "referral", campaign: "", country: "", sessions: 100, leads: 2, meetings: null, purchases: 0, revenue_minor: 0 },
      { date: "d", brand: null, source: "google", medium: "organic", campaign: "", country: "", sessions: 80, leads: 0, meetings: null, purchases: 0, revenue_minor: 0 },
      { date: "d", brand: null, source: "tiktok", medium: "social", campaign: "", country: "", sessions: 5, leads: 3, meetings: null, purchases: 0, revenue_minor: 0 },
    ]);
    const fit = audienceFit([{ key: "FR", value: 40 }, { key: "BE", value: 40 }, { key: "ES", value: 5 }], ["FR", "ES"]);
    const r = recommendations({ sources, fits: [{ account: "30/30 Instagram", fit, targets: ["FR", "ES"] }], content: [{ label: "Reels", done: 2, target: 6 }] });
    const titles = r.map((x) => x.title);
    expect(titles.some((t) => t.includes("only 53%"))).toBe(true);
    expect(titles.some((t) => t.includes("ES is under-reached"))).toBe(true);
    expect(titles.some((t) => t.startsWith("instagram / social converts best"))).toBe(true);
    expect(titles.some((t) => t.startsWith("google brings visits but no leads"))).toBe(true);
    expect(titles.some((t) => t.includes("tiktok"))).toBe(false);
    expect(r.length).toBeLessThanOrEqual(6);
  });
});
