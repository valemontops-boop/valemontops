/**
 * Content Studio (Stage 3 marketing, spec 5.6, D079). Pure rules: pipeline stages, FR/ES variants of one piece,
 * default publishing slots (round 8 calendar), per-platform checklists, UTM links, post checkpoints at equal age,
 * capture slots of the snapshot job (spec 4.11) and the views → profile visits → link clicks → site visits → leads path.
 */
import { PUBLISHING_CALENDAR, type ContentBrand, type Deliverable, type PublishSlot } from "./content";

/**
 * Kanban (founder request round 11, D081): idea → draft → ready are moved by hand; scheduled and published follow the
 * account versions. Rows written before round 11 keep their old stage names and are read through LEGACY_STAGES.
 */
export const PIECE_STAGES = ["idea", "draft", "ready", "scheduled", "published"] as const;
export type PieceStage = (typeof PIECE_STAGES)[number];
export const PRODUCTION_STAGES = ["idea", "draft", "ready"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];
export const LEGACY_STAGES: Readonly<Record<string, ProductionStage>> = { script: "draft", shoot: "draft", edit: "ready" };
export const STAGE_LABELS: Record<PieceStage, string> = { idea: "Idea", draft: "Draft", ready: "Ready to schedule", scheduled: "Scheduled", published: "Published" };

/** Post types (round 11). Old rows: brand/personal LinkedIn post → post, VSL → video. */
export const CONTENT_FORMATS = ["reel", "carousel", "post", "story", "video"] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export const LEGACY_FORMATS: Readonly<Record<string, ContentFormat>> = { brand_post: "post", personal_post: "post", vsl: "video" };
export const FORMAT_LABELS: Record<ContentFormat, string> = { reel: "Reel", carousel: "Carousel", post: "Post", story: "Story", video: "Video" };

export const VARIANT_STATUSES = ["draft", "scheduled", "published"] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];
export const LANGS = ["FR", "ES"] as const;
export type Lang = (typeof LANGS)[number];

export type ContentPlatform = "instagram" | "linkedin_page" | "linkedin_personal";
/** Checklists, limits and the scorer exist per network: a LinkedIn page and a personal profile share one. */
export type ChecklistPlatform = "instagram" | "linkedin";
export type Network = ChecklistPlatform;
export const checklistPlatformOf = (p: ContentPlatform): ChecklistPlatform => (p === "instagram" ? "instagram" : "linkedin");
export const networkOf = checklistPlatformOf;
/** Where a new version goes when no account is chosen (legacy create path): Reels, stories and carousels on Instagram. */
export const defaultPlatformOf = (f: ContentFormat, brand: ContentBrand | null): ContentPlatform =>
  f === "post" ? (brand ? "linkedin_page" : "linkedin_personal") : "instagram";
/** Weekly goals and ContentLog speak in deliverables (src/domain/content.ts): the type and the network of the version. */
export function deliverableOf(f: ContentFormat, p: ContentPlatform): Deliverable {
  if (f === "reel") return "reel";
  if (f === "story") return "story";
  if (p === "linkedin_page") return "brand_post";
  if (p === "linkedin_personal") return "personal_post";
  return f === "video" ? "reel" : "ig_post"; // an Instagram video is published as a Reel
}
/** A concept counts once, when the first version of a video (Reel or video) is published (D079). */
export const isVideo = (f: ContentFormat) => f === "reel" || f === "video";
/** Spanish distribution is Pablo's, French is Théo's (spec 5.6); a personal profile belongs to its founder. */
export const defaultOwner = (lang: Lang, personalOwner: "theo" | "pablo" | null): "theo" | "pablo" => personalOwner ?? (lang === "ES" ? "pablo" : "theo");

