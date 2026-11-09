import { z } from "zod";
import type { NewRow, Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { contentBrandOf, contentProgress, type ContentBrand } from "@/domain/content";
import {
  CHECKPOINTS, CONTENT_FORMATS, LANGS, PIECE_STAGES, PRODUCTION_STAGES, bestByCheckpoint, checklistKey, checklistPlatformOf, checklistProgress, columnOf,
  defaultOwner, defaultSlotFor, defaultUtm, deliverableOf, latestSnapshot, parseChecklist, platformOf, postPath, sumPaths, utmUrl, weekGrid,
  type ChecklistPlatform, type ContentFormat, type Lang,
} from "@/domain/content-studio";
import { addDays, localDate, startOfWeek } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { userRow } from "./common";
import { snapshotStatus } from "./snapshot";

/**
 * Content Studio (Stage 3 marketing, spec 5.6, D079): one piece = one concept with its FR and ES variants;
 * Kanban idea → script → shoot → edit → scheduled → published, week calendar on the round-8 slots, batch
 * production, editable publishing checklist, hand-entered post checkpoints and the views → leads path.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const https = z.union([z.literal(""), z.string().trim().max(1_000).regex(/^https:\/\/[^\s"'<>]+$/, "Enter a full https:// link")]);
const contentBrand = z.enum(["consulting", "thirty"]).nullable();

function dedupLogs(rows: Row<"ContentLog">[]) {
  const seen = new Map<string, Row<"ContentLog">>();
  for (const l of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) if (!seen.has(l.idempotency_key) && !l.is_archived) seen.set(l.idempotency_key, l);
  return [...seen.values()];
}

export const studioSchema = z.object({ week: day.optional() });

export async function contentStudio(ctx: AppContext, founder: FounderKey, input: z.infer<typeof studioSchema> = {}) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const week = startOfWeek(input.week ?? today);
  const t = await ctx.repo.listMany(["ContentPieces", "ContentVariants", "SocialPostSnapshots", "SocialAccounts", "ContentLog", "SystemSettings"]);
  const settings = (k: string) => t.SystemSettings.rows.find((r) => r.key === k)?.value ?? null;
  const checklists = { instagram: parseChecklist("instagram", settings(checklistKey("instagram"))), linkedin: parseChecklist("linkedin", settings(checklistKey("linkedin"))) };
  const snaps = t.SocialPostSnapshots.rows.filter((s) => !s.is_archived);
  const accounts = new Map(t.SocialAccounts.rows.map((a) => [a.id, a]));
  const sameUrl = (a: string, b: string) => Boolean(a && b) && a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

  const variants = t.ContentVariants.rows.filter((v) => !v.is_archived).map((v) => {
    const mine = snaps.filter((s) => s.variant_id === v.id || (v.media_id && s.media_id === v.media_id) || sameUrl(v.platform_post_url, s.permalink));
    const best = bestByCheckpoint(mine);
    const latest = latestSnapshot(mine);
    const list = checklists[checklistPlatformOf(v.platform)];
    return {
      ...v,
      account: accounts.get(v.account_id)?.handle ?? "",
      link: utmUrl(v.destination_url, v),
      checklist: checklistProgress(list, v.checklist_done),
      checkpoints: CHECKPOINTS.map((c) => ({ key: c.key, label: c.label, snapshot: best.get(c.key) ?? null })),
      stories: mine.filter((s) => s.checkpoint === "live").sort((a, b) => b.captured_at.localeCompare(a.captured_at)).slice(0, 4),
      latest: latest ? { checkpoint: latest.checkpoint, source: latest.source, captured_at: latest.captured_at, availability: latest.availability } : null,
      path: postPath(v.platform, latest),
    };
  });
  const pieces = t.ContentPieces.rows.filter((p) => !p.is_archived).map((p) => {
    const vs = variants.filter((v) => v.piece_id === p.id).sort((a, b) => a.language.localeCompare(b.language));
    return { ...p, column: columnOf(p.stage, vs), variants: vs };
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const pubDate = (v: (typeof variants)[number]) => (v.published_at ? localDate(v.published_at, u.timezone) : null);
  const weekEnd = addDays(week, 6);
  const inWeek = variants.filter((v) => v.status === "published" && (pubDate(v) ?? "") >= week && (pubDate(v) ?? "") <= weekEnd);
  const titleOf = new Map(pieces.map((p) => [p.id, p.title]));
  const grid = weekGrid(week, variants.filter((v) => v.status !== "draft").map((v) => ({ ...v, scheduled_date: v.status === "published" ? pubDate(v) ?? v.scheduled_date : v.scheduled_date })), addDays);
  const cell = (v: { id: string } | null) => {
    const x = v ? variants.find((y) => y.id === v.id) : null;
    return x ? { id: x.id, piece_id: x.piece_id, title: titleOf.get(x.piece_id) ?? "", language: x.language, status: x.status, platform: x.platform } : null;
  };

  return {
    week, today,
    pieces,
    columns: PIECE_STAGES.map((s) => ({ stage: s, count: pieces.filter((p) => p.column === s).length })),
    calendar: grid.days.map((d) => ({ weekday: d.weekday, date: d.date, slots: d.slots.map((s) => ({ key: s.slot.key, label: s.slot.label, deliverable: s.slot.deliverable, variant: cell(s.variant) })), extra: d.extra.map((x) => cell(x)!) })),
    targets: contentProgress(dedupLogs(t.ContentLog.rows), week, weekEnd),
    /** Instagram views and LinkedIn impressions are different measures: one path per network, never summed. */
    weekPath: {
      instagram: { posts: inWeek.filter((v) => v.platform === "instagram").length, steps: sumPaths(inWeek.filter((v) => v.platform === "instagram").map((v) => v.path)) },
      linkedin: { posts: inWeek.filter((v) => v.platform !== "instagram").length, steps: sumPaths(inWeek.filter((v) => v.platform !== "instagram").map((v) => v.path)) },
    },
    checklists,
    snapshot: await snapshotStatus(ctx),
  };
}

