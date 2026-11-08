import { describe, expect, it } from "vitest";
import { bestPerDay, mapSheet, mergeSheets, parseExportDate, primaryMetricFor, seriesWithGaps } from "./audience";
import { addDays } from "./time";

describe("LinkedIn export mapping", () => {
  it("finds the header row under a title row, maps known columns and reports the rest", () => {
    const grid = [
      ["Aggregated metrics for the selected period"],
      ["Date", "Impressions (organic)", "Impressions (total)", "Clicks (total)", "Reactions (total)", "Comments (total)", "Reposts (total)", "Engagement rate (total)"],
      ["11/02/2026", 10, 120, 4, 6, 1, 1, 0.05],
      [46329, 5, 80, 2, 3, 0, 0, 0.03],
    ];
    const m = mapSheet(grid)!;
    expect(m.headerRow).toBe(1);
    expect(m.mapped).toMatchObject({ "Impressions (total)": "impressions", "Clicks (total)": "link_clicks" });
    expect(m.unrecognized).toEqual(["Impressions (organic)", "Engagement rate (total)"]);
    expect(m.rows[0]).toEqual({ date: "2026-11-02", values: { impressions: 120, link_clicks: 4, interactions: 8 } });
    expect(m.rows[1].date).toBe("2026-11-03");
  });
  it("merges sheets per day and parses dates safely", () => {
    const a = mapSheet([["Date", "Impressions"], ["2026-11-02", 50]])!;
    const b = mapSheet([["Date", "Total followers"], ["2026-11-02", 310]])!;
    expect(mergeSheets([a, b])).toEqual([{ date: "2026-11-02", values: { impressions: 50, followers: 310 } }]);
    expect(parseExportDate("25/11/2026")).toBe("2026-11-25");
    expect(parseExportDate("not a date")).toBeNull();
  });
});

describe("metric honesty", () => {
  it("keeps the most authoritative source per day and leaves gaps visible", () => {
    const rows = [
      { date: "2026-11-01", source: "manual" as const, impressions: 10 },
      { date: "2026-11-01", source: "import" as const, impressions: 12 },
      { date: "2026-11-03", source: "manual" as const, impressions: 9 },
    ];
    const best = bestPerDay(rows);
    expect(best.map((r) => r.impressions)).toEqual([12, 9]);
    expect(seriesWithGaps(best, "2026-11-01", "2026-11-03", (r) => r.impressions, addDays).map((p) => p.value)).toEqual([12, null, 9]);
    expect(primaryMetricFor("instagram")).toBe("views");
    expect(primaryMetricFor("linkedin_page")).toBe("impressions");
  });
});