/** Kanban column of a piece: its production stage until a version is scheduled; published once every version is out. */
export function columnOf(stage: string, variants: { status: VariantStatus; is_archived?: boolean }[]): PieceStage {
  const live = variants.filter((v) => !v.is_archived);
  if (live.length && live.every((v) => v.status === "published")) return "published";
  if (live.some((v) => v.status !== "draft")) return "scheduled";
  const s = LEGACY_STAGES[stage] ?? stage;
  return PRODUCTION_STAGES.includes(s as ProductionStage) ? (s as ProductionStage) : "ready";
}
export function nextProductionStage(s: PieceStage): ProductionStage | null {
  const i = PRODUCTION_STAGES.indexOf(s as ProductionStage);
  return i >= 0 && i < PRODUCTION_STAGES.length - 1 ? PRODUCTION_STAGES[i + 1] : null;
}
/** Keyboard / drag move on the board: the neighbouring column, or null at the edges. */
export function neighbourStage(s: PieceStage, dir: -1 | 1): PieceStage | null {
  const i = PIECE_STAGES.indexOf(s);
  return PIECE_STAGES[i + dir] ?? null;
}

/** The default slot of the round-8 calendar for a version (deliverable + brand + language), or null when none fits. */
export function defaultSlotFor(d: Deliverable, brand: ContentBrand | null, lang: Lang): PublishSlot | null {
  return PUBLISHING_CALENDAR.find((s) => s.deliverable === d && (!s.brand || s.brand === brand) && (!s.language || s.language === lang)) ?? null;
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

/* ---------- planning: accounts, best hours, recommended slots, conflicts, month grid ---------- */

export interface AccountLike { id: string; platform: ContentPlatform; brand: ContentBrand | null; owner_founder: "theo" | "pablo" | null; handle: string }
const NETWORK_NAME: Record<ContentPlatform, string> = { instagram: "Instagram", linkedin_page: "LinkedIn", linkedin_personal: "LinkedIn" };
/** "LinkedIn Théo", "Instagram 30/30 AI": the account as the founders name it (D055). */
export const accountLabel = (a: Pick<AccountLike, "platform" | "handle">) => `${NETWORK_NAME[a.platform]} ${a.handle}`;
/** Fixed order of the six accounts (D055) in filters and pickers. */
export function sortAccounts<A extends AccountLike>(list: A[]): A[] {
  const rank = (a: A) => (a.platform === "linkedin_personal" ? 0 : a.platform === "linkedin_page" ? 1 : 2) * 10 + (a.owner_founder === "pablo" || a.brand === "thirty" ? 1 : 0);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.handle.localeCompare(b.handle));
}

/**
 * Best posting windows per network, local time of the founder (FR/ES audiences), 0 = Sunday. Sources in
 * src/domain/content-score.ts (Sprout Social, Hootsuite 2025): LinkedIn weekday mornings and lunch (Tue–Thu best),
 * Instagram late morning to early afternoon and early evening. A starting point, to be replaced by the accounts' own numbers.
 */
export const BEST_HOURS: Record<Network, { days: number[]; from: string; to: string; pick: string }[]> = {
  linkedin: [
    { days: [2, 3, 4], from: "07:30", to: "10:30", pick: "08:30" },
    { days: [2, 3, 4], from: "12:00", to: "14:00", pick: "12:30" },
    { days: [1, 5], from: "08:00", to: "11:00", pick: "09:00" },
  ],
  instagram: [
    { days: [1, 2, 3, 4, 5], from: "11:00", to: "14:00", pick: "12:00" },
    { days: [0, 1, 2, 3, 4, 5, 6], from: "18:00", to: "21:00", pick: "19:00" },
    { days: [6], from: "10:00", to: "13:00", pick: "11:00" },
  ],
};
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** Weekday (0 = Sunday) of a YYYY-MM-DD date, independent of the browser's time zone. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
/** The best-hours window a date + time falls in, or null. */
export function inBestHours(network: Network, date: string, time: string) {
  if (!isTime(time)) return null;
  const wd = weekdayOf(date);
  const m = minutes(time);
  return BEST_HOURS[network].find((w) => w.days.includes(wd) && m >= minutes(w.from) && m <= minutes(w.to)) ?? null;
}
/** First recommended time of a day for a network ("" on a day with no window). */
export const bestTimeFor = (network: Network, date: string) => BEST_HOURS[network].find((w) => w.days.includes(weekdayOf(date)))?.pick ?? "";

