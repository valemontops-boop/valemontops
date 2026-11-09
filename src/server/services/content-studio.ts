import { z } from "zod";
import type { NewRow, Row } from "@/data/repository";
import type { DriveFile } from "@/data/google/ports";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { contentBrandOf, contentProgress, type ContentBrand } from "@/domain/content";
import {
  CHECKPOINTS, CONTENT_FORMATS, LANGS, LEGACY_FORMATS, LINK_PLACEMENTS, PIECE_STAGES, PRODUCTION_STAGES, accountLabel, bestByCheckpoint,
  checklistKey, checklistPlatformOf, checklistProgress, columnOf, defaultOwner, defaultPlatformOf, defaultSlotFor, defaultUtm, deliverableOf, isTime, isVideo,
  latestSnapshot, mediaRefOf, parseChecklist, postPath, scheduleConflicts, sortAccounts, sumPaths, utmUrl,
  type AccountLike, type ChecklistPlatform, type ContentFormat, type ContentPlatform, type Lang, type MediaRef,
} from "@/domain/content-studio";
import { pieceScore, scorePost } from "@/domain/content-score";
import { addDays, localDate, startOfWeek } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { userRow } from "./common";
import { listFolder } from "./files";
import { snapshotStatus } from "./snapshot";

/**
 * Content Studio (Stage 3 marketing, spec 5.6, D079; iteration 11, D081): one piece = one idea or post with
 * one version per account and language. Kanban idea → draft → ready → scheduled → published, week / month planning with
 * recommended slots and conflicts, composer with per-network limits, Drive media "en mode shell" (ids, no copy), a
 * deterministic score per version, batch production, publishing checklist, post checkpoints and the views → leads path.
 * Publishing stays human: the app copies the caption and opens the network; "Mark as published" logs ContentLog once.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const https = z.union([z.literal(""), z.string().trim().max(1_000).regex(/^https:\/\/[^\s"'<>]+$/, "Enter a full https:// link")]);
const contentBrand = z.enum(["consulting", "thirty"]).nullable();
const time = z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM expected")]);

function dedupLogs(rows: Row<"ContentLog">[]) {
  const seen = new Map<string, Row<"ContentLog">>();
  for (const l of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) if (!seen.has(l.idempotency_key) && !l.is_archived) seen.set(l.idempotency_key, l);
  return [...seen.values()];
}
const toAccount = (a: Row<"SocialAccounts">): AccountLike & { label: string; network: ChecklistPlatform } => ({
  id: a.id, platform: a.platform, brand: contentBrandOf(a.brand), owner_founder: a.owner_founder, handle: a.handle, label: accountLabel(a), network: checklistPlatformOf(a.platform),
});

/** Search words for the scorer: the latest Search Console period per language (queries by impressions) + brand terms. */
function searchWords(rows: Row<"SearchConsoleRows">[], brandRaw: string | null) {
  const brandTerms = (brandRaw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: Record<Lang, string[]> = { FR: [], ES: [] };
  for (const lang of LANGS) {
    const mine = rows.filter((r) => !r.is_archived && r.language === lang && r.dimension === "query");
    const end = mine.map((r) => r.period_end).sort().at(-1);
    out[lang] = mine.filter((r) => r.period_end === end).sort((a, b) => b.impressions - a.impressions).map((r) => r.key.trim().toLowerCase())
      .filter((k, i, all) => k.length >= 3 && all.indexOf(k) === i && !brandTerms.some((b) => k.includes(b))).slice(0, 15);
  }
  return { keywords: out, brandTerms };
}

export const studioSchema = z.object({ week: day.optional() });

export async function contentStudio(ctx: AppContext, founder: FounderKey, input: z.infer<typeof studioSchema> = {}) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const week = startOfWeek(input.week ?? today);
  const t = await ctx.repo.listMany(["ContentPieces", "ContentVariants", "SocialPostSnapshots", "SocialAccounts", "ContentLog", "SystemSettings", "SearchConsoleRows"]);
  const settings = (k: string) => t.SystemSettings.rows.find((r) => r.key === k && !r.is_archived)?.value ?? null;
  const checklists = { instagram: parseChecklist("instagram", settings(checklistKey("instagram"))), linkedin: parseChecklist("linkedin", settings(checklistKey("linkedin"))) };
  const words = searchWords(t.SearchConsoleRows.rows, settings("seo_brand_terms"));
  const snaps = t.SocialPostSnapshots.rows.filter((s) => !s.is_archived);
  const accounts = sortAccounts(t.SocialAccounts.rows.filter((a) => !a.is_archived).map(toAccount));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const pieceRows = new Map(t.ContentPieces.rows.map((p) => [p.id, p]));
  const sameUrl = (a: string, b: string) => Boolean(a && b) && a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
  const liveVariants = t.ContentVariants.rows.filter((v) => !v.is_archived && pieceRows.has(v.piece_id));
  const conflicts = scheduleConflicts(liveVariants);

  const variants = liveVariants.map((v) => {
    const piece = pieceRows.get(v.piece_id)!;
    const mine = snaps.filter((s) => s.variant_id === v.id || (v.media_id && s.media_id === v.media_id) || sameUrl(v.platform_post_url, s.permalink));
    const best = bestByCheckpoint(mine);
    const latest = latestSnapshot(mine);
    const network = checklistPlatformOf(v.platform);
    const list = checklists[network];
    const link = utmUrl(v.destination_url, v);
    const score = scorePost({ network, type: piece.format, language: v.language, hook: v.hook || piece.hook, caption: v.caption, cta: v.cta, hashtags: v.hashtags, link, link_placement: v.link_placement, alt_text: v.alt_text, first_comment: v.first_comment, cover_text: v.cover_text, media: v.drive_media, checklist: v.checklist_done, scheduled_date: v.scheduled_date, scheduled_time: v.scheduled_time, keywords: words.keywords[v.language], brandTerms: words.brandTerms });
    return {
      ...v,
      network,
      account: accountById.get(v.account_id)?.label ?? "",
      link,
      conflicts: conflicts.get(v.id) ?? [],
      score: { score: score.score, grade: score.grade },
      checklist: checklistProgress(list, v.checklist_done),
      checkpoints: CHECKPOINTS.map((c) => ({ key: c.key, label: c.label, snapshot: best.get(c.key) ?? null })),
      stories: mine.filter((s) => s.checkpoint === "live").sort((a, b) => b.captured_at.localeCompare(a.captured_at)).slice(0, 4),
      latest: latest ? { checkpoint: latest.checkpoint, source: latest.source, captured_at: latest.captured_at, availability: latest.availability } : null,
      path: postPath(v.platform, latest),
    };
  });
  const pieces = t.ContentPieces.rows.filter((p) => !p.is_archived).map((p) => {
    const vs = variants.filter((v) => v.piece_id === p.id).sort((a, b) => a.account.localeCompare(b.account) || a.language.localeCompare(b.language));
    return { ...p, column: columnOf(p.stage, vs), variants: vs, score: pieceScore(vs.map((v) => v.score.score)) };
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const pubDate = (v: (typeof variants)[number]) => (v.published_at ? localDate(v.published_at, u.timezone) : null);
  const weekEnd = addDays(week, 6);
  const inWeek = variants.filter((v) => v.status === "published" && (pubDate(v) ?? "") >= week && (pubDate(v) ?? "") <= weekEnd);
  const piecesById = new Map(pieces.map((p) => [p.id, p]));
  /** Every dated version (scheduled, published, or a draft with a date) for the week and month views. */
  const schedule = variants.filter((v) => v.scheduled_date || v.published_at).map((v) => {
    const p = piecesById.get(v.piece_id);
    const date = v.status === "published" ? pubDate(v) ?? v.scheduled_date! : v.scheduled_date!;
    return { id: v.id, piece_id: v.piece_id, version: v.version, title: p?.title ?? "", format: p?.format ?? "post", brand: p?.brand ?? null, account_id: v.account_id, account: v.account, network: v.network, language: v.language, date, time: v.scheduled_time, status: v.status, conflict: v.conflicts.length > 0, score: v.score.score };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  return {
    week, today,
    accounts,
    pieces,
    columns: PIECE_STAGES.map((s) => ({ stage: s, count: pieces.filter((p) => p.column === s).length })),
    schedule,
    targets: contentProgress(dedupLogs(t.ContentLog.rows), week, weekEnd),
    /** Instagram views and LinkedIn impressions are different measures: one path per network, never summed. */
    weekPath: {
      instagram: { posts: inWeek.filter((v) => v.platform === "instagram").length, steps: sumPaths(inWeek.filter((v) => v.platform === "instagram").map((v) => v.path)) },
      linkedin: { posts: inWeek.filter((v) => v.platform !== "instagram").length, steps: sumPaths(inWeek.filter((v) => v.platform !== "instagram").map((v) => v.path)) },
    },
    checklists,
    keywords: words.keywords,
    brandTerms: words.brandTerms,
    snapshot: await snapshotStatus(ctx),
  };
}

/* ---------- pieces ---------- */

const target = z.object({ account_id: z.string().uuid(), language: z.enum(LANGS) });
/** Rows and clients written before iteration 11 send brand_post / personal_post / vsl: read as post (+ network) / video. */
const legacyCreate = (v: unknown) => {
  if (!v || typeof v !== "object") return v;
  const o = { ...(v as Record<string, unknown>) };
  if (o.format === "brand_post") o.platform ??= "linkedin_page";
  if (o.format === "personal_post") { o.platform ??= "linkedin_personal"; o.brand = null; }
  if (typeof o.format === "string" && LEGACY_FORMATS[o.format]) o.format = LEGACY_FORMATS[o.format];
  return o;
};
export const createPieceSchema = z.preprocess(legacyCreate, z.object({
  id: z.string().uuid(),
  brand: contentBrand.default("thirty"),
  title: z.string().trim().min(1).max(200),
  format: z.enum(CONTENT_FORMATS).default("reel"),
  hook: z.string().trim().max(500).default(""),
  target_persona: z.string().trim().max(200).default(""),
  stage: z.enum(PRODUCTION_STAGES).default("idea"),
  /** Explicit accounts × languages (iteration 11). [] = a one-line idea with no version yet. */
  targets: z.array(target).max(12).optional(),
  /** Legacy path: one version per language on the default account of the type. */
  languages: z.array(z.enum(LANGS)).max(2).default(["FR", "ES"]),
  platform: z.enum(["instagram", "linkedin_page", "linkedin_personal"]).optional(),
}));

function accountFor(accounts: Row<"SocialAccounts">[], platform: ContentPlatform, brand: ContentBrand | null, owner: FounderKey) {
  return accounts.find((a) => !a.is_archived && a.platform === platform && (platform === "linkedin_personal" ? a.owner_founder === owner : contentBrandOf(a.brand) === brand))?.id ?? "";
}
function newVariant(piece: { id: string; title: string; format: ContentFormat; brand: ContentBrand | null }, acc: Row<"SocialAccounts"> | null, platform: ContentPlatform, lang: Lang, owner: FounderKey, id: string, week: string): NewRow<"ContentVariants"> {
  return {
    id, piece_id: piece.id, language: lang, platform, account_id: acc?.id ?? "", owner_founder: owner, status: "draft", scheduled_date: null,
    slot_key: defaultSlotFor(deliverableOf(piece.format, platform), piece.brand, lang)?.key ?? "",
    caption: "", cta: "", destination_url: "", ...defaultUtm({ platform, brand: piece.brand, title: piece.title, lang, format: piece.format, weekStart: week }),
    checklist_done: [], published_at: null, platform_post_url: "", media_id: "",
    scheduled_time: "", hook: "", hashtags: "", alt_text: "", first_comment: "", cover_text: "", link_placement: platform === "instagram" ? "bio" : "first_comment", drive_media: [],
  };
}

/** New idea or post, with one version per chosen account and language. Retrying with the same id adds nothing. */
export async function createPiece(ctx: AppContext, founder: FounderKey, input: z.infer<typeof createPieceSchema>) {
  if (await ctx.repo.get("ContentPieces", input.id, { fresh: true })) return { id: input.id, duplicate: true };
  const accounts = (await ctx.repo.list("SocialAccounts")).rows;
  const u = await userRow(ctx.repo, founder);
  const week = startOfWeek(localDate(new Date(), u.timezone));
  const brand = input.platform === "linkedin_personal" ? null : input.brand;
  const piece = { id: input.id, title: input.title, format: input.format, brand };
  await ctx.repo.insert("ContentPieces", [{ id: input.id, brand, title: input.title, format: input.format, hook: input.hook, target_persona: input.target_persona, script: "", stage: input.stage, author_founder: founder, asset_url: "", notes: "" }], { founder });
  let variants: NewRow<"ContentVariants">[];
  if (input.targets) {
    variants = dedupTargets(input.targets).map((tg) => {
      const acc = accounts.find((a) => a.id === tg.account_id && !a.is_archived);
      if (!acc) throw new RuleError("Social account not found");
      return newVariant(piece, acc, acc.platform, tg.language, acc.owner_founder ?? defaultOwner(tg.language, null), childId("content-variant", input.id, tg.language, acc.id), week);
    });
  } else {
    const platform = input.platform ?? defaultPlatformOf(input.format, brand);
    variants = [...new Set(input.languages)].map((lang) => {
      const owner = defaultOwner(lang, platform === "linkedin_personal" ? founder : null);
      const accId = accountFor(accounts, platform, brand, owner);
      return newVariant(piece, accounts.find((a) => a.id === accId) ?? null, platform, lang, owner, childId("content-variant", input.id, lang), week);
    });
  }
  if (variants.length) await ctx.repo.insert("ContentVariants", variants, { founder });
  return { id: input.id, duplicate: false };
}
const dedupTargets = (ts: z.infer<typeof target>[]) => ts.filter((x, i) => ts.findIndex((y) => y.account_id === x.account_id && y.language === x.language) === i);

export const addVariantsSchema = z.object({ piece_id: z.string().uuid(), targets: z.array(target).min(1).max(12), schedule: z.object({ date: day, time }).optional() });
/** Adds versions (account × language) to a piece, optionally scheduled on a slot; an existing one (same account and language) is skipped. */
export async function addVariants(ctx: AppContext, founder: FounderKey, input: z.infer<typeof addVariantsSchema>) {
  const p = await ctx.repo.get("ContentPieces", input.piece_id, { fresh: true });
  if (!p || p.is_archived) throw new RuleError("Content piece not found");
  const [accounts, existing] = [(await ctx.repo.list("SocialAccounts")).rows, (await ctx.repo.list("ContentVariants", { fresh: true })).rows];
  const u = await userRow(ctx.repo, founder);
  const week = startOfWeek(localDate(new Date(), u.timezone));
  const rows: NewRow<"ContentVariants">[] = [];
  let skipped = 0;
  for (const tg of dedupTargets(input.targets)) {
    const acc = accounts.find((a) => a.id === tg.account_id && !a.is_archived);
    if (!acc) throw new RuleError("Social account not found");
    const id = childId("content-variant", p.id, tg.language, acc.id);
    if (existing.some((v) => v.piece_id === p.id && !v.is_archived && ((v.account_id === acc.id && v.language === tg.language) || v.id === id))) { skipped++; continue; }
    const row = newVariant({ id: p.id, title: p.title, format: p.format, brand: contentBrandOf(p.brand) }, acc, acc.platform, tg.language, acc.owner_founder ?? defaultOwner(tg.language, null), id, week);
    rows.push(input.schedule ? { ...row, status: "scheduled", scheduled_date: input.schedule.date, scheduled_time: input.schedule.time } : row);
  }
  if (rows.length) await ctx.repo.insert("ContentVariants", rows, { founder });
  return { added: rows.length, skipped, ids: rows.map((r) => r.id) };
}

export const updatePieceSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  patch: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    brand: contentBrand.optional(),
    format: z.enum(CONTENT_FORMATS).optional(),
    hook: z.string().trim().max(500).optional(),
    target_persona: z.string().trim().max(200).optional(),
    script: z.string().max(20_000).optional(),
    stage: z.preprocess((v) => (typeof v === "string" && v in { script: 1, shoot: 1, edit: 1 } ? ({ script: "draft", shoot: "draft", edit: "ready" } as Record<string, string>)[v] : v), z.enum(PRODUCTION_STAGES)).optional(),
    asset_url: https.optional(),
    notes: z.string().trim().max(2_000).optional(),
    is_archived: z.boolean().optional(),
  }),
});
/** Conditional update (spec 4.3): a stale version is a 409 shown with both values. */
export async function updatePiece(ctx: AppContext, founder: FounderKey, input: z.infer<typeof updatePieceSchema>) {
  const cur = await ctx.repo.get("ContentPieces", input.id, { fresh: true });
  if (!cur) throw new RuleError("Content piece not found");
  return ctx.repo.update("ContentPieces", input.id, input.expected_version, { ...input.patch }, { founder });
}

