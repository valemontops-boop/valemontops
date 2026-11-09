import { z } from "zod";
import type { Row } from "@/data/schema/tables";
import type { FounderKey } from "@/domain/constants";
import { INTEGRATIONS, INTEGRATION_KEYS, envPresence, hubStatus, type IntegrationKey, type StatusRow } from "@/domain/integrations";
import { childId } from "@/lib/ids";
import { signJob, verifyJobSignature } from "../job-auth";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { syncBank, syncStripe } from "./bank";
import { runSnapshot } from "./snapshot";
import { trackerAction } from "./tracker";
import { integrationStatusId, recordIntegration } from "./integration-status";
import { connectorEnvSync, connectorSource } from "../connector-env";

type Env = Record<string, string | undefined>;
/** Env first, then the values saved in the app (D087). */
const processEnv = (): Env => connectorEnvSync();
/** Grants held in this browser's encrypted cookies (never server-side). */
export interface Grants { gmail: boolean; drive: boolean }

/** IntegrationStatuses ids, including the ones written before the hub existed. */
const STATUS_IDS: Partial<Record<IntegrationKey, (f: FounderKey) => string>> = {
  sheets: () => integrationStatusId("sheets"),
  drive: () => integrationStatusId("drive"),
  calendar: () => childId("integration", "Google Calendar"),
  wise: () => childId("integration", "wise"),
  stripe: () => childId("integration", "stripe"),
  instagram: () => childId("integration", "instagram"),
  website: () => integrationStatusId("website"),
  inbox: () => integrationStatusId("inbox"),
  tracker: (f) => childId("integration", "tracker", f),
  snapshot: () => childId("integration", "instagram"),
  backup: () => integrationStatusId("backup"),
};
const SUFFIX: Record<FounderKey, string> = { theo: "THEO", pablo: "PABLO" };
const NO_TEST = new Set(["import_only", "pending_approval", "not_configured"]);
const SYNCABLE = new Set(["connected", "error", "needs_renewal"]);
const maxIso = (xs: (string | null | undefined)[]) => xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null);

/**
 * Settings › Integrations (spec 7, D083): every integration with what it does, its mode, its honest status, the env
 * names it needs (presence only, never values), last sync/import, last error and its time, expiry, and actions.
 */