const DELIVERABLE_PLATFORM: Partial<Record<Deliverable, ContentPlatform>> = { brand_post: "linkedin_page", personal_post: "linkedin_personal", reel: "instagram", story: "instagram", ig_post: "instagram" };
export interface RecommendedSlot { key: string; date: string; time: string; account_id: string | null; network: Network; language: Lang | null; label: string; deliverable: Deliverable }
/** The weekly plan (round 8, PUBLISHING_CALENDAR) as dated slots on the accounts, with a recommended time. */
export function recommendedSlots(weekStart: string, accounts: AccountLike[], addDays: (d: string, n: number) => string): RecommendedSlot[] {
  return PUBLISHING_CALENDAR.filter((s) => s.deliverable).map((s) => {
    const platform = DELIVERABLE_PLATFORM[s.deliverable!] ?? "instagram";
    const acc = accounts.find((a) => a.platform === platform && (!s.brand || a.brand === s.brand)) ?? null;
    const date = slotDate(weekStart, s.weekday, addDays);
    const network = checklistPlatformOf(platform);
    return { key: s.key, date, time: bestTimeFor(network, date), account_id: s.brand ? acc?.id ?? null : null, network, language: s.language, label: s.label, deliverable: s.deliverable! };
  });
}

export const CONFLICT_WINDOW_MINUTES = 60;
/**
 * Two versions on the same account on the same day, both without a time or less than an hour apart, collide
 * (the second one eats the first one's reach). Published versions still count, archived ones do not. Map id → other ids.
 */
export function scheduleConflicts(vs: { id: string; account_id: string; scheduled_date: string | null; scheduled_time: string; status: VariantStatus; is_archived?: boolean }[]) {
  const out = new Map<string, string[]>();
  const live = vs.filter((v) => !v.is_archived && v.account_id && v.scheduled_date && v.status !== "draft");
  for (const a of live) for (const b of live) {
    if (a.id === b.id || a.account_id !== b.account_id || a.scheduled_date !== b.scheduled_date) continue;
    const ta = isTime(a.scheduled_time), tb = isTime(b.scheduled_time);
    const clash = (!ta && !tb) || (ta && tb && Math.abs(minutes(a.scheduled_time) - minutes(b.scheduled_time)) < CONFLICT_WINDOW_MINUTES);
    if (clash) out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
  }
  return out;
}

/** Month grid: whole weeks (Monday first) covering the month of `anyDay`. */
export function monthGrid(anyDay: string, addDays: (d: string, n: number) => string) {
  const first = `${anyDay.slice(0, 7)}-01`;
  const start = addDays(first, -((weekdayOf(first) + 6) % 7));
  const weeks: string[][] = [];
  for (let d = start; weeks.length < 6; ) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(d, i));
    if (weeks.length && week[0].slice(0, 7) !== first.slice(0, 7)) break;
    weeks.push(week);
    d = addDays(d, 7);
  }
  return { month: first.slice(0, 7), weeks };
}

/* ---------- composer: platform limits, composed caption, hashtags, media fit ---------- */

/**
 * Text limits per network (D081, sources in content-score.ts). Instagram cut hashtags from 30 to 5 per post and Reel
 * in December 2025, so 5 is the hard limit (3–5 recommended). The "see more" folds are the visible start of the text.
 */
export const PLATFORM_LIMITS = {
  linkedin: { caption: 3_000, fold: 210, hashtagsMax: 30, hashtagsRec: [3, 5] as const, firstComment: 1_250, alt: 1_000 },
  instagram: { caption: 2_200, fold: 125, hashtagsMax: 5, hashtagsRec: [3, 5] as const, firstComment: 2_200, alt: 1_000 },
} as const;
export const LINK_PLACEMENTS = ["first_comment", "post", "bio"] as const;
export type LinkPlacement = (typeof LINK_PLACEMENTS)[number];