export const moveSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), to: z.enum(["idea", "draft", "ready", "scheduled"]) });
/**
 * Kanban move (drag or keyboard). Production columns change the piece's stage (version-checked, 409 on a stale card);
 * leaving Scheduled puts its scheduled versions back to draft (dates kept); entering Scheduled schedules every draft
 * version that has a date. Published is reached only by "Mark as published" on each version.
 */
export async function movePiece(ctx: AppContext, founder: FounderKey, input: z.infer<typeof moveSchema>) {
  const cur = await ctx.repo.get("ContentPieces", input.id, { fresh: true });
  if (!cur || cur.is_archived) throw new RuleError("Content piece not found");
  const vs = (await ctx.repo.list("ContentVariants", { fresh: true })).rows.filter((v) => v.piece_id === cur.id && !v.is_archived);
  const column = columnOf(cur.stage, vs);
  if (column === "published") throw new RuleError("A published piece stays published.");
  if (input.to === "scheduled") {
    const ready = vs.filter((v) => v.status === "draft" && v.scheduled_date);
    if (!ready.length) throw new RuleError("Choose a date for at least one version first.");
    const piece = await ctx.repo.update("ContentPieces", cur.id, input.expected_version, { stage: "ready" }, { founder });
    for (const v of ready) await ctx.repo.update("ContentVariants", v.id, v.version, { status: "scheduled" }, { founder });
    return { piece, scheduled: ready.length, unscheduled: 0 };
  }
  const piece = await ctx.repo.update("ContentPieces", cur.id, input.expected_version, { stage: input.to }, { founder });
  const back = vs.filter((v) => v.status === "scheduled");
  for (const v of back) await ctx.repo.update("ContentVariants", v.id, v.version, { status: "draft" }, { founder });
  return { piece, scheduled: 0, unscheduled: back.length };
}