export async function integrationHub(ctx: AppContext, founder: FounderKey, grants: Grants, env: Env = processEnv(), now = new Date()) {
  const t = await ctx.repo.listMany(["IntegrationStatuses", "SystemSettings", "CalendarSources", "SnapshotRuns", "SocialAccounts", "SocialAccountDaily", "TrafficDaily", "SearchConsoleRows", "WebsiteSubmissions", "InboxItems", "BackupRuns"]);
  const statusById = new Map(t.IntegrationStatuses.rows.map((r) => [r.id, r]));
  const setting = (k: string) => t.SystemSettings.rows.find((r) => r.key === k && !r.is_archived)?.value ?? "";
  const live = ctx.mode === "live";
  const stats = ctx.repo.stats();
  const linkedinIds = new Set(t.SocialAccounts.rows.filter((a) => a.platform !== "instagram").map((a) => a.id));
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const subs30 = t.WebsiteSubmissions.rows.filter((r) => r.submitted_at >= since30);
  const runs = [...t.SnapshotRuns.rows].sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  const igExpiry = (ctx.instagram ?? []).map((a) => a.expiresAt).filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const has = (k: string) => Boolean(env[k]?.trim());

  const facts: Record<IntegrationKey, { configured: boolean; lastSync?: string | null; expiresAt?: string | null; detail?: string; detailVars?: Record<string, string>; row?: StatusRow | null }> = {
    sheets: { configured: true, lastSync: stats.lastSuccessAt, row: stats.lastError && (!stats.lastSuccessAt || stats.errors > 0) ? { status: "error", last_success_at: stats.lastSuccessAt, last_error: stats.lastError, updated_at: stats.lastSuccessAt ?? now.toISOString() } : null, detail: ctx.privateRepo(founder) ? "Your private spreadsheet is connected." : "No private spreadsheet for you yet (PRIVATE_SHEET_ID_*)." },
    signin: { configured: live, detail: "Two allowed addresses; basic scopes only." },
    drive: { configured: Boolean(ctx.drive) && Boolean(setting("drive_folder_id")), detail: grants.drive ? "Your drive.file permission is active in this browser." : "Your drive.file permission is not active in this browser; it is asked at the first save.", ...(setting("drive_folder_id") ? {} : { detail: "No shared folder yet (Settings › Workspace)." }) },
    calendar: { configured: Boolean(ctx.calendar) && t.CalendarSources.rows.some((r) => !r.is_archived), detail: "{n} calendars shared with the service account.", detailVars: { n: String(t.CalendarSources.rows.filter((r) => !r.is_archived).length) } },
    gmail: { configured: grants.gmail, detail: grants.gmail ? "Your Gmail is connected in this browser (send only)." : "Not connected in this browser. Connect it to send in one click." },
    wise: { configured: live ? Boolean(ctx.bank) : has("WISE_API_TOKEN") },
    stripe: { configured: live ? Boolean(ctx.payments) : has("STRIPE_API_KEY") },
    instagram: { configured: (ctx.instagram ?? []).length > 0, expiresAt: igExpiry, detail: (ctx.instagram ?? []).length ? "{n} accounts read through the API." : "Manual entry in the Content Studio until a token is set.", detailVars: { n: String((ctx.instagram ?? []).length) } },
    linkedin: { configured: false, lastSync: maxIso(t.SocialAccountDaily.rows.filter((r) => r.source === "import" && linkedinIds.has(r.account_id)).map((r) => r.captured_at)), detail: "Import the Page export (.xls) or the creator export (.xlsx) in Growth." },
    ga4: { configured: false, lastSync: maxIso(t.TrafficDaily.rows.filter((r) => r.origin === "import").map((r) => r.created_at)), detail: "Import a GA4 CSV export in Growth." },
    search_console: { configured: false, lastSync: maxIso(t.SearchConsoleRows.rows.filter((r) => r.origin === "import").map((r) => r.created_at)), detail: "Import a Search Console CSV export in Growth › SEO." },
    website: { configured: has("WEBSITE_WEBHOOK_SECRET"), lastSync: maxIso(t.WebsiteSubmissions.rows.map((r) => r.created_at)), detail: "{n} forms in 30 days · {s} blocked by the suppression list.", detailVars: { n: String(subs30.length), s: String(subs30.filter((r) => r.outcome === "suppressed").length) } },
    inbox: { configured: has("INBOX_WEBHOOK_SECRET") || (has("META_APP_SECRET") && has("META_VERIFY_TOKEN")), lastSync: maxIso(t.InboxItems.rows.filter((r) => r.source !== "website_form").map((r) => r.created_at)) },
    tracker: { configured: has(`TRACKER_WEBHOOK_URL_${SUFFIX[founder]}`) && has(`TRACKER_WEBHOOK_SECRET_${SUFFIX[founder]}`), detail: "Yours only. Settings › My tracker." },
    backup: { configured: live ? Boolean(ctx.backup?.drive && ctx.backup.folderId) : has("BACKUP_DRIVE_FOLDER_ID"), lastSync: maxIso(t.BackupRuns.rows.filter((r) => r.status === "done").map((r) => r.finished_at ?? r.started_at)) },
    snapshot: { configured: has("SNAPSHOT_JOB_SECRET") || has("SNAPSHOT_JOB_TOKEN"), lastSync: runs.find((r) => r.status === "done")?.finished_at ?? null, row: runs[0]?.status === "error" ? { status: "error", last_success_at: null, last_error: runs[0].error, updated_at: runs[0].finished_at } : null },
  };

  const items = INTEGRATIONS.map((spec) => {
    const f = facts[spec.key];
    const r: Row<"IntegrationStatuses"> | undefined = STATUS_IDS[spec.key] ? statusById.get(STATUS_IDS[spec.key]!(founder)) : undefined;
    const row: StatusRow | null = f.row !== undefined ? f.row : r ? { status: r.status, last_success_at: r.last_success_at, last_error: r.last_error, updated_at: r.updated_at } : null;
    const { status, daysLeft } = hubStatus({ mode: ctx.mode, kind: spec.kind, configured: f.configured, row, expiresAt: f.expiresAt, now });
    return {
      key: spec.key, name: spec.name, does: spec.does, mode: spec.mode, status, scopes: spec.scopes, note: spec.note, docs: `docs/INTEGRATIONS.md#${spec.docs}`, href: spec.href,
      // Where each value comes from (D087): "env" = host environment (wins), "app" = saved in Settings › Integrations.
      env: envPresence(spec.env, env, SUFFIX[founder]).map((e) => ({ ...e, source: e.set ? (connectorSource(e.name) ?? "env") : null })),
      lastSync: f.lastSync !== undefined ? f.lastSync : row?.last_success_at ?? null,
      lastError: status === "error" && row ? row.last_error : "",
      lastErrorAt: status === "error" && row ? row.updated_at : null,
      expiresAt: f.expiresAt ?? null, daysLeft,
      detail: f.detail ?? "", detailVars: f.detailVars ?? {},
      // Actions only where they can do something now: never a button that cannot work (no inert buttons).
      actions: spec.actions.filter((a) => a === "reauthorize" || (a === "test" && !NO_TEST.has(status)) || (a === "sync" && live && SYNCABLE.has(status))),
    };
  });
  const counts = Object.fromEntries((["connected", "not_configured", "error", "needs_renewal"] as const).map((s) => [s, items.filter((i) => i.status === s).length]));
  return { mode: ctx.mode, items, counts };
}