export interface ComposeFields { hook: string; caption: string; cta: string; hashtags: string; link: string; link_placement: LinkPlacement }
/** The text that is pasted in the app: hook, body, call to action, link (LinkedIn, in the post only when chosen), hashtags. */
export function composeCaption(network: Network, f: ComposeFields) {
  const tags = normalizeHashtags(f.hashtags).join(" ");
  const link = network === "linkedin" && f.link_placement === "post" ? f.link : "";
  return [f.hook.trim(), f.caption.trim(), f.cta.trim(), link, tags].filter(Boolean).join("\n\n");
}
/** "#a, b #c" → ["#a", "#b", "#c"] (deduplicated, case kept). */
export function normalizeHashtags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw.split(/[\s,;]+/)) {
    const tag = w.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(`#${tag}`);
  }
  return out;
}
/** Every hashtag in a text (caption + hashtag line). */
export const hashtagsIn = (text: string) => [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.toLowerCase()))];
/** Characters as the apps count them (code points, emoji = 1). */
export const charCount = (s: string) => [...s].length;
export function counters(network: Network, text: string, firstComment = "") {
  const L = PLATFORM_LIMITS[network];
  return {
    chars: charCount(text), max: L.caption, over: charCount(text) > L.caption,
    fold: L.fold, visible: [...text].slice(0, L.fold).join(""),
    hashtags: hashtagsIn(text).length, hashtagsMax: L.hashtagsMax,
    firstComment: charCount(firstComment), firstCommentMax: L.firstComment,
  };
}

/** A Drive file attached to a version: only its id, name, type, link and size metadata are stored (no copy). */
export interface MediaRef { file_id: string; name: string; mime: string; web_link: string; thumbnail_link: string; width: number | null; height: number | null; duration_ms: number | null }
/** Drive listing row → stored reference (Drive's image/video metadata when it has processed the file). */
export function mediaRefOf(f: { id: string; name: string; mimeType: string; webViewLink: string; thumbnailLink?: string; imageMediaMetadata?: { width?: number; height?: number }; videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string | number } }): MediaRef {
  const n = (x: unknown) => (x === undefined || x === null || x === "" || !Number.isFinite(Number(x)) ? null : Math.round(Number(x)));
  return {
    file_id: f.id, name: f.name.slice(0, 300), mime: f.mimeType, web_link: f.webViewLink, thumbnail_link: f.thumbnailLink ?? "",
    width: n(f.imageMediaMetadata?.width ?? f.videoMediaMetadata?.width), height: n(f.imageMediaMetadata?.height ?? f.videoMediaMetadata?.height), duration_ms: n(f.videoMediaMetadata?.durationMillis),
  };
}
export const isImage = (m: Pick<MediaRef, "mime">) => m.mime.startsWith("image/");
export const isVideoFile = (m: Pick<MediaRef, "mime">) => m.mime.startsWith("video/");
export interface MediaFinding { level: "ok" | "warn" | "bad" | "info"; message: string; vars?: Record<string, string | number> }
const ratio = (m: MediaRef) => (m.width && m.height ? m.width / m.height : null);
const near = (r: number, target: number) => Math.abs(r - target) <= 0.03;
const R = { vertical: 9 / 16, square: 1, portrait: 4 / 5, landscape: 1.91 };

/**
 * Does the media fit the type on this network? Uses Drive's image/video metadata when it is there, otherwise prints the
 * rule as a hint (Reel 9:16 ≤ 90 s recommended, 3 min max; carousel 1:1 or 4:5, 2–20 items; LinkedIn video ≤ 10 min).
 */
