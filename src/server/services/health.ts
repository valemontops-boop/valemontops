import type { AppContext } from "../context";
import { auditStats, pendingAudit } from "./audit-log";
import { backupConfigured } from "./backups";

/**
 * Health (Stage 4B, D084). Liveness = the process answers. Readiness = configuration valid + Google Sheets reachable
 * with the cheapest call (the small revisions range, spec 4.1), cached 30 s so an uptime monitor cannot eat the
 * shared quota, + a count of integrations in error. No secret, no address, no data in the public answer.
 */
export interface SheetsProbe { ok: boolean; ms: number; at: number; error: string }
const g = globalThis as unknown as { __valemontHealth?: SheetsProbe; __valemontStarted?: number };
g.__valemontStarted ??= Date.now();
export const PROBE_TTL_MS = 30_000;

export async function probeSheets(ctx: AppContext, now = Date.now()): Promise<SheetsProbe> {
  const c = g.__valemontHealth;
  if (c && now - c.at < PROBE_TTL_MS) return c;
  const t0 = Date.now();
  try {
    await ctx.repo.revisions({ fresh: true });
    g.__valemontHealth = { ok: true, ms: Date.now() - t0, at: now, error: "" };
  } catch (e) {
    g.__valemontHealth = { ok: false, ms: Date.now() - t0, at: now, error: (e as Error).message.slice(0, 200) };
  }
  return g.__valemontHealth;
}

export function resetHealthCache() {
  g.__valemontHealth = undefined;
}

async function integrationRows(ctx: AppContext) {
  try {
    return (await ctx.repo.list("IntegrationStatuses")).rows.filter((r) => !r.is_archived);
  } catch {
    return [];
  }
}

/** Public readiness summary. */
export async function readiness(ctx: AppContext) {
  const sheets = await probeSheets(ctx);
  const rows = sheets.ok ? await integrationRows(ctx) : [];
  return {
    ready: sheets.ok,
    checks: { process: "ok" as const, config: "ok" as const, sheets: sheets.ok ? ("ok" as const) : ("fail" as const) },
    integrations: { ok: rows.filter((r) => r.status === "ok").length, error: rows.filter((r) => r.status === "error").length },
  };
}

/** Founders only (/api/health/details): the same checks with the reasons, timings and counters. */
export async function healthDetails(ctx: AppContext, configErrors: string[]) {
  const sheets = await probeSheets(ctx);
  const rows = sheets.ok ? await integrationRows(ctx) : [];
  const mem = typeof process !== "undefined" && process.memoryUsage ? Math.round(process.memoryUsage().rss / 1_048_576) : null;
  return {
    ready: sheets.ok && configErrors.length === 0,
    mode: ctx.mode,
    adapter: ctx.repo.kind,
    process: { uptimeSec: Math.round((Date.now() - (g.__valemontStarted ?? Date.now())) / 1000), node: typeof process !== "undefined" ? process.version ?? "" : "", rssMb: mem, logLevel: (typeof process !== "undefined" && process.env?.LOG_LEVEL) || "info" },
    config: { ok: configErrors.length === 0, errors: configErrors },
    sheets: { ok: sheets.ok, ms: sheets.ms, checkedAt: new Date(sheets.at).toISOString(), error: sheets.error },
    quota: ctx.repo.stats(),
    integrations: rows.map((r) => ({ integration: r.integration, status: r.status, lastSuccessAt: r.last_success_at, lastError: r.last_error })).sort((a, b) => a.integration.localeCompare(b.integration)),
    backups: { configured: backupConfigured(ctx) },
    audit: { pending: pendingAudit(ctx.repo), written: auditStats.written, failed: auditStats.failed, dropped: auditStats.dropped, lastError: auditStats.lastError },
  };
}