/* ---------- pieces ---------- */

export const createPieceSchema = z.object({
  id: z.string().uuid(),
  brand: contentBrand.default("thirty"),
  title: z.string().trim().min(1).max(200),
  format: z.enum(CONTENT_FORMATS).default("reel"),
  hook: z.string().trim().max(500).default(""),
  target_persona: z.string().trim().max(200).default(""),
  languages: z.array(z.enum(LANGS)).min(1).max(2).default(["FR", "ES"]),
});

function accountFor(accounts: Row<"SocialAccounts">[], format: ContentFormat, brand: ContentBrand | null, owner: FounderKey) {
  const platform = platformOf(format);
  return accounts.find((a) => !a.is_archived && a.platform === platform && (platform === "linkedin_personal" ? a.owner_founder === owner : contentBrandOf(a.brand) === brand))?.id ?? "";
}

/** New piece with one variant per language (FR → Théo, ES → Pablo). Retrying with the same id adds nothing. */
export async function createPiece(ctx: AppContext, founder: FounderKey, input: z.infer<typeof createPieceSchema>) {
  if (await ctx.repo.get("ContentPieces", input.id, { fresh: true })) return { id: input.id, duplicate: true };
  const brand = input.format === "personal_post" ? null : (input.brand ?? "thirty");
  const accounts = (await ctx.repo.list("SocialAccounts")).rows;
  const u = await userRow(ctx.repo, founder);
  const week = startOfWeek(localDate(new Date(), u.timezone));
  await ctx.repo.insert("ContentPieces", [{ id: input.id, brand, title: input.title, format: input.format, hook: input.hook, target_persona: input.target_persona, script: "", stage: "idea", author_founder: founder, asset_url: "", notes: "" }], { founder });
  const variants: NewRow<"ContentVariants">[] = [...new Set(input.languages)].map((lang) => {
    const owner = defaultOwner(lang, input.format, founder);
    const platform = platformOf(input.format);
    return {
      id: childId("content-variant", input.id, lang), piece_id: input.id, language: lang, platform, account_id: accountFor(accounts, input.format, brand, owner),
      owner_founder: owner, status: "draft", scheduled_date: null, slot_key: defaultSlotFor(input.format, brand, lang)?.key ?? "",
      caption: "", cta: "", destination_url: "", ...defaultUtm({ platform, brand, title: input.title, lang, format: input.format, weekStart: week }),
      checklist_done: [], published_at: null, platform_post_url: "", media_id: "",
    };
  });
  await ctx.repo.insert("ContentVariants", variants, { founder });
  return { id: input.id, duplicate: false };
}

