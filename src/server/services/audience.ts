import { z } from "zod";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import type { Row } from "@/data/repository";
import { childId, newId } from "@/lib/ids";
import { BRANDS, MARKETS, type FounderKey } from "@/domain/constants";
import { AUDIENCE_METRICS, bestPerDay, mapSheet, mergeSheets, primaryMetricFor, seriesWithGaps, type AudienceMetric } from "@/domain/audience";
import { addDays, localDate } from "@/domain/time";
import { ForbiddenError, RuleError } from "../errors";
import type { AppContext } from "../context";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Personal LinkedIn profiles are owner-only and never tagged with a brand (spec 2.3, 5.6). */
function canSee(a: Row<"SocialAccounts">, viewer: string) {
  return a.visibility === "team" || a.owner_founder === viewer;
}

export async function listAccounts(ctx: AppContext, viewer: FounderKey) {
  return (await ctx.repo.list("SocialAccounts")).rows.filter((a) => !a.is_archived && canSee(a, viewer));
}

export const socialAccountSchema = z.object({
  id: z.string().uuid(),
  platform: z.enum(["instagram", "linkedin_page", "linkedin_personal"]),
  handle: z.string().trim().min(1).max(120),
  brand: z.enum(BRANDS).nullable().default(null),
  market: z.enum(MARKETS).nullable().default(null),
});
export async function addSocialAccount(ctx: AppContext, founder: FounderKey, input: z.infer<typeof socialAccountSchema>) {
  if (await ctx.repo.get("SocialAccounts", input.id, { fresh: true })) return { duplicate: true };
  const personal = input.platform === "linkedin_personal";
  await ctx.repo.insert("SocialAccounts", [{
    ...input, brand: personal ? null : input.brand, owner_founder: personal ? founder : null,
    connection_mode: input.platform === "instagram" ? "manual" : "import", visibility: personal ? "owner" : "team",
  }], { founder });
  return { duplicate: false };
}

async function accountFor(ctx: AppContext, viewer: FounderKey, accountId: string) {
  const a = await ctx.repo.get("SocialAccounts", accountId);
  if (!a || a.is_archived) throw new RuleError("Account not found");
  if (!canSee(a, viewer)) throw new ForbiddenError("This profile is private to its owner.");
  return a;
}

const n = z.number().int().min(0).max(1_000_000_000).nullable().default(null);
export const manualEntrySchema = z.object({ account_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), followers: n, views: n, impressions: n, reach: n, profile_visits: n, interactions: n, link_clicks: n });

/** Manual entry: one row per account and day for source "manual" (re-entering replaces the same row). */
export async function addManualEntry(ctx: AppContext, founder: FounderKey, input: z.infer<typeof manualEntrySchema>) {
  const a = await accountFor(ctx, founder, input.account_id);
  if (a.platform === "instagram" && input.impressions !== null) throw new RuleError("Instagram reports views; old impressions are not comparable and are not stored.");
  if (a.platform !== "instagram" && input.views !== null) throw new RuleError("LinkedIn reports impressions, not views.");
  const id = childId("social-daily", a.id, input.date, "manual");
  const data = { account_id: a.id, date: input.date, followers: input.followers, views: input.views, impressions: input.impressions, reach: input.reach, profile_visits: input.profile_visits, interactions: input.interactions, link_clicks: input.link_clicks, source: "manual" as const, captured_at: new Date().toISOString(), import_file: "" };
  const cur = await ctx.repo.get("SocialAccountDaily", id, { fresh: true });
  if (cur) return ctx.repo.update("SocialAccountDaily", id, cur.version, data, { founder });
  return (await ctx.repo.insert("SocialAccountDaily", [{ id, ...data }], { founder }))[0];
}

/** Reads an uploaded export into raw grids, one per sheet. XLSX via exceljs; legacy XLS via SheetJS (D020). */
export async function readWorkbook(bytes: Uint8Array): Promise<unknown[][][]> {
  if (bytes.length > MAX_IMPORT_BYTES) throw new RuleError("File too large (max 2 MB).");
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isZip) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as never);
    return wb.worksheets.map((ws) => {
      const grid: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v && typeof v === "object" && "text" in (v as object) ? (v as { text: unknown }).text : v));
        grid.push(vals);
      });
      return grid;
    });
  }
  if (isOle) {
    const wb = XLSX.read(bytes, { type: "array", cellDates: true, sheetRows: 5_000 });
    return wb.SheetNames.map((name) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, blankrows: false }));
  }
  throw new RuleError("Unrecognised file. Upload the .xls or .xlsx export from LinkedIn.");
}

