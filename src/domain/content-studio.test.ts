import { describe, expect, it } from "vitest";
import {
  bestByCheckpoint, captureSlot, checklistProgress, columnOf, defaultOwner, defaultSlotFor, defaultUtm, dueCheckpoints, latestSnapshot, nextProductionStage,
  parseChecklist, postPath, sumPaths, utmUrl, weekGrid, DEFAULT_CHECKLISTS, type SnapshotLike,
} from "./content-studio";
import { addDays } from "./time";

const snap = (p: Partial<SnapshotLike>): SnapshotLike => ({
  checkpoint: "h24", source: "manual", availability: "ok", captured_at: "2026-11-10T08:00:00.000Z", views: null, impressions: null, reach: null, likes: null,
  comments: null, saves: null, shares: null, profile_visits: null, link_clicks: null, site_visits: null, leads: null, follows: null, ...p,
});

describe("content pipeline", () => {
  it("derives the Kanban column from the production stage and the language variants", () => {
    expect(columnOf("script", [{ status: "draft" }, { status: "draft" }])).toBe("script");
    expect(columnOf("edit", [{ status: "scheduled" }, { status: "draft" }])).toBe("scheduled");
    expect(columnOf("edit", [{ status: "published" }, { status: "scheduled" }])).toBe("scheduled");
    expect(columnOf("edit", [{ status: "published" }, { status: "published" }])).toBe("published");
    expect(nextProductionStage("idea")).toBe("script");
    expect(nextProductionStage("edit")).toBeNull();
  });
  it("gives French to Théo and Spanish to Pablo; a personal post stays with its author", () => {
    expect(defaultOwner("FR", "reel", "pablo")).toBe("theo");
    expect(defaultOwner("ES", "reel", "theo")).toBe("pablo");
    expect(defaultOwner("ES", "personal_post", "theo")).toBe("theo");
  });
  it("uses the round-8 weekday calendar as default slots", () => {
    expect(defaultSlotFor("reel", "thirty", "FR")?.key).toBe("2-ig-thirty-story-fr");
    expect(defaultSlotFor("reel", "consulting", "ES")?.key).toBe("6-ig-valemont-es");
    expect(defaultSlotFor("brand_post", "thirty", "ES")?.key).toBe("4-li-thirty-es");
    expect(defaultSlotFor("story", null, "FR")?.key).toBe("1-ig-stories-fr");
    expect(defaultSlotFor("vsl", "thirty", "FR")).toBeNull();
  });
  it("places scheduled variants on their slot and keeps off-slot ones visible", () => {
    const g = weekGrid("2026-11-09", [
      { id: "a", slot_key: "2-ig-thirty-story-fr", scheduled_date: "2026-11-10", status: "scheduled" as const },
      { id: "b", slot_key: "", scheduled_date: "2026-11-10", status: "scheduled" as const },
      { id: "c", slot_key: "", scheduled_date: "2026-11-15", status: "scheduled" as const },
    ], addDays);
    const tue = g.days.find((d) => d.weekday === 2)!;
    expect(tue.date).toBe("2026-11-10");
    expect(tue.slots.find((s) => s.slot.key === "2-ig-thirty-story-fr")?.variant?.id).toBe("a");
    expect(tue.extra.map((x) => x.id)).toEqual(["b"]);
    expect(g.sunday.map((x) => x.id)).toEqual(["c"]);
  });
});

