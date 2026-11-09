import "server-only";
import type { FounderKey } from "@/domain/constants";
import type { DataRepository } from "@/data/repository";
import { decodeServiceAccountKey } from "@/data/sheets/auth";
import { SheetsClient } from "@/data/sheets/client";
import { runDoctor, type DoctorCheck } from "@/data/sheets/doctor";
import { schemaHash, setupSpreadsheet, wantedTabs } from "@/data/sheets/setup";
import { quoteSheet } from "@/data/sheets/a1";
import type { AppConfig } from "../config";
import { sheetsTokenFor } from "../repo";
import { seedBaseline } from "./baseline";

/**
 * In-app installation (D086): the same idempotent `setupSpreadsheet` + `seedBaseline` + `runDoctor` that
 * `npm run setup:sheets` / `npm run doctor:sheets` run, called from founder-only routes so no terminal is needed.
 * Each founder prepares the shared Sheet and only their own private Sheet (never the other founder's).
 */

export type SheetTarget = "shared" | FounderKey;
export type Access = "ok" | "forbidden" | "read_only" | "not_found" | "not_configured" | "error";
export type TabState = "ok" | "missing" | "columns_missing";
export interface TabStatus { tab: string; state: TabState; missingColumns?: string[] }
export interface SheetStatus { target: SheetTarget; access: Access; ready: boolean; title?: string; tabs: TabStatus[]; error?: string }

export type TabResult = "created" | "headers" | "columns" | "unchanged";
export interface InstallResult {
  target: SheetTarget;
  ok: boolean;
  access: Access;
  serviceEmail: string | null;
  tabs: { tab: string; result: TabResult; columns?: string[] }[];
  seeded: Record<string, number>;
  error?: string;
}

const kindOf = (t: SheetTarget) => (t === "shared" ? "shared" : "private");

/** Spreadsheet id for a target, or "" when not configured (private Sheets are optional). */
export function spreadsheetIdOf(cfg: AppConfig, target: SheetTarget, env: Record<string, string | undefined> = process.env): string {
  if (target === "shared") return cfg.sheets.spreadsheetId;
  return (target === "theo" ? env.PRIVATE_SHEET_ID_THEO : env.PRIVATE_SHEET_ID_PABLO)?.trim() ?? "";
}

/** The service account address founders must share their Sheets with (from the key; never the key itself). */
export function serviceAccountEmail(cfg: AppConfig): string | null {
  try {
    return decodeServiceAccountKey(cfg.sheets.serviceAccountB64).client_email;
  } catch {
    return null;
  }
}

export function sheetsClientFor(cfg: AppConfig, spreadsheetId: string): SheetsClient {
  const key = cfg.sheets.isGoogle ? decodeServiceAccountKey(cfg.sheets.serviceAccountB64) : { client_email: "", private_key: "" };
  return new SheetsClient({ baseUrl: cfg.sheets.baseUrl, spreadsheetId, getToken: sheetsTokenFor(cfg, key), maxRetries: 2 });
}

function accessOf(e: unknown): Access {
  const status = (e as { status?: number }).status;
  return status === 403 || status === 401 ? "forbidden" : status === 404 ? "not_found" : "error";
}

/** Read-only check: which tabs and header columns are missing. Two Sheets API reads. */
export async function inspectSheet(client: SheetsClient, target: SheetTarget): Promise<SheetStatus> {
  const wanted = wantedTabs(kindOf(target));
  let meta;
  try {
    meta = await client.getMeta();
  } catch (e) {
    return { target, access: accessOf(e), ready: false, tabs: [], error: accessOf(e) === "error" ? (e as Error).message : undefined };
  }
  const present = new Set(meta.sheets.map((s) => s.properties.title));
  const names = Object.keys(wanted);
  const existing = names.filter((t) => present.has(t));
  let headers: unknown[][][] = [];
  try {
    headers = existing.length ? await client.batchGet(existing.map((t) => `${quoteSheet(t)}!1:1`)) : [];
  } catch (e) {
    return { target, access: accessOf(e), ready: false, title: meta.properties.title, tabs: [], error: (e as Error).message };
  }
  const headerOf = new Map(existing.map((t, i) => [t, ((headers[i]?.[0] ?? []) as unknown[]).map((h) => String(h ?? "").trim())]));
  const tabs: TabStatus[] = names.map((tab) => {
    if (!present.has(tab)) return { tab, state: "missing" };
    const h = headerOf.get(tab) ?? [];
    const miss = wanted[tab].filter((c) => !h.includes(c));
    return miss.length ? { tab, state: "columns_missing", missingColumns: miss } : { tab, state: "ok" };
  });
  return { target, access: "ok", ready: tabs.every((t) => t.state === "ok"), title: meta.properties.title, tabs };
}

export async function sheetStatus(cfg: AppConfig, target: SheetTarget): Promise<SheetStatus> {
  const id = spreadsheetIdOf(cfg, target);
  if (!id) return { target, access: "not_configured", ready: true, tabs: [] };
  return inspectSheet(sheetsClientFor(cfg, id), target);
}