export const importSchema = z.object({ account_id: z.string().uuid(), file_name: z.string().trim().max(200), data_base64: z.string().max(Math.ceil((MAX_IMPORT_BYTES * 4) / 3) + 8), commit: z.boolean().default(false) });

/** Guided LinkedIn import: preview mapped and unrecognised columns; re-importing the same file adds no row. */
export async function importLinkedIn(ctx: AppContext, founder: FounderKey, input: z.infer<typeof importSchema>) {
  const a = await accountFor(ctx, founder, input.account_id);
  if (a.platform === "instagram") throw new RuleError("Instagram data comes from the API or manual entry, not a LinkedIn export.");
  const grids = await readWorkbook(Uint8Array.from(Buffer.from(input.data_base64, "base64")));
  const sheets = grids.map(mapSheet).filter((s): s is NonNullable<typeof s> => s !== null);
  if (!sheets.length) throw new RuleError("No sheet with a Date column was found in this file.");
  const days = mergeSheets(sheets);
  const existing = new Set((await ctx.repo.list("SocialAccountDaily", { fresh: true })).rows.map((r) => r.id));
  const rows = days.map((d) => ({
    id: childId("social-daily", a.id, d.date, "import"), account_id: a.id, date: d.date,
    followers: d.values.followers ?? null, views: null, impressions: d.values.impressions ?? null, reach: d.values.reach ?? null,
    profile_visits: d.values.profile_visits ?? null, interactions: d.values.interactions ?? null, link_clicks: d.values.link_clicks ?? null,
    source: "import" as const, captured_at: new Date().toISOString(), import_file: input.file_name,
  }));
  const fresh = rows.filter((r) => !existing.has(r.id));
  const preview = {
    mapped: Object.assign({}, ...sheets.map((s) => s.mapped)) as Record<string, string>,
    unrecognized: [...new Set(sheets.flatMap((s) => s.unrecognized))],
    days: days.length, newRows: fresh.length, alreadyImported: rows.length - fresh.length,
    range: days.length ? { from: days[0].date, to: days[days.length - 1].date } : null,
  };
  if (input.commit && fresh.length) {
    await ctx.repo.insert("SocialAccountDaily", fresh, { founder });
    await ctx.repo.insert("AuditLog", [{ id: newId(), actor: founder, action: "audience.import", table_name: "SocialAccountDaily", record_id: a.id, fields: `rows:${fresh.length}`, correlation_id: "" }], { founder });
  }
  return { ...preview, committed: input.commit };
}

export const seriesSchema = z.object({ account_id: z.string().uuid(), metric: z.enum(AUDIENCE_METRICS).optional(), days: z.coerce.number().int().min(7).max(365).default(30) });

/** Series for one account, one metric; gaps stay null; every value carries its source. */
export async function audienceSeries(ctx: AppContext, viewer: FounderKey, input: z.infer<typeof seriesSchema>) {
  const a = await accountFor(ctx, viewer, input.account_id);
  const metric: AudienceMetric = input.metric ?? primaryMetricFor(a.platform);
  const rows = bestPerDay((await ctx.repo.list("SocialAccountDaily")).rows.filter((r) => r.account_id === a.id && !r.is_archived));
  const to = localDate(new Date(), "Europe/Paris");
  const from = addDays(to, -input.days + 1);
  const bySource = new Map(rows.map((r) => [r.date, r.source]));
  const points = seriesWithGaps(rows, from, to, (r) => r[metric] as number | null, addDays).map((p) => ({ ...p, source: p.value === null ? null : bySource.get(p.date) ?? null }));
  const allowed = AUDIENCE_METRICS.filter((m) => (a.platform === "instagram" ? m !== "impressions" : m !== "views"));
  const latest = [...rows].reverse().find((r) => r[metric] !== null);
  return { account: a, metric, allowedMetrics: allowed, points, gaps: points.filter((p) => p.value === null).length, latest: latest ? { date: latest.date, value: latest[metric] as number, source: latest.source } : null };
}
