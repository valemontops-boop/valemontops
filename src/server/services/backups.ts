import { z } from "zod";
import type { DataRepository, Row } from "@/data/repository";
import { columnsOf, TABLE_NAMES } from "@/data/schema/tables";
import { serializeCell } from "@/data/schema/codecs";
import type { SheetsClient } from "@/data/sheets/client";
import { readAllTabs } from "@/data/sheets/backup";
import { schemaHash } from "@/data/sheets/setup";
import type { BackupDrivePort } from "@/data/google/backup-drive";
import { BUNDLE_FORMAT, backupDay, backupName, compareToLive, describeIssues, expiredBackups, statsOf, verifyStats, type Bundle } from "@/domain/backup";
import { localDate } from "@/domain/time";
import { childId, newId } from "@/lib/ids";
import { RuleError } from "../errors";
import { logger } from "../log";
import type { AppContext } from "../context";
import { recordIntegration } from "./integration-status";
import { connectorEnvSync } from "../connector-env";

/**
 * Daily backups (Stage 4B, D084). A backup is a Drive copy of the live spreadsheet in a backups folder, named
 * "Valemont OS backup YYYY-MM-DD" — Google Sheets stays the only store: there is no other database. Without cron
 * (spec 4.6): the first request of the day starts it (lazy), or an external scheduler calls the protected
 * POST /api/jobs/backup. One per day: an in-process lock, a lease row in BackupRuns (first writer wins) and a
 * deterministic "done" row make a repeat or a race between two server instances a no-op.
 * Restore = docs/DEPLOYMENT.md › Restore (scripts/restore-sheets.ts): always into a NEW spreadsheet, never over live.
 */

export interface BackupEnv {
  /** The live spreadsheet. */
  sourceId: string;
  /** Sheets client for any spreadsheet the service account can open (the live one, a backup copy). */
  clientFor: (spreadsheetId: string) => SheetsClient;
  drive: BackupDrivePort | null;
  folderId: string;
  retentionDays: number;
}

export const BACKUP_TZ = "Europe/Paris";
export const DEFAULT_RETENTION_DAYS = 30;
const SYSTEM = { founder: "system" };
type Trigger = Row<"BackupRuns">["trigger"];

export const MISMATCH_ERROR = "The copy does not match the live spreadsheet.";
export const QUOTA_ERROR = "The service account cannot own files on a personal Google account: use a Shared Drive folder or the Apps Script backup (docs/DEPLOYMENT.md › Backups).";
export const ACCESS_ERROR = "The service account cannot reach the spreadsheet or the backups folder: share them with it (Editor).";
export const UNREACHABLE_ERROR = "Google Drive or Sheets did not answer; the next trigger retries.";

export type BackupResult =
  | { status: "not_configured" }
  | { status: "skipped"; day: string }
  | { status: "busy"; day: string }
  | { status: "done" | "error"; day: string; file_id: string; file_url: string; tabs: number; rows: number; verify: "ok" | "mismatch" | "not_run"; detail: string; deleted: number; error: string };

/** Reads BACKUP_* (env first, then the app's settings, D087; LIVE only). Retention 1–365 days, default 30. */
export function backupSettingsFromEnv(env: Record<string, string | undefined> = connectorEnvSync()) {
  const n = Number(env.BACKUP_RETENTION_DAYS);
  return { folderId: (env.BACKUP_DRIVE_FOLDER_ID ?? "").trim(), retentionDays: Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_RETENTION_DAYS };
}

const g = globalThis as unknown as { __valemontBackup?: Map<string, Promise<BackupResult>>; __valemontBackupLazy?: { day: string; at: number } };
const inflight = () => (g.__valemontBackup ??= new Map());

export function backupConfigured(ctx: AppContext): boolean {
  return Boolean(ctx.mode === "live" && ctx.backup?.drive && ctx.backup.folderId && ctx.backup.sourceId);
}

/** Runs today's backup; a second call the same day (or while one runs) is a no-op. Never throws. */
export function runBackup(ctx: AppContext, opts: { trigger: Trigger; now?: Date }): Promise<BackupResult> {
  if (!backupConfigured(ctx)) return Promise.resolve({ status: "not_configured" });
  const now = opts.now ?? new Date();
  const day = localDate(now, BACKUP_TZ);
  const running = inflight().get(day);
  if (running) return running;
  const p = doBackup(ctx, day, now, opts.trigger)
    .catch((e): BackupResult => {
      logger.error("backup_failed", { day, error: e as Error });
      return { status: "error", day, file_id: "", file_url: "", tabs: 0, rows: 0, verify: "not_run", detail: "", deleted: 0, error: UNREACHABLE_ERROR };
    })
    .finally(() => inflight().delete(day));
  inflight().set(day, p);
  return p;
}

