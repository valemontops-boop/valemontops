/**
 * Content plan (iteration 8). Replaces the per-mode weekly deliverable targets: 3 original video concepts a
 * week, produced in batches — 30/30: 2 concepts → 4 Reels (2 FR + 2 ES); Valemont: 1 concept → 2 Reels (1 FR + 1 ES) —
 * and a fixed weekday publishing calendar. ContentLog rows keep their columns (deliverable, brand, language).
 */
export const DELIVERABLES = ["concept", "reel", "brand_post", "personal_post", "story", "vsl", "ig_post"] as const;
export type Deliverable = (typeof DELIVERABLES)[number];
export const DELIVERABLE_LABELS: Record<Deliverable, string> = {
  concept: "Video concepts",
  reel: "Reels",
  brand_post: "Brand LinkedIn posts",
  personal_post: "Personal LinkedIn posts",
  story: "Instagram stories",
  vsl: "VSL (every 2 weeks)",
  ig_post: "Instagram posts and carousels",
};

export type ContentBrand = "thirty" | "consulting";
type Lang = "FR" | "ES";
/** 30/30 is its own brand; any other brand (consulting, older "local" rows) is Valemont. */
export const contentBrandOf = (b: string | null | undefined): ContentBrand | null => (b === "thirty" ? "thirty" : b ? "consulting" : null);

export interface ContentGoal { key: string; deliverable: Deliverable; brand: ContentBrand; language: Lang | null; label: string; target: number }
export const WEEKLY_CONTENT_GOALS: ContentGoal[] = [
  { key: "concept-thirty", deliverable: "concept", brand: "thirty", language: null, label: "30/30 video concepts", target: 2 },
  { key: "concept-valemont", deliverable: "concept", brand: "consulting", language: null, label: "Valemont video concept", target: 1 },
  { key: "reel-thirty-fr", deliverable: "reel", brand: "thirty", language: "FR", label: "30/30 Reels FR", target: 2 },
  { key: "reel-thirty-es", deliverable: "reel", brand: "thirty", language: "ES", label: "30/30 Reels ES", target: 2 },
  { key: "reel-valemont-fr", deliverable: "reel", brand: "consulting", language: "FR", label: "Valemont Reel FR", target: 1 },
  { key: "reel-valemont-es", deliverable: "reel", brand: "consulting", language: "ES", label: "Valemont Reel ES", target: 1 },
];

export interface PublishSlot { key: string; weekday: number; label: string; deliverable: Deliverable | null; brand: ContentBrand | null; language: Lang | null }
const slot = (weekday: number, key: string, label: string, deliverable: Deliverable | null, brand: ContentBrand | null, language: Lang | null): PublishSlot => ({ key: `${weekday}-${key}`, weekday, label, deliverable, brand, language });
/** Weekday publishing calendar (1 = Monday … 6 = Saturday). */
export const PUBLISHING_CALENDAR: PublishSlot[] = [
  slot(1, "ig-stories-fr", "Instagram Stories FR", "story", null, "FR"),
  slot(1, "ig-stories-es", "Instagram Stories ES", "story", null, "ES"),
  slot(1, "li-valemont-fr", "LinkedIn Valemont FR", "brand_post", "consulting", "FR"),
  slot(2, "ig-thirty-story-fr", "Instagram 30/30 storytelling FR", "reel", "thirty", "FR"),
  slot(2, "li-valemont-es", "LinkedIn Valemont ES", "brand_post", "consulting", "ES"),
  slot(3, "ig-thirty-story-es", "Instagram 30/30 storytelling ES", "reel", "thirty", "ES"),
  slot(3, "li-thirty-fr", "LinkedIn 30/30 FR", "brand_post", "thirty", "FR"),
  slot(4, "ig-thirty-demo-fr", "Instagram 30/30 demo FR", "reel", "thirty", "FR"),
  slot(4, "li-thirty-es", "LinkedIn 30/30 ES", "brand_post", "thirty", "ES"),
  slot(5, "ig-thirty-demo-es", "Instagram 30/30 demo ES", "reel", "thirty", "ES"),
  slot(5, "ig-valemont-fr", "Instagram Valemont FR", "reel", "consulting", "FR"),
  slot(5, "li-interactions", "LinkedIn interactions and analysis", null, null, null),
  slot(6, "ig-valemont-es", "Instagram Valemont ES", "reel", "consulting", "ES"),
];

interface Log { deliverable: Deliverable; local_date: string; founder_key: string; brand?: string | null; language?: string | null }
const matches = (l: Log, x: { deliverable: Deliverable | null; brand: ContentBrand | null; language: Lang | null }) =>
  l.deliverable === x.deliverable && (!x.brand || contentBrandOf(l.brand) === x.brand) && (!x.language || l.language === x.language);

/** This week's progress on the content goals (team), from deduplicated ContentLog rows. */
export function contentProgress(logs: Log[], weekStart: string, weekEnd: string) {
  const inWeek = logs.filter((l) => l.local_date >= weekStart && l.local_date <= weekEnd);
  return WEEKLY_CONTENT_GOALS.map((g) => {
    const done = inWeek.filter((l) => matches(l, g));
    return { ...g, done: done.length, byFounder: { theo: done.filter((l) => l.founder_key === "theo").length, pablo: done.filter((l) => l.founder_key === "pablo").length } };
  });
}

/** The day's planned posts, each marked done when a matching piece was logged that day. */
export function postsFor(logs: Log[], date: string, weekdayOfDate: number) {
  const today = logs.filter((l) => l.local_date === date);
  const used = new Set<Log>();
  return PUBLISHING_CALENDAR.filter((s) => s.weekday === weekdayOfDate).map((s) => {
    const hit = s.deliverable ? today.find((l) => !used.has(l) && matches(l, s)) : undefined;
    if (hit) used.add(hit);
    return { ...s, done: Boolean(hit) };
  });
}