export const batchSchema = z.object({ to: z.enum(PRODUCTION_STAGES), items: z.array(z.object({ id: z.string().uuid(), expected_version: z.number().int() })).min(1).max(30) });
/** Batch production: move several pieces to the next step at once; each conflict is reported, the others go through. */
export async function advanceBatch(ctx: AppContext, founder: FounderKey, input: z.infer<typeof batchSchema>) {
  const moved: string[] = [];
  const conflicts: string[] = [];
  for (const it of input.items) {
    try {
      await ctx.repo.update("ContentPieces", it.id, it.expected_version, { stage: input.to }, { founder });
      moved.push(it.id);
    } catch (e) {
      if ((e as { code?: string }).code === "conflict") conflicts.push(it.id); else throw e;
    }
  }
  return { moved: moved.length, conflicts };
}

/* ---------- Drive media "en mode shell" ---------- */

export const toMediaRef = (f: DriveFile): MediaRef => mediaRefOf(f);
const FOLDER = "application/vnd.google-apps.folder";
export const mediaBrowseSchema = z.object({ folder: z.string().max(200).optional(), q: z.string().max(100).default("") });
/** The picker: folders, images, videos and PDFs of the shared Drive tree (service account, read-only; spec 4.8). */
export async function browseMedia(ctx: AppContext, input: z.infer<typeof mediaBrowseSchema>) {
  const l = await listFolder(ctx, input.folder ?? null, input.q, input.q.trim() ? "search" : "folder");
  const files = l.files.filter((f) => f.mimeType === FOLDER || f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/") || f.mimeType === "application/pdf")
    .sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name))
    .map((f) => ({ ...toMediaRef(f), is_folder: f.mimeType === FOLDER, modified: f.modifiedTime }));
  return { configured: l.configured, root: l.root, folderId: l.folderId, files };
}
/** Resolves picked Drive ids: files already on the version keep their stored metadata, new ones are read from Drive. */
async function resolveMedia(ctx: AppContext, current: MediaRef[], picked: { file_id: string }[]) {
  const out: MediaRef[] = [];
  for (const p of picked) {
    const have = current.find((m) => m.file_id === p.file_id);
    if (have) { out.push(have); continue; }
    if (!ctx.drive) throw new RuleError("Google Drive is not configured.");
    const f = await ctx.drive.get(p.file_id);
    if (!f) throw new RuleError("That file is not visible to Valemont OS. Put it in the shared folder first.");
    if (!(f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/") || f.mimeType === "application/pdf")) throw new RuleError("Pick an image, a video or a PDF.");
    out.push(toMediaRef(f));
  }
  return out;
}

/* ---------- variants ---------- */

export const variantSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  action: z.enum(["save", "schedule", "unschedule", "publish"]).default("save"),
  patch: z.object({
    caption: z.string().max(5_000).optional(),
    cta: z.string().trim().max(300).optional(),
    hook: z.string().max(500).optional(),
    hashtags: z.string().max(1_000).optional(),
    alt_text: z.string().max(1_000).optional(),
    first_comment: z.string().max(2_200).optional(),
    cover_text: z.string().max(200).optional(),
    link_placement: z.enum(LINK_PLACEMENTS).optional(),
    destination_url: https.optional(),
    utm_source: z.string().trim().max(60).regex(/^[\w.-]*$/).optional(),
    utm_medium: z.string().trim().max(60).regex(/^[\w.-]*$/).optional(),
    utm_campaign: z.string().trim().max(120).regex(/^[\w.-]*$/).optional(),
    utm_content: z.string().trim().max(120).regex(/^[\w.-]*$/).optional(),
    checklist_done: z.array(z.string().max(40)).max(40).optional(),
    scheduled_date: day.nullable().optional(),
    scheduled_time: time.optional(),
    slot_key: z.string().max(60).optional(),
    owner_founder: z.enum(["theo", "pablo"]).optional(),
    platform_post_url: https.optional(),
    published_at: z.string().datetime({ offset: true }).optional(),
    drive_media: z.array(z.object({ file_id: z.string().min(1).max(200) })).max(20).optional(),
    is_archived: z.boolean().optional(),
  }).default({}),
});