async function doBackup(ctx: AppContext, day: string, now: Date, trigger: Trigger): Promise<BackupResult> {
  const env = ctx.backup!;
  const repo = ctx.repo;
  const doneId = childId("backup-run", day, "done");
  if (await repo.get("BackupRuns", doneId, { fresh: true })) return { status: "skipped", day };

  // Lease: one per 30-minute window, so a crashed attempt is retried by the next window. First writer wins (D006).
  const window = Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 30);
  const leaseId = childId("backup-lease", day, String(window));
  const owner = newId();
  const started = new Date().toISOString();
  await repo.insert("BackupRuns", [{ id: leaseId, day, trigger, status: "running", owner, file_id: "", file_name: "", file_url: "", tabs: null, rows: null, verify_status: "not_run", verify_detail: "", deleted: null, error: "", started_at: started, finished_at: null }], SYSTEM);
  const lease = await repo.get("BackupRuns", leaseId, { fresh: true });
  if (lease?.owner !== owner) return { status: "busy", day };

  const live = env.clientFor(env.sourceId);
  let file = { id: "", name: backupName(day), webViewLink: "" };
  let result: BackupResult;
  try {
    const before = statsOf(await readAllTabs(live));
    const copied = await env.drive!.copy(env.sourceId, backupName(day), env.folderId);
    file = { id: copied.id, name: copied.name, webViewLink: copied.webViewLink ?? "" };
    const copy = statsOf(await readAllTabs(env.clientFor(copied.id)));
    let verify = verifyStats(copy, before);
    // Rows appended while Drive copied the file are fine: re-read live once and check the window.
    if (!verify.ok && verify.issues.every((i) => i.kind === "more_rows")) verify = verifyStats(copy, before, statsOf(await readAllTabs(live)));
    let deleted = 0;
    if (verify.ok) {
      for (const f of expiredBackups(await env.drive!.list(env.folderId), day, env.retentionDays)) {
        await env.drive!.trash(f.id);
        deleted++;
      }
    }
    result = { status: verify.ok ? "done" : "error", day, file_id: file.id, file_url: file.webViewLink, tabs: verify.tabs, rows: verify.rows, verify: verify.ok ? "ok" : "mismatch", detail: describeIssues(verify), deleted, error: verify.ok ? "" : MISMATCH_ERROR };
  } catch (e) {
    // The founder sees a fixed sentence in their language; Google's own (English) message goes to the logs only.
    const msg = (e as Error).message;
    logger.error("backup_step_failed", { day, error: e as Error });
    const error = /storage ?quota/i.test(msg) ? QUOTA_ERROR : /\b(403|404)\b/.test(msg) ? ACCESS_ERROR : UNREACHABLE_ERROR;
    result = { status: "error", day, file_id: file.id, file_url: file.webViewLink, tabs: 0, rows: 0, verify: "not_run", detail: "", deleted: 0, error };
  }
  // Only a verified backup closes the day; after an error the next trigger tries again.
  await repo.insert("BackupRuns", [{
    id: result.status === "done" ? doneId : newId(), day, trigger, status: result.status, owner, file_id: result.file_id, file_name: file.name, file_url: result.file_url,
    tabs: result.tabs, rows: result.rows, verify_status: result.verify, verify_detail: result.detail, deleted: result.deleted, error: result.error, started_at: started, finished_at: new Date().toISOString(),
  }], SYSTEM);
  await recordIntegration(repo, "backup", result.status === "done", result.error, now);
  logger[result.status === "done" ? "info" : "error"]("backup", { day, trigger, status: result.status, verify: result.verify, tabs: result.tabs, rows: result.rows, deleted: result.deleted });
  return result;
}

/** Lazy daily trigger (spec 4.6), called by the polling endpoint: at most one attempt per day and process, retried after 30 min on error. */
export function maybeBackup(ctx: AppContext, now = new Date()): Promise<BackupResult> | null {
  if (!backupConfigured(ctx)) return null;
  const day = localDate(now, BACKUP_TZ);
  const last = g.__valemontBackupLazy;
  if (last && last.day === day && now.getTime() - last.at < 30 * 60_000) return null;
  g.__valemontBackupLazy = { day, at: now.getTime() };
  const p = runBackup(ctx, { trigger: "first_request", now });
  void p.then((r) => {
    if (r.status === "done" || r.status === "skipped") g.__valemontBackupLazy = { day, at: Number.MAX_SAFE_INTEGER };
  });
  return p;
}