export const updatePieceSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  patch: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    brand: contentBrand.optional(),
    hook: z.string().trim().max(500).optional(),
    target_persona: z.string().trim().max(200).optional(),
    script: z.string().max(20_000).optional(),
    stage: z.enum(PRODUCTION_STAGES).optional(),
    asset_url: https.optional(),
    notes: z.string().trim().max(2_000).optional(),
    is_archived: z.boolean().optional(),
  }),
});
/** Conditional update (spec 4.3): a stale version is a 409 shown with both values. */
export async function updatePiece(ctx: AppContext, founder: FounderKey, input: z.infer<typeof updatePieceSchema>) {
  const cur = await ctx.repo.get("ContentPieces", input.id, { fresh: true });
  if (!cur) throw new RuleError("Content piece not found");
  const patch = { ...input.patch };
  if (cur.format === "personal_post") delete patch.brand; // personal posts are never tagged with a brand (spec 2.3)
  return ctx.repo.update("ContentPieces", input.id, input.expected_version, patch, { founder });
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

/* ---------- variants ---------- */

export const variantSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  action: z.enum(["save", "schedule", "unschedule", "publish"]).default("save"),
  patch: z.object({
    caption: z.string().max(5_000).optional(),
    cta: z.string().trim().max(300).optional(),
    destination_url: https.optional(),
    utm_source: z.string().trim().max(60).regex(/^[\w.-]*$/).optional(),
    utm_medium: z.string().trim().max(60).regex(/^[\w.-]*$/).optional(),
    utm_campaign: z.string().trim().max(120).regex(/^[\w.-]*$/).optional(),
    utm_content: z.string().trim().max(120).regex(/^[\w.-]*$/).optional(),
    checklist_done: z.array(z.string().max(40)).max(40).optional(),
    scheduled_date: day.optional(),
    slot_key: z.string().max(60).optional(),
    owner_founder: z.enum(["theo", "pablo"]).optional(),
    platform_post_url: https.optional(),
    published_at: z.string().datetime({ offset: true }).optional(),
  }).default({}),
});

/** Save, schedule, unschedule or publish one language variant. Publishing counts the piece once in the weekly goals. */
export async function updateVariant(ctx: AppContext, founder: FounderKey, input: z.infer<typeof variantSchema>) {
  const cur = await ctx.repo.get("ContentVariants", input.id, { fresh: true });
  if (!cur) throw new RuleError("Content variant not found");
  const patch: Partial<Row<"ContentVariants">> = { ...input.patch };
  if (input.action === "schedule") {
    if (!(patch.scheduled_date ?? cur.scheduled_date)) throw new RuleError("Choose a publishing date first.");
    patch.status = "scheduled";
  } else if (input.action === "unschedule") {
    patch.status = "draft";
    patch.scheduled_date = null;
  } else if (input.action === "publish") {
    patch.status = "published";
    patch.published_at = input.patch.published_at ? new Date(input.patch.published_at).toISOString() : cur.published_at ?? new Date().toISOString();
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
  const brand = piece.format === "personal_post" ? null : piece.brand;
  const rows: NewRow<"ContentLog">[] = [];
  const pub = childId("content-publish", v.id);
  if (!have.has(pub)) rows.push({ id: pub, idempotency_key: pub, founder_key: v.owner_founder, deliverable: deliverableOf(piece.format), brand, language: v.language, title: piece.title, url: v.platform_post_url, local_date: date });
  const concept = childId("content-concept", piece.id);
  if ((piece.format === "reel" || piece.format === "vsl") && !have.has(concept)) rows.push({ id: concept, idempotency_key: concept, founder_key: piece.author_founder, deliverable: "concept", brand, language: null, title: piece.title, url: "", local_date: date });
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
export type { Lang };