/** Save (autosave), schedule, unschedule or publish one version. Publishing counts the piece once in the weekly goals. */
export async function updateVariant(ctx: AppContext, founder: FounderKey, input: z.infer<typeof variantSchema>) {
  const cur = await ctx.repo.get("ContentVariants", input.id, { fresh: true });
  if (!cur) throw new RuleError("Content variant not found");
  const { drive_media, ...rest } = input.patch;
  const patch: Partial<Row<"ContentVariants">> = { ...rest };
  if (drive_media) patch.drive_media = await resolveMedia(ctx, cur.drive_media, drive_media);
  if (patch.scheduled_time !== undefined && patch.scheduled_time !== "" && !isTime(patch.scheduled_time)) throw new RuleError("HH:MM expected");
  if (input.action === "schedule") {
    if (!(patch.scheduled_date ?? cur.scheduled_date)) throw new RuleError("Choose a publishing date first.");
    patch.status = "scheduled";
  } else if (input.action === "unschedule") {
    patch.status = "draft";
    patch.scheduled_date = null;
  } else if (input.action === "publish") {
    patch.status = "published";
    patch.published_at = input.patch.published_at ? new Date(input.patch.published_at).toISOString() : cur.published_at ?? new Date().toISOString();
  } else if (cur.status === "scheduled" && patch.scheduled_date === null) {
    patch.status = "draft";
  }
  const row = await ctx.repo.update("ContentVariants", input.id, input.expected_version, patch, { founder });
  if (input.action === "publish") await logPublication(ctx, founder, row);
  return row;
}