export function resetBackupLocks() {
  g.__valemontBackup = new Map();
  g.__valemontBackupLazy = undefined;
}

/** Settings › Diagnostics › Backups. */
export async function backupStatus(ctx: AppContext) {
  const { rows } = await ctx.repo.list("BackupRuns");
  const results = rows.filter((r) => r.status !== "running").sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at));
  const lastDone = results.find((r) => r.status === "done") ?? null;
  return {
    mode: ctx.mode,
    configured: backupConfigured(ctx),
    retentionDays: ctx.backup?.retentionDays ?? DEFAULT_RETENTION_DAYS,
    folderUrl: ctx.backup?.folderId ? `https://drive.google.com/drive/folders/${encodeURIComponent(ctx.backup.folderId)}` : "",
    schedulerConfigured: ((e) => Boolean(e.BACKUP_JOB_SECRET || e.BACKUP_JOB_TOKEN))(connectorEnvSync()),
    today: localDate(new Date(), BACKUP_TZ),
    lastDone: lastDone ? runView(lastDone) : null,
    runs: results.slice(0, 7).map(runView),
  };
}

function runView(r: Row<"BackupRuns">) {
  return { day: r.day, status: r.status, trigger: r.trigger, file_id: r.file_id, file_name: r.file_name, file_url: r.file_url, tabs: r.tabs, rows: r.rows, verify: r.verify_status, detail: r.verify_detail, deleted: r.deleted, error: r.error, finished_at: r.finished_at };
}

export const verifyBackupSchema = z.object({ file_id: z.string().trim().regex(/^[A-Za-z0-9_-]{5,200}$/) });

/** "Verify a backup": an existing copy from the backups folder against the live spreadsheet now (tab/row counts). */
export async function verifyBackup(ctx: AppContext, input: z.infer<typeof verifyBackupSchema>) {
  if (!backupConfigured(ctx)) throw new RuleError("Backups are not configured (BACKUP_DRIVE_FOLDER_ID).");
  const env = ctx.backup!;
  const file = (await env.drive!.list(env.folderId)).find((f) => f.id === input.file_id && backupDay(f.name));
  if (!file) throw new RuleError("This file is not a backup of the backups folder.");
  const [copy, live] = await Promise.all([readAllTabs(env.clientFor(file.id)), readAllTabs(env.clientFor(env.sourceId))]);
  const r = compareToLive(statsOf(copy), statsOf(live));
  return { file_id: file.id, day: backupDay(file.name), ok: r.ok, tabs: r.tabs, rows: r.rows, newerRows: r.newerRows, issues: r.issues.slice(0, 20) };
}

/**
 * JSON export bundle (the "download a copy" option): every tab of the shared spreadsheet as text grids. Private
 * founder spreadsheets are never included (spec 4.7). Raw grids in LIVE (malformed rows kept), repository rows
 * otherwise (DEMO).
 */
export async function exportBundle(ctx: AppContext, now = new Date()): Promise<{ filename: string; body: string }> {
  let tabs: Record<string, string[][]>;
  let source: Bundle["source"] = "memory";
  if (ctx.mode === "live" && ctx.backup?.sourceId) {
    const raw = await readAllTabs(ctx.backup.clientFor(ctx.backup.sourceId));
    tabs = Object.fromEntries(Object.entries(raw).map(([t, grid]) => [t, grid.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))))]));
    source = "sheets";
  } else {
    tabs = await bundleFromRepo(ctx.repo);
    source = ctx.repo.kind === "sheets" ? "sheets" : "memory";
  }
  const bundle: Bundle = { format: BUNDLE_FORMAT, version: 1, schema_hash: schemaHash(), exported_at: now.toISOString(), source, tabs };
  return { filename: `valemont-os-backup-${localDate(now, BACKUP_TZ)}.json`, body: JSON.stringify(bundle) };
}

async function bundleFromRepo(repo: DataRepository): Promise<Record<string, string[][]>> {
  const all = await repo.listMany(TABLE_NAMES);
  return Object.fromEntries(TABLE_NAMES.map((t) => {
    const cols = columnsOf(t);
    return [t, [cols, ...(all[t].rows as unknown as Record<string, unknown>[]).map((r) => cols.map((c) => serializeCell(r[c])))]];
  }));
}
