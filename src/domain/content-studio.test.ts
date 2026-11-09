import { describe, expect, it } from "vitest";
import {
  bestByCheckpoint, bestTimeFor, captureSlot, checklistProgress, columnOf, composeCaption, counters, defaultOwner, defaultSlotFor, defaultUtm, deliverableOf, dueCheckpoints,
  hashtagsIn, inBestHours, latestSnapshot, mediaFit, mediaRefOf, monthGrid, neighbourStage, nextProductionStage, parseChecklist, postPath, recommendedSlots, scheduleConflicts,
  sumPaths, utmUrl, weekGrid, DEFAULT_CHECKLISTS, type MediaRef, type SnapshotLike,
} from "./content-studio";
import { addDays } from "./time";

const snap = (p: Partial<SnapshotLike>): SnapshotLike => ({
  checkpoint: "h24", source: "manual", availability: "ok", captured_at: "2026-11-10T08:00:00.000Z", views: null, impressions: null, reach: null, likes: null,
  comments: null, saves: null, shares: null, profile_visits: null, link_clicks: null, site_visits: null, leads: null, follows: null, ...p,
});

describe("content pipeline", () => {
  it("derives the Kanban column from the production stage and the account versions; old stage names still read", () => {
    expect(columnOf("draft", [{ status: "draft" }, { status: "draft" }])).toBe("draft");
    expect(columnOf("script", [])).toBe("draft");
    expect(columnOf("shoot", [])).toBe("draft");
    expect(columnOf("edit", [])).toBe("ready");
    expect(columnOf("ready", [{ status: "scheduled" }, { status: "draft" }])).toBe("scheduled");
    expect(columnOf("ready", [{ status: "published" }, { status: "scheduled" }])).toBe("scheduled");
    expect(columnOf("ready", [{ status: "published" }, { status: "published", is_archived: false }, { status: "draft", is_archived: true }])).toBe("published");
    expect(nextProductionStage("idea")).toBe("draft");
    expect(nextProductionStage("ready")).toBeNull();
    expect(neighbourStage("ready", 1)).toBe("scheduled");
    expect(neighbourStage("idea", -1)).toBeNull();
  });
  it("gives French to Théo and Spanish to Pablo; a personal profile stays with its founder", () => {
    expect(defaultOwner("FR", null)).toBe("theo");
    expect(defaultOwner("ES", null)).toBe("pablo");
    expect(defaultOwner("ES", "theo")).toBe("theo");
  });
  it("maps type × network to the weekly-goal deliverable", () => {
    expect(deliverableOf("reel", "instagram")).toBe("reel");
    expect(deliverableOf("video", "instagram")).toBe("reel");
    expect(deliverableOf("post", "linkedin_page")).toBe("brand_post");
    expect(deliverableOf("carousel", "linkedin_personal")).toBe("personal_post");
    expect(deliverableOf("carousel", "instagram")).toBe("ig_post");
    expect(deliverableOf("story", "instagram")).toBe("story");
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

describe("planning: conflicts, best hours, recommended slots, month grid", () => {
  const v = (id: string, account_id: string, scheduled_date: string | null, scheduled_time: string, status: "draft" | "scheduled" | "published" = "scheduled") => ({ id, account_id, scheduled_date, scheduled_time, status });
  it("flags two versions on the same account less than an hour apart (or both without a time), never across accounts or drafts", () => {
    const c = scheduleConflicts([
      v("a", "li-theo", "2026-11-10", "08:30"), v("b", "li-theo", "2026-11-10", "09:00"), v("c", "li-theo", "2026-11-10", "12:30"),
      v("d", "li-pablo", "2026-11-10", "08:30"), v("e", "ig-thirty", "2026-11-11", ""), v("f", "ig-thirty", "2026-11-11", "", "published"),
      v("g", "ig-thirty", "2026-11-12", "10:00", "draft"), v("h", "ig-thirty", "2026-11-12", "10:10"),
    ]);
    expect(c.get("a")).toEqual(["b"]);
    expect(c.get("b")).toEqual(["a"]);
    expect(c.has("c")).toBe(false);
    expect(c.has("d")).toBe(false);
    expect(c.get("e")).toEqual(["f"]);
    expect(c.has("g") || c.has("h")).toBe(false);
  });
  it("knows the best windows per network and day", () => {
    expect(inBestHours("linkedin", "2026-11-10", "08:30")?.pick).toBe("08:30"); // Tuesday morning
    expect(inBestHours("linkedin", "2026-11-14", "08:30")).toBeNull(); // Saturday
    expect(inBestHours("instagram", "2026-11-15", "19:15")).not.toBeNull(); // Sunday evening
    expect(inBestHours("instagram", "2026-11-10", "8:5")).toBeNull();
    expect(bestTimeFor("linkedin", "2026-11-10")).toBe("08:30");
    expect(bestTimeFor("linkedin", "2026-11-15")).toBe("");
  });
  it("turns the weekly plan into dated slots on the six accounts", () => {
    const accounts = [
      { id: "li-valemont", platform: "linkedin_page" as const, brand: "consulting" as const, owner_founder: null, handle: "Valemont" },
      { id: "li-thirty", platform: "linkedin_page" as const, brand: "thirty" as const, owner_founder: null, handle: "30/30 AI" },
      { id: "ig-thirty", platform: "instagram" as const, brand: "thirty" as const, owner_founder: null, handle: "30/30 AI" },
    ];
    const r = recommendedSlots("2026-11-09", accounts, addDays);
    expect(r.find((s) => s.key === "1-li-valemont-fr")).toMatchObject({ date: "2026-11-09", time: "09:00", account_id: "li-valemont", network: "linkedin", language: "FR" });
    expect(r.find((s) => s.key === "2-ig-thirty-story-fr")).toMatchObject({ date: "2026-11-10", time: "12:00", account_id: "ig-thirty" });
    expect(r.find((s) => s.key === "1-ig-stories-fr")?.account_id).toBeNull(); // stories: any Instagram account
    expect(r.some((s) => s.key === "5-li-interactions")).toBe(false); // not a post
  });
  it("builds whole Monday-first weeks for a month", () => {
    const m = monthGrid("2026-11-20", addDays);
    expect(m.month).toBe("2026-11");
    expect(m.weeks[0][0]).toBe("2026-10-26");
    expect(m.weeks.at(-1)!.at(-1)).toBe("2026-12-06");
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe("composer: limits, caption, hashtags, media fit", () => {
  const media = (p: Partial<MediaRef>): MediaRef => ({ file_id: "f1", name: "clip.mp4", mime: "video/mp4", web_link: "https://drive.example.com/f1", thumbnail_link: "", width: null, height: null, duration_ms: null, ...p });
  it("composes the pasted caption: link in the LinkedIn post only when chosen, hashtags normalised", () => {
    const f = { hook: "Accroche", caption: "Corps", cta: "Et vous ?", hashtags: "prospection, #Artisans #artisans", link: "https://example.com/?utm_source=linkedin", link_placement: "first_comment" as const };
    expect(composeCaption("linkedin", f)).toBe("Accroche\n\nCorps\n\nEt vous ?\n\n#prospection #Artisans");
    expect(composeCaption("linkedin", { ...f, link_placement: "post" })).toContain("https://example.com/?utm_source=linkedin");
    expect(composeCaption("instagram", { ...f, link_placement: "post" })).not.toContain("https://");
    expect(hashtagsIn("a #b c #B #ñandú")).toEqual(["#b", "#ñandú"]);
  });
  it("counts characters as the apps do and flags the limits", () => {
    const li = counters("linkedin", "x".repeat(3001));
    expect(li).toMatchObject({ chars: 3001, max: 3000, over: true, fold: 210 });
    expect(li.visible).toHaveLength(210);
    const ig = counters("instagram", "🙂".repeat(10) + " #a #b #c #d #e #f");
    expect(ig.chars).toBe(28);
    expect(ig).toMatchObject({ max: 2200, fold: 125, hashtags: 6, hashtagsMax: 5 });
  });
  it("checks media against the type and network, with hints when Drive has no metadata", () => {
    expect(mediaFit("reel", "instagram", [media({ width: 1080, height: 1920, duration_ms: 42_000 })])[0]).toMatchObject({ level: "ok" });
    expect(mediaFit("reel", "instagram", [media({ width: 1920, height: 1080, duration_ms: 120_000 })]).map((f) => f.level)).toEqual(["warn", "warn"]);
    expect(mediaFit("reel", "instagram", [media({ duration_ms: 200_000 })]).some((f) => f.level === "bad")).toBe(true);
    expect(mediaFit("reel", "instagram", [media({})]).map((f) => f.level)).toEqual(["ok", "info", "info"]);
    const slide = (i: number) => media({ file_id: `s${i}`, name: `s${i}.png`, mime: "image/png", width: 1080, height: 1350 });
    expect(mediaFit("carousel", "instagram", [slide(1)]).some((f) => f.message.includes("at least 2"))).toBe(true);
    expect(mediaFit("carousel", "instagram", Array.from({ length: 21 }, (_, i) => slide(i))).some((f) => f.level === "bad")).toBe(true);
    expect(mediaFit("carousel", "linkedin", [media({ mime: "application/pdf", name: "deck.pdf" }), slide(2)]).some((f) => f.level === "bad")).toBe(false);
    expect(mediaFit("video", "linkedin", [media({ duration_ms: 11 * 60_000 })]).some((f) => f.level === "bad")).toBe(true);
    expect(mediaFit("post", "linkedin", [])).toEqual([]);
    expect(mediaFit("post", "instagram", [])[0].level).toBe("warn");
    expect(mediaFit("post", "linkedin", [media({ mime: "application/zip" })])[0].level).toBe("bad");
  });
  it("maps a Drive listing row to a stored reference", () => {
    expect(mediaRefOf({ id: "x", name: "a.mp4", mimeType: "video/mp4", webViewLink: "https://drive.example.com/x", videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "42000" } }))
      .toEqual({ file_id: "x", name: "a.mp4", mime: "video/mp4", web_link: "https://drive.example.com/x", thumbnail_link: "", width: 1080, height: 1920, duration_ms: 42_000 });
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
    expect(utmUrl("https://example.com/", { ...utm, hook: "Accroche", id: "x" } as typeof utm)).toBe("https://example.com/?utm_source=instagram&utm_medium=social&utm_campaign=thirty-2026-11-09&utm_content=ca-coute-30-reel-es");
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