/** One ContentLog row per published variant, plus one "concept" for the first published variant of a video (D079). */
async function logPublication(ctx: AppContext, founder: FounderKey, v: Row<"ContentVariants">) {
  const piece = await ctx.repo.get("ContentPieces", v.piece_id, { fresh: true });
  if (!piece) return;
  const owner = await userRow(ctx.repo, v.owner_founder);
  const date = localDate(v.published_at ?? new Date().toISOString(), owner.timezone);
  const logs = (await ctx.repo.list("ContentLog", { fresh: true })).rows;
  const have = new Set(logs.map((l) => l.idempotency_key));
  const brand = v.platform === "linkedin_personal" ? null : piece.brand;
  const rows: NewRow<"ContentLog">[] = [];
  const pub = childId("content-publish", v.id);
  if (!have.has(pub)) rows.push({ id: pub, idempotency_key: pub, founder_key: v.owner_founder, deliverable: deliverableOf(piece.format, v.platform), brand, language: v.language, title: piece.title, url: v.platform_post_url, local_date: date });
  const concept = childId("content-concept", piece.id);
  if (isVideo(piece.format) && !have.has(concept)) rows.push({ id: concept, idempotency_key: concept, founder_key: piece.author_founder, deliverable: "concept", brand, language: null, title: piece.title, url: "", local_date: date });
  if (rows.length) await ctx.repo.insert("ContentLog", rows, { founder });
}