/** What the Installation page shows: the shared Sheet and the signed-in founder's own private Sheet. */
export async function installStatus(cfg: AppConfig, founder: FounderKey) {
  const [shared, own] = await Promise.all([sheetStatus(cfg, "shared"), sheetStatus(cfg, founder)]);
  return { serviceEmail: serviceAccountEmail(cfg), sheets: [shared, own] };
}

/* ---------------- readiness gate (cached once ready) ---------------- */

const g = globalThis as unknown as { __valemontInstall?: Map<string, true> };
const readyCache = () => (g.__valemontInstall ??= new Map());
const gateKey = (cfg: AppConfig, founder: FounderKey) => [cfg.sheets.baseUrl, cfg.sheets.spreadsheetId, spreadsheetIdOf(cfg, founder), founder, schemaHash()].join("|");

/**
 * LIVE only: true when the shared Sheet (or the founder's own private Sheet) lacks tabs or header columns, or the
 * service account cannot open the shared Sheet. Unknown states (network error) never block the app.
 * Once ready, the answer is cached for the life of the server process (no Sheets call on later pages).
 */
export async function needsInstall(cfg: AppConfig, founder: FounderKey): Promise<boolean> {
  if (cfg.mode !== "live" || !cfg.ok) return false;
  const key = gateKey(cfg, founder);
  if (readyCache().has(key)) return false;
  const [shared, own] = await Promise.all([sheetStatus(cfg, "shared"), sheetStatus(cfg, founder)]);
  const blocks = (s: SheetStatus, strict: boolean) => (s.access === "ok" ? !s.ready : strict && (s.access === "forbidden" || s.access === "not_found"));
  // A private Sheet the service account cannot open is reported on the Installation page, but does not block the app.
  const needed = blocks(shared, true) || blocks(own, false);
  if (!needed && shared.access === "ok" && (own.access === "ok" || own.access === "not_configured")) readyCache().set(key, true);
  return needed;
}

export function resetInstallCache() {
  readyCache().clear();
}

/* ---------------- run ---------------- */

const inflight = new Map<string, Promise<InstallResult>>();

/** Idempotent; concurrent clicks on the same server share one run. */
export function runInstall(cfg: AppConfig, target: SheetTarget, repo: DataRepository | null): Promise<InstallResult> {
  const id = spreadsheetIdOf(cfg, target);
  const k = `${target}|${id}`;
  const running = inflight.get(k);
  if (running) return running;
  const p = doRun(cfg, target, id, repo).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

async function doRun(cfg: AppConfig, target: SheetTarget, id: string, repo: DataRepository | null): Promise<InstallResult> {
  const serviceEmail = serviceAccountEmail(cfg);
  const base = { target, serviceEmail, tabs: [], seeded: {} };
  if (!id) return { ...base, ok: false, access: "not_configured" };
  const client = sheetsClientFor(cfg, id);
  try {
    await client.getMeta();
  } catch (e) {
    return { ...base, ok: false, access: accessOf(e), error: accessOf(e) === "error" ? (e as Error).message : undefined };
  }
  const kind = kindOf(target);
  let report;
  try {
    try {
      report = await setupSpreadsheet(client, kind);
    } catch (e) {
      // Another server instance may have added the same tab a moment earlier ("already exists"): run once more.
      if ((e as { status?: number }).status !== 400) throw e;
      report = await setupSpreadsheet(client, kind);
    }
  } catch (e) {
    const status = (e as { status?: number }).status;
    // getMeta worked, a write was refused: the Sheet is shared, but as Viewer/Commenter instead of Editor.
    if (status === 403 || status === 401) return { ...base, ok: false, access: "read_only" };
    return { ...base, ok: false, access: "error", error: (e as Error).message };
  }
  const created = new Set(report.created);
  const headers = new Set(report.headersWritten);
  const cols = new Map(report.columnsAdded.map((c) => [c.tab, c.columns]));
  const tabs = Object.keys(wantedTabs(kind)).map((tab) =>
    created.has(tab) ? { tab, result: "created" as const } : headers.has(tab) ? { tab, result: "headers" as const } : cols.has(tab) ? { tab, result: "columns" as const, columns: cols.get(tab) } : { tab, result: "unchanged" as const },
  );
  let seeded: Record<string, number> = {};
  if (target === "shared" && repo) {
    try {
      seeded = await seedBaseline(repo, { theo: cfg.founders.theo.timezone, pablo: cfg.founders.pablo.timezone });
    } catch (e) {
      return { ...base, ok: false, access: "ok", tabs, error: (e as Error).message };
    }
  }
  resetInstallCache();
  return { ...base, ok: true, access: "ok", tabs, seeded };
}

/** "Vérifier": the CLI doctor on the shared Sheet, plus a tab/header check of the founder's own private Sheet. */
export async function runInstallDoctor(cfg: AppConfig, founder: FounderKey): Promise<{ serviceEmail: string | null; checks: DoctorCheck[]; own: SheetStatus }> {
  const [checks, own] = await Promise.all([runDoctor(sheetsClientFor(cfg, cfg.sheets.spreadsheetId)), sheetStatus(cfg, founder)]);
  return { serviceEmail: serviceAccountEmail(cfg), checks, own };
}