export function mediaFit(type: ContentFormat, network: Network, media: MediaRef[]): MediaFinding[] {
  const out: MediaFinding[] = [];
  const videos = media.filter(isVideoFile), images = media.filter(isImage);
  const other = media.filter((m) => !isImage(m) && !isVideoFile(m) && !(network === "linkedin" && type === "carousel" && m.mime === "application/pdf"));
  if (other.length) out.push({ level: "bad", message: "{n} file(s) are not an image or a video.", vars: { n: other.length } });
  const needsMedia = type !== "post" || network === "instagram";
  if (!media.length) {
    if (needsMedia) out.push({ level: "warn", message: "No media yet: pick it from Drive." });
    return out;
  }
  const dur = (m: MediaRef) => (m.duration_ms === null ? null : Math.round(m.duration_ms / 1000));
  const checkRatio = (m: MediaRef, allowed: number[], hint: string) => {
    const r = ratio(m);
    if (r === null) out.push({ level: "info", message: "Size of {name} unknown: use {hint}.", vars: { name: m.name, hint } });
    else if (!allowed.some((a) => near(r, a))) out.push({ level: "warn", message: "{name} is {w}×{h}: use {hint}.", vars: { name: m.name, w: m.width!, h: m.height!, hint } });
  };
  if (type === "reel" || (type === "video" && network === "instagram")) {
    if (videos.length !== 1) out.push({ level: "bad", message: "A Reel is one video." });
    for (const v of videos) {
      checkRatio(v, [R.vertical], "9:16 (1080×1920)");
      const s = dur(v);
      if (s === null) out.push({ level: "info", message: "Duration of {name} unknown: keep a Reel between 7 and 90 seconds.", vars: { name: v.name } });
      else if (s > 180) out.push({ level: "bad", message: "{name} lasts {s} s: Instagram Reels stop at 3 minutes.", vars: { name: v.name, s } });
      else if (s > 90) out.push({ level: "warn", message: "{name} lasts {s} s: Reels under 90 seconds are recommended.", vars: { name: v.name, s } });
    }
  } else if (type === "story") {
    if (media.length !== 1) out.push({ level: "warn", message: "One story = one image or video." });
    for (const m of media) {
      checkRatio(m, [R.vertical], "9:16 (1080×1920)");
      const s = isVideoFile(m) ? dur(m) : null;
      if (s !== null && s > 60) out.push({ level: "warn", message: "{name} lasts {s} s: a story shows 60 seconds per slide.", vars: { name: m.name, s } });
    }
  } else if (type === "carousel") {
    if (media.length < 2) out.push({ level: "warn", message: "A carousel needs at least 2 slides." });
    if (media.length > 20) out.push({ level: "bad", message: "{n} slides: 20 at most.", vars: { n: media.length } });
    for (const m of images) checkRatio(m, network === "instagram" ? [R.square, R.portrait] : [R.square, R.portrait, R.landscape], network === "instagram" ? "1:1 / 4:5 (1080×1350)" : "1:1 / 4:5");
    if (network === "instagram") for (const v of videos) { const s = dur(v); if (s !== null && s > 60) out.push({ level: "warn", message: "{name} lasts {s} s: a carousel video slide stops at 60 seconds.", vars: { name: v.name, s } }); }
  } else if (type === "video") {
    if (videos.length !== 1) out.push({ level: "bad", message: "A video post is one video." });
    for (const v of videos) {
      const s = dur(v);
      if (s === null) out.push({ level: "info", message: "Duration of {name} unknown: LinkedIn videos stop at 10 minutes; 30–90 s works best.", vars: { name: v.name } });
      else if (s > 600) out.push({ level: "bad", message: "{name} lasts {s} s: LinkedIn videos stop at 10 minutes.", vars: { name: v.name, s } });
    }
  } else {
    if (network === "instagram" && media.length > 1) out.push({ level: "info", message: "Several images: this is a carousel." });
    for (const m of images) checkRatio(m, network === "instagram" ? [R.square, R.portrait, R.landscape] : [R.square, R.portrait, R.landscape], network === "instagram" ? "1:1 / 4:5" : "1:1 / 4:5 / 1.91:1");
  }
  if (!out.some((f) => f.level === "bad" || f.level === "warn")) out.unshift({ level: "ok", message: "Media fits the format." });
  return out;
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
    // Only the four utm_* fields: callers may pass a whole row or draft.
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) if (utm[k]) u.searchParams.set(k, utm[k]);
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