/* ---------- hand-entered post checkpoints ---------- */

const n = z.number().int().min(0).max(1_000_000_000).nullable().default(null);
export const metricsSchema = z.object({
  variant_id: z.string().uuid(),
  checkpoint: z.enum(["h24", "h72", "d7", "d30"]),
  views: n, impressions: n, reach: n, likes: n, comments: n, saves: n, shares: n, profile_visits: n, link_clicks: n, site_visits: n, leads: n, follows: n,
});
/** Manual values at one checkpoint (source manual, editable); an API capture of the same checkpoint takes precedence. */
export async function saveMetrics(ctx: AppContext, founder: FounderKey, input: z.infer<typeof metricsSchema>) {
  const v = await ctx.repo.get("ContentVariants", input.variant_id);
  if (!v || v.is_archived) throw new RuleError("Content variant not found");
  if (v.status !== "published") throw new RuleError("Enter numbers once the post is published.");
  if (v.platform === "instagram" && input.impressions !== null) throw new RuleError("Instagram reports views; old impressions are not comparable and are not stored.");
  if (v.platform !== "instagram" && input.views !== null) throw new RuleError("LinkedIn reports impressions, not views.");
  const { variant_id, checkpoint, ...values } = input;
  const id = childId("post-snap", variant_id, checkpoint, "manual");
  const hours = CHECKPOINTS.find((c) => c.key === checkpoint)!.hours;
  const data = {
    account_id: v.account_id, variant_id, media_id: v.media_id, permalink: v.platform_post_url, media_kind: v.platform === "instagram" ? ("reel" as const) : ("linkedin" as const),
    checkpoint, slot: "", age_hours: hours, captured_at: new Date().toISOString(), availability: "ok" as const, ...values, source: "manual" as const,
  };
  const cur = await ctx.repo.get("SocialPostSnapshots", id, { fresh: true });
  if (cur) return ctx.repo.update("SocialPostSnapshots", id, cur.version, data, { founder });
  return (await ctx.repo.insert("SocialPostSnapshots", [{ id, ...data }], { founder }))[0];
}

/* ---------- editable checklist ---------- */

export const checklistSchema = z.object({
  platform: z.enum(["instagram", "linkedin"]),
  items: z.array(z.object({ key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/), label: z.string().trim().min(1).max(120) })).min(1).max(30),
});
export async function saveChecklist(ctx: AppContext, founder: FounderKey, input: z.infer<typeof checklistSchema>) {
  const keys = new Set(input.items.map((i) => i.key));
  if (keys.size !== input.items.length) throw new RuleError("Two checklist items have the same key.");
  const key = checklistKey(input.platform as ChecklistPlatform);
  const id = childId("setting", key);
  const value = JSON.stringify(input.items);
  const cur = await ctx.repo.get("SystemSettings", id, { fresh: true });
  if (cur) await ctx.repo.update("SystemSettings", id, cur.version, { value }, { founder });
  else await ctx.repo.insert("SystemSettings", [{ id, key, value, description: "Publishing checklist (Content Studio), JSON." }], { founder });
  return { items: input.items };
}

export type Studio = Awaited<ReturnType<typeof contentStudio>>;
export type MediaListing = Awaited<ReturnType<typeof browseMedia>>;
export type { Lang };