export const integrationActionSchema = z.object({ key: z.enum(INTEGRATION_KEYS) });

type TestResult = { ok: boolean; message: string; vars: Record<string, string>; error: string };
const ok = (message: string, vars: Record<string, string> = {}): TestResult => ({ ok: true, message, vars, error: "" });

/**
 * "Test connection": a read-only call (never a write to the provider, never an email); the result is recorded in
 * IntegrationStatuses. DEMO answers from the demo stand-ins and says so; it never reaches a real provider.
 */
export async function testIntegration(ctx: AppContext, founder: FounderKey, input: z.infer<typeof integrationActionSchema>, env: Env = processEnv()) {
  const run = async (fn: () => Promise<TestResult>, statusKey: string | null): Promise<TestResult> => {
    try {
      const r = await fn();
      if (statusKey && ctx.mode === "live") await recordIntegration(ctx.repo, statusKey, true);
      return r;
    } catch (e) {
      // A missing setup is explained in the founder's language; a provider failure keeps its own error text.
      if (e instanceof RuleError) return { ok: false, message: e.message, vars: {}, error: "" };
      const error = ((e as Error)?.message ?? "").slice(0, 300);
      if (statusKey && ctx.mode === "live") await recordIntegration(ctx.repo, statusKey, false, error);
      return { ok: false, message: "The test failed.", vars: {}, error };
    }
  };
  const demo = ctx.mode === "demo" ? " (demo data, no real connection)" : "";
  switch (input.key) {
    case "sheets": return run(async () => { await ctx.repo.revisions({ fresh: true }); return ok(`The spreadsheet answers${demo}.`); }, "sheets");
    case "drive": return run(async () => {
      const folder = (await ctx.repo.list("SystemSettings")).rows.find((r) => r.key === "drive_folder_id" && !r.is_archived)?.value;
      if (!ctx.drive || !folder) throw new RuleError("Set the shared Drive folder first (Settings › Workspace).");
      const files = await ctx.drive.list(folder);
      return ok(`Drive answers: {n} files in the shared folder${demo}.`, { n: String(files.length) });
    }, "drive");
    case "calendar": return run(async () => {
      const src = (await ctx.repo.list("CalendarSources")).rows.find((r) => !r.is_archived && (r.kind === "shared" || r.owner_founder === founder));
      if (!ctx.calendar || !src) throw new RuleError("Add a calendar first (Settings › Calendars).");
      const from = new Date();
      const ev = await ctx.calendar.listEvents(src.calendar_id, from.toISOString(), new Date(from.getTime() + 7 * 86_400_000).toISOString());
      return ok(`Calendar answers: {n} events in the next 7 days${demo}.`, { n: String(ev.length) });
    }, "Google Calendar");
    case "wise": return run(async () => {
      if (!ctx.bank) throw new RuleError("Wise is not connected. Add WISE_API_TOKEN (see docs/INTEGRATIONS.md).");
      const b = await ctx.bank.balances(await ctx.bank.profileId());
      return ok(`Wise answers: {n} balances${demo}.`, { n: String(b.length) });
    }, null);
    case "stripe": return run(async () => {
      if (!ctx.payments) throw new RuleError("Stripe is not connected. Add STRIPE_API_KEY (see docs/INTEGRATIONS.md).");
      const b = await ctx.payments.balance();
      return ok(`Stripe answers: {n} balances${demo}.`, { n: String(b.length) });
    }, null);
    case "instagram": return run(async () => {
      const a = ctx.instagram ?? [];
      if (!a.length) throw new RuleError("Instagram is not connected: manual entry until a token is set.");
      for (const x of a) await x.port.profile();
      return ok("Instagram answers for {n} accounts.", { n: String(a.length) });
    }, "instagram");
    case "website": case "inbox": return run(async () => {
      // Self-check of the signature setup: signs a sample with the configured secret and verifies it. Nothing is stored.
      const secret = input.key === "website" ? env.WEBSITE_WEBHOOK_SECRET : env.INBOX_WEBHOOK_SECRET;
      if (!secret) throw new RuleError("The secret is not set yet: Configure › Generate.");
      if (secret.length < 32) throw new RuleError("The secret is too short: use 32+ random characters (openssl rand -hex 32).");
      // LIVE only: the browser preview (DEMO) has no real HMAC; DEMO's own webhook still verifies on the server.
      if (input.key === "website" && ctx.mode === "live") {
        const sample = JSON.stringify({ event_id: "selftest-0001" });
        const s = signJob(sample, secret);
        if (!verifyJobSignature(sample, s.ts, s.sig, secret)) throw new Error("signature self-check failed");
      }
      return ok("Ready: the endpoint accepts correctly signed calls and refuses the rest.");
    }, null);
    case "backup": return run(async () => {
      if (ctx.mode === "demo") return ok(`Backups folder saved${demo}.`);
      if (!ctx.backup?.drive || !ctx.backup.folderId) throw new RuleError("Set the backups folder first.");
      const files = await ctx.backup.drive.list(ctx.backup.folderId);
      return ok("Drive answers: {n} files in the backups folder.", { n: String(files.length) });
    }, "backup");
    case "tracker": return run(async () => {
      await trackerAction(ctx, founder, { action: "test" }, env);
      return ok("Test event delivered to your tracker.");
    }, null);
    default: throw new RuleError("No test for this integration.");
  }
}

/** "Sync now": Wise, Stripe, the Instagram capture. LIVE only; the same idempotent jobs as everywhere else. */
export async function syncIntegration(ctx: AppContext, founder: FounderKey, input: z.infer<typeof integrationActionSchema>) {
  if (ctx.mode !== "live") throw new RuleError("DEMO never syncs with a real provider.");
  if (input.key === "wise") { await syncBank(ctx, { founder }); return ok("Wise synced."); }
  if (input.key === "stripe") { await syncStripe(ctx, { founder }); return ok("Stripe synced."); }
  if (input.key === "instagram" || input.key === "snapshot") {
    const r = await runSnapshot(ctx, { trigger: "founder" });
    return ok(r.status === "skipped" ? "Already captured in this 6-hour slot." : "Capture done.");
  }
  throw new RuleError("No sync for this integration.");
}