describe("publishing checklist and UTM", () => {
  it("falls back to the default checklist when the setting is missing or malformed", () => {
    expect(parseChecklist("instagram", null)).toBe(DEFAULT_CHECKLISTS.instagram);
    expect(parseChecklist("linkedin", "{oops")).toBe(DEFAULT_CHECKLISTS.linkedin);
    expect(parseChecklist("instagram", JSON.stringify([{ key: "hook", label: "Accroche" }]))).toEqual([{ key: "hook", label: "Accroche" }]);
    expect(checklistProgress(DEFAULT_CHECKLISTS.linkedin, ["hook", "cta", "gone"])).toMatchObject({ done: 2, total: 5 });
  });
  it("builds UTM links without touching anything but utm_* and refuses non-https destinations", () => {
    const utm = defaultUtm({ platform: "instagram", brand: "thirty", title: "Ça coûte 30 € ?", lang: "ES", format: "reel", weekStart: "2026-11-09" });
    expect(utm).toEqual({ utm_source: "instagram", utm_medium: "social", utm_campaign: "thirty-2026-11-09", utm_content: "ca-coute-30-reel-es" });
    expect(utmUrl("https://example.com/es?ref=a&utm_source=x", utm)).toBe("https://example.com/es?ref=a&utm_source=instagram&utm_medium=social&utm_campaign=thirty-2026-11-09&utm_content=ca-coute-30-reel-es");
    expect(utmUrl("http://example.com", utm)).toBe("");
    expect(utmUrl("javascript:alert(1)", utm)).toBe("");
  });
});

describe("checkpoints and capture slots", () => {
  const pub = "2026-11-09T10:00:00.000Z";
  it("captures each checkpoint once, inside its window, never before", () => {
    expect(dueCheckpoints(pub, new Date("2026-11-10T09:00:00Z"), new Set())).toEqual([]);
    expect(dueCheckpoints(pub, new Date("2026-11-10T12:00:00Z"), new Set())).toEqual(["h24"]);
    expect(dueCheckpoints(pub, new Date("2026-11-10T12:00:00Z"), new Set(["h24"]))).toEqual([]);
    expect(dueCheckpoints(pub, new Date("2026-11-12T11:00:00Z"), new Set(["h24"]))).toEqual(["h72"]);
    // A missed 24 h capture is not taken at 4 days: it would not be "at equal age".
    expect(dueCheckpoints(pub, new Date("2026-11-13T11:00:00Z"), new Set())).toEqual(["h72"]);
    expect(dueCheckpoints(pub, new Date("2026-12-09T12:00:00Z"), new Set())).toEqual(["d30"]);
    expect(dueCheckpoints(pub, new Date("2026-12-14T12:00:00Z"), new Set())).toEqual([]);
  });
  it("cuts the day into four 6-hour UTC slots", () => {
    expect(captureSlot(new Date("2026-11-09T05:59:59Z"))).toBe("2026-11-09T00");
    expect(captureSlot(new Date("2026-11-09T06:00:00Z"))).toBe("2026-11-09T06");
    expect(captureSlot(new Date("2026-11-09T23:10:00Z"))).toBe("2026-11-09T18");
  });
});

describe("views → leads path", () => {
  it("prefers the API at the same checkpoint and the most mature checkpoint overall", () => {
    const s = [snap({ checkpoint: "h24", source: "manual", views: 90 }), snap({ checkpoint: "h24", source: "api", views: 100 }), snap({ checkpoint: "h72", source: "manual", views: 300 })];
    expect(bestByCheckpoint(s).get("h24")?.views).toBe(100);
    expect(latestSnapshot(s)?.checkpoint).toBe("h72");
  });
  it("never mixes Instagram views with LinkedIn impressions and keeps unknown steps null, not 0", () => {
    const ig = postPath("instagram", snap({ views: 1000, impressions: 5, profile_visits: 40, link_clicks: 12 }));
    const li = postPath("linkedin_page", snap({ views: 7, impressions: 800, link_clicks: 9, leads: 1 }));
    expect(ig).toEqual({ views: 1000, profile_visits: 40, link_clicks: 12, site_visits: null, leads: null });
    expect(li.views).toBe(800);
    expect(postPath("instagram", snap({ availability: "not_available", views: 0 }))).toEqual({ views: null, profile_visits: null, link_clicks: null, site_visits: null, leads: null });
    const sum = sumPaths([ig, postPath("instagram", snap({ views: 500, site_visits: 4 }))]);
    expect(sum.views).toEqual({ value: 1500, posts: 2 });
    expect(sum.site_visits).toEqual({ value: 4, posts: 1 });
    expect(sum.leads).toEqual({ value: null, posts: 0 });
  });
});
