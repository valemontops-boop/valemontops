/**
 * Content Studio (Stage 3 marketing, spec 5.6, D079). Pure rules: pipeline stages, FR/ES variants of one piece,
 * default publishing slots (round 8 calendar), per-platform checklists, UTM links, post checkpoints at equal age,
 * capture slots of the snapshot job (spec 4.11) and the views → profile visits → link clicks → site visits → leads path.
 */
import { PUBLISHING_CALENDAR, type ContentBrand, type Deliverable, type PublishSlot } from "./content";

export const PIECE_STAGES = ["idea", "script", "shoot", "edit", "scheduled", "published"] as const;
export type PieceStage = (typeof PIECE_STAGES)[number];
/** Stages a founder moves by hand; scheduled and published follow the language variants. */
export const PRODUCTION_STAGES = ["idea", "script", "shoot", "edit"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
export const STAGE_LABELS: Record<PieceStage, string> = { idea: "Idea", script: "Script", shoot: "Shooting", edit: "Editing", scheduled: "Scheduled", published: "Published" };

export const CONTENT_FORMATS = ["reel", "story", "brand_post", "personal_post", "vsl"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export const FORMAT_LABELS: Record<ContentFormat, string> = { reel: "Reel", story: "Instagram story", brand_post: "Brand LinkedIn post", personal_post: "Personal LinkedIn post", vsl: "VSL" };

export const VARIANT_STATUSES = ["draft", "scheduled", "published"] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];
export const LANGS = ["FR", "ES"] as const;
export type Lang = (typeof LANGS)[number];

export type ContentPlatform = "instagram" | "linkedin_page" | "linkedin_personal";
export const platformOf = (f: ContentFormat): ContentPlatform => (f === "brand_post" ? "linkedin_page" : f === "personal_post" ? "linkedin_personal" : "instagram");
/** Checklists exist per network: a LinkedIn page and a personal profile share one. */
export type ChecklistPlatform = "instagram" | "linkedin";
export const checklistPlatformOf = (p: ContentPlatform): ChecklistPlatform => (p === "instagram" ? "instagram" : "linkedin");
/** Weekly goals and ContentLog speak in deliverables (src/domain/content.ts). */
export const deliverableOf = (f: ContentFormat): Deliverable => f;
/** Spanish distribution is Pablo's, French is Théo's (spec 5.6); a personal post belongs to its author. */
export const defaultOwner = (lang: Lang, format: ContentFormat, author: "theo" | "pablo"): "theo" | "pablo" => (format === "personal_post" ? author : lang === "ES" ? "pablo" : "theo");

/** Kanban column of a piece: its production stage until a variant is scheduled; published once every variant is out. */
export function columnOf(stage: PieceStage, variants: { status: VariantStatus; is_archived?: boolean }[]): PieceStage {
  const live = variants.filter((v) => !v.is_archived);
  if (live.length && live.every((v) => v.status === "published")) return "published";
  if (live.some((v) => v.status !== "draft")) return "scheduled";
  return PRODUCTION_STAGES.includes(stage as ProductionStage) ? stage : "edit";
}
export function nextProductionStage(s: PieceStage): ProductionStage | null {
  const i = PRODUCTION_STAGES.indexOf(s as ProductionStage);
  return i >= 0 && i < PRODUCTION_STAGES.length - 1 ? PRODUCTION_STAGES[i + 1] : null;
}

/** The default slot of the round-8 calendar for a variant (format + brand + language), or null when none fits. */
export function defaultSlotFor(format: ContentFormat, brand: ContentBrand | null, lang: Lang): PublishSlot | null {
  return PUBLISHING_CALENDAR.find((s) => s.deliverable === format && (!s.brand || s.brand === brand) && (!s.language || s.language === lang)) ?? null;
}
/** Date of a weekday slot in the week starting on Monday `weekStart` (YYYY-MM-DD). */
export function slotDate(weekStart: string, weekday: number, addDays: (d: string, n: number) => string) {
  return addDays(weekStart, weekday - 1);
}

/** Week grid: every default slot of the week with the variant planned on it (by slot key and date), plus off-slot variants. */
export function weekGrid<V extends { id: string; slot_key: string; scheduled_date: string | null; status: VariantStatus }>(
  weekStart: string, variants: V[], addDays: (d: string, n: number) => string,
) {
  const used = new Set<string>();
  const days = [1, 2, 3, 4, 5, 6].map((wd) => {
    const date = slotDate(weekStart, wd, addDays);
    const slots = PUBLISHING_CALENDAR.filter((s) => s.weekday === wd).map((s) => {
      const v = variants.find((x) => !used.has(x.id) && x.scheduled_date === date && x.slot_key === s.key);
      if (v) used.add(v.id);
      return { slot: s, variant: v ?? null };
    });
    const extra = variants.filter((x) => !used.has(x.id) && x.scheduled_date === date);
    extra.forEach((x) => used.add(x.id));
    return { weekday: wd, date, slots, extra };
  });
  const sunday = addDays(weekStart, 6);
  return { days, sunday: variants.filter((x) => !used.has(x.id) && x.scheduled_date === sunday) };
}

/* ---------- publishing checklist ---------- */

export interface ChecklistItem { key: string; label: string }
/** Default items; `label` is an English key translated on screen. A founder can rename, remove or add items. */
export const DEFAULT_CHECKLISTS: Record<ChecklistPlatform, ChecklistItem[]> = {
  instagram: [
    { key: "hook", label: "Hook in the first 2 seconds" },
    { key: "subtitles", label: "Subtitles in the variant's language" },
    { key: "cover", label: "Cover image" },
    { key: "caption", label: "Caption in the variant's language" },
    { key: "cta", label: "Call to action" },
    { key: "link", label: "Link with UTM (bio or link sticker)" },
    { key: "hashtags", label: "Hashtags" },
    { key: "end_screen", label: "End screen" },
    { key: "drive", label: "Final video saved in Drive" },
  ],
  linkedin: [
    { key: "hook", label: "Hook in the first 2 lines" },
    { key: "visual", label: "Visual or video with subtitles" },
    { key: "cta", label: "Call to action" },
    { key: "link", label: "Link with UTM (in the first comment)" },
    { key: "hashtags", label: "3 hashtags at most" },
  ],
};
export const checklistKey = (p: ChecklistPlatform) => `content_checklist_${p}`;
/** Reads the edited checklist (JSON setting) or the default. Malformed values fall back to the default. */
export function parseChecklist(p: ChecklistPlatform, raw: string | null | undefined): ChecklistItem[] {
  if (!raw) return DEFAULT_CHECKLISTS[p];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v) && v.length <= 30 && v.every((i) => i && typeof i.key === "string" && typeof i.label === "string" && i.key.length <= 40 && i.label.length <= 120)) return v as ChecklistItem[];
  } catch { /* default below */ }
  return DEFAULT_CHECKLISTS[p];
}
export function checklistProgress(items: ChecklistItem[], done: string[]) {
  const set = new Set(done);
  const missing = items.filter((i) => !set.has(i.key));
  return { done: items.length - missing.length, total: items.length, missing };
}

/* ---------- UTM ---------- */

const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "piece";
export function defaultUtm(i: { platform: ContentPlatform; brand: ContentBrand | null; title: string; lang: Lang; format: ContentFormat; weekStart: string }) {
  return {
    utm_source: i.platform === "instagram" ? "instagram" : "linkedin",
    utm_medium: "social",
    utm_campaign: `${i.brand === "thirty" ? "thirty" : "valemont"}-${i.weekStart}`,
    utm_content: `${slug(i.title)}-${i.format}-${i.lang.toLowerCase()}`,
  };
}
/** Destination URL with the UTM parameters (existing query kept, utm_* replaced). Empty when the URL is not https. */
export function utmUrl(dest: string, utm: { utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string }) {
  if (!/^https:\/\/[^\s"'<>]+$/.test(dest)) return "";
  try {
    const u = new URL(dest);
    for (const [k, v] of Object.entries(utm)) if (v) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return "";
  }
}

/* ---------- post checkpoints (spec 5.6: compare posts at equal age) ---------- */

export const CHECKPOINTS = [
  { key: "h24", hours: 24, label: "24 h" },
  { key: "h72", hours: 72, label: "72 h" },
  { key: "d7", hours: 168, label: "7 days" },
  { key: "d30", hours: 720, label: "30 days" },
] as const;
export type CheckpointKey = (typeof CHECKPOINTS)[number]["key"];
export const SNAPSHOT_CHECKPOINTS = ["h24", "h72", "d7", "d30", "live"] as const;
export type SnapshotCheckpoint = (typeof SNAPSHOT_CHECKPOINTS)[number];

/**
 * The checkpoint a capture at `now` stands for, if it is due: age ≥ its hours and still before the next checkpoint
 * (the 30-day one closes 3 days later). A late capture keeps its real age (age_hours) so it is never passed off as on time.
 */
export function dueCheckpoints(publishedAt: string, now: Date, have: Set<string>): CheckpointKey[] {
  const age = (now.getTime() - Date.parse(publishedAt)) / 3_600_000;
  return CHECKPOINTS.filter((c, i) => {
    const close = CHECKPOINTS[i + 1]?.hours ?? c.hours + 72;
    return age >= c.hours && age < close && !have.has(c.key);
  }).map((c) => c.key);
}

/** The scheduler's capture slot: every 6 hours in UTC (spec 4.11), e.g. "2026-11-09T06". */
export function captureSlot(now: Date): string {
  const h = Math.floor(now.getUTCHours() / 6) * 6;
  return `${now.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}`;
}

/* ---------- path views → leads ---------- */

export const PATH_METRICS = ["views", "profile_visits", "link_clicks", "site_visits", "leads"] as const;
export type PathMetric = (typeof PATH_METRICS)[number];
export interface SnapshotLike {
  checkpoint: string; source: "api" | "manual"; availability: "ok" | "not_available"; captured_at: string;
  views: number | null; impressions: number | null; reach: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null;
  profile_visits: number | null; link_clicks: number | null; site_visits: number | null; leads: number | null; follows: number | null;
}
const CP_ORDER: Record<string, number> = { live: 0, h24: 1, h72: 2, d7: 3, d30: 4 };
/** One snapshot per checkpoint: the API wins over a hand-entered value at the same checkpoint; a story keeps its latest live capture. */
export function bestByCheckpoint<S extends SnapshotLike>(snaps: S[]): Map<string, S> {
  const out = new Map<string, S>();
  for (const s of snaps) {
    const cur = out.get(s.checkpoint);
    const better = !cur || (s.source === "api" && cur.source !== "api") || (s.source === cur.source && s.captured_at > cur.captured_at);
    if (better) out.set(s.checkpoint, s);
  }
  return out;
}
/** The most mature checkpoint we have (30 d > 7 d > 72 h > 24 h > live story capture). */
export function latestSnapshot<S extends SnapshotLike>(snaps: S[]): S | null {
  const best = [...bestByCheckpoint(snaps).values()];
  return best.sort((a, b) => (CP_ORDER[b.checkpoint] ?? 0) - (CP_ORDER[a.checkpoint] ?? 0))[0] ?? null;
}
/**
 * The path for one post: the reach measure of the network (Instagram views, LinkedIn impressions — never mixed),
 * then profile visits, link clicks, site visits and leads; null = not known, never 0.
 */
export function postPath(platform: ContentPlatform, s: SnapshotLike | null): Record<PathMetric, number | null> {
  if (!s || s.availability !== "ok") return { views: null, profile_visits: null, link_clicks: null, site_visits: null, leads: null };
  return { views: platform === "instagram" ? s.views : s.impressions, profile_visits: s.profile_visits, link_clicks: s.link_clicks, site_visits: s.site_visits, leads: s.leads };
}
/** Sums paths of one network. Each step counts only posts where it is known, and says how many posts that is. */
export function sumPaths(paths: Record<PathMetric, number | null>[]) {
  return Object.fromEntries(PATH_METRICS.map((m) => {
    const known = paths.map((p) => p[m]).filter((v): v is number => v !== null);
    return [m, { value: known.length ? known.reduce((a, b) => a + b, 0) : null, posts: known.length }];
  })) as Record<PathMetric, { value: number | null; posts: number }>;
}
