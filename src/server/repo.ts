import "server-only";
import { InMemoryRepository } from "@/data/memory";
import type { DataRepository } from "@/data/repository";
import { decodeServiceAccountKey, serviceAccountTokenProvider } from "@/data/sheets/auth";
import { SheetsClient } from "@/data/sheets/client";
import { GoogleSheetsRepository } from "@/data/sheets/repository";
import { setupSpreadsheet } from "@/data/sheets/setup";
import { getConfig, type AppConfig } from "./config";
import { applySettingsFromEnv, seedBaseline } from "./services/baseline";
import { seedDemo } from "./services/demo-seed";
import { seedDemoLinkedIn } from "./services/demo-linkedin";
import { seedDemoContent } from "./services/demo-content";
import type { AppContext } from "./context";
import { GoogleHttp } from "@/data/google/http";
import { GmailSender, GoogleCalendarAdapter, GoogleDriveAdapter, GoogleDriveUploader } from "@/data/google/adapters";
import { MemoryBank, demoWiseStore } from "@/fake-wise/store";
import { stripeFromEnv, wiseFromEnv } from "./connector-ports";
import { instagramFromEnv } from "@/data/instagram/graph";
import { MemoryStripe, demoStripeStore } from "@/fake-stripe";
import { MemoryCalendar, MemoryDrive, MemoryDriveUploader, MemoryMailer } from "@/fake-google/store";
import { demoGoogleStore } from "./services/demo-google";
import { seedDemoWork } from "./services/demo-seed";
import { setActivitySink } from "./activity-hooks";
import { trackerSink } from "./services/tracker";
import { backupSettingsFromEnv, type BackupEnv } from "./services/backups";
import { GoogleBackupDrive } from "@/data/google/backup-drive";
import { connectorEnvSync } from "./connector-env";
import { refreshConnectorEnv } from "./services/vault";

type Env = Record<string, string | undefined>;
/** LIVE: how to rebuild the connector ports when an in-app value changes (D087), and the values they were built with. */
const rebuilders = new WeakMap<AppContext, { sig: string; build: (env: Env) => Partial<AppContext> }>();
const PORT_VARS = ["WISE_API_TOKEN", "WISE_API_BASE_URL", "WISE_PROFILE_ID", "WISE_SCA_PRIVATE_KEY_BASE64", "STRIPE_API_KEY", "STRIPE_API_BASE_URL", "INSTAGRAM_API_BASE_URL", "INSTAGRAM_ACCOUNTS_JSON", "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID", "INSTAGRAM_ACCOUNT_KEY", "INSTAGRAM_TOKEN_EXPIRES_AT", "BACKUP_DRIVE_FOLDER_ID", "BACKUP_RETENTION_DAYS"];
const portSig = (env: Env) => PORT_VARS.map((k) => env[k] ?? "").join("\u0000");

export class SetupRequiredError extends Error {
  readonly code = "setup_required";
  constructor(readonly errors: string[]) {
    super("Setup required: " + errors.join(" "));
  }
}

const g = globalThis as unknown as { __valemontRepo?: { key: string; repo: Promise<DataRepository> }; __valemontCtx?: { key: string; ctx: Promise<AppContext> } };

function keyOf(cfg: AppConfig) {
  return [cfg.mode, cfg.demo.backend, cfg.demo.fakeUrl, cfg.sheets.spreadsheetId, cfg.sheets.baseUrl].join("|");
}

async function build(cfg: AppConfig): Promise<DataRepository> {
  const tz = { theo: cfg.founders.theo.timezone, pablo: cfg.founders.pablo.timezone };
  if (cfg.mode === "demo") {
    if (cfg.demo.backend === "memory") {
      const repo = new InMemoryRepository();
      await seedBaseline(repo, tz);
      await seedDemo(repo);
      await seedDemoLinkedIn(repo);
      await seedDemoContent(repo);
      return repo;
    }
    const client = new SheetsClient({ baseUrl: cfg.demo.fakeUrl, spreadsheetId: cfg.demo.fakeSpreadsheetId, getToken: async () => "fake-demo-token" });
    await setupSpreadsheet(client);
    const repo = new GoogleSheetsRepository(client);
    await seedBaseline(repo, tz);
    await seedDemo(repo);
    await seedDemoLinkedIn(repo);
    await seedDemoContent(repo);
    return repo;
  }
  // LIVE: never seeds demo data and never creates the spreadsheet; setup:sheets prepares it.
  const key = decodeServiceAccountKey(cfg.sheets.serviceAccountB64);
  const client = new SheetsClient({ baseUrl: cfg.sheets.baseUrl, spreadsheetId: cfg.sheets.spreadsheetId, getToken: sheetsTokenFor(cfg, key) });
  const repo = new GoogleSheetsRepository(client);
  // Best effort, once per server start: setup values given in the hosting environment (never blocks, never overwrites).
  void applySettingsFromEnv(repo).catch(() => undefined);
  return repo;
}

/**
 * Service-account token for the Sheets API. A LIVE server pointed at the local fake Sheets server (tests, local
 * rehearsal; refused in production by readConfig) gets a fixed token, as scripts/_client.ts does.
 */
export function sheetsTokenFor(cfg: AppConfig, key: ReturnType<typeof decodeServiceAccountKey>): () => Promise<string> {
  return cfg.sheets.isGoogle ? serviceAccountTokenProvider(key) : async () => "fake-token";
}

/** The process-wide repository. LIVE with missing credentials throws SetupRequiredError: never a DEMO fallback. */
export async function getRepo(): Promise<DataRepository> {
  const cfg = getConfig();
  if (!cfg.ok || !cfg.mode) throw new SetupRequiredError(cfg.errors);
  const key = keyOf(cfg);
  if (!g.__valemontRepo || g.__valemontRepo.key !== key) {
    const repo = build(cfg);
    g.__valemontRepo = { key, repo };
    repo.catch(() => {
      if (g.__valemontRepo?.repo === repo) g.__valemontRepo = undefined;
    });
  }
  return g.__valemontRepo.repo;
}

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/drive.readonly",
];

async function buildContext(cfg: AppConfig): Promise<AppContext> {
  const repo = await getRepo();
  if (cfg.mode === "demo") {
    const store = demoGoogleStore();
    const privates = new Map<string, DataRepository>();
    const privateRepo = (f: string) => {
      if (!privates.has(f)) {
        if (cfg.demo.backend === "memory") privates.set(f, new InMemoryRepository());
        else {
          const c = new SheetsClient({ baseUrl: cfg.demo.fakeUrl, spreadsheetId: `${cfg.demo.fakeSpreadsheetId}-private-${f}`, getToken: async () => "fake-demo-token" });
          privates.set(f, new GoogleSheetsRepository(c));
        }
      }
      return privates.get(f)!;
    };
    if (cfg.demo.backend === "fake-sheets") {
      for (const f of ["theo", "pablo"]) {
        await setupSpreadsheet(new SheetsClient({ baseUrl: cfg.demo.fakeUrl, spreadsheetId: `${cfg.demo.fakeSpreadsheetId}-private-${f}`, getToken: async () => "fake-demo-token" }), "private");
      }
    }
    await seedDemoWork(repo, privateRepo);
    setActivitySink(null); // DEMO never sends anything to a founder's tracker
    return {
      repo,
      privateRepo,
      calendar: new MemoryCalendar(store),
      drive: new MemoryDrive(store),
      uploaderFor: (f, grant) => (grant ? new MemoryDriveUploader(store, f) : null),
      mailerFor: (f, grant) => (grant ? new MemoryMailer(store, f) : null),
      bank: new MemoryBank(demoWiseStore()),
      payments: new MemoryStripe(demoStripeStore()),
      baseUrl: cfg.baseUrl,
      mode: "demo",
    };
  }
  setActivitySink(trackerSink()); // founder trackers (TRACKER_WEBHOOK_URL_*), no-op when not configured
  const key = decodeServiceAccountKey(cfg.sheets.serviceAccountB64);
  const privateIds: Record<string, string> = { theo: process.env.PRIVATE_SHEET_ID_THEO ?? "", pablo: process.env.PRIVATE_SHEET_ID_PABLO ?? "" };
  const privates = new Map<string, DataRepository>();
  const sheetsToken = sheetsTokenFor(cfg, key);
  const googleToken = serviceAccountTokenProvider(key, GOOGLE_SCOPES);
  const api = (process.env.GOOGLE_API_BASE_URL || "https://www.googleapis.com").replace(/\/$/, "");
  // Connector ports from the environment first, then the in-app values (D087); rebuilt by getContext() on change.
  const ports = (env: Env): Partial<AppContext> => ({
    bank: wiseFromEnv(env),
    payments: stripeFromEnv(env),
    // Instagram Graph (read-only) only in LIVE with credentials; otherwise manual entry (D079).
    instagram: instagramFromEnv(env),
    backup: backupFromEnv(cfg, (id) => new SheetsClient({ baseUrl: cfg.sheets.baseUrl, spreadsheetId: id, getToken: sheetsToken }), new GoogleHttp(api, serviceAccountTokenProvider(key, BACKUP_SCOPES), { maxRetries: 2 }), env),
  });
  const env0 = connectorEnvSync();
  const ctx: AppContext = {
    repo,
    privateRepo: (f) => {
      if (!privateIds[f]) return null;
      if (!privates.has(f)) privates.set(f, new GoogleSheetsRepository(new SheetsClient({ baseUrl: cfg.sheets.baseUrl, spreadsheetId: privateIds[f], getToken: sheetsToken })));
      return privates.get(f)!;
    },
    calendar: new GoogleCalendarAdapter(new GoogleHttp(api, googleToken)),
    drive: new GoogleDriveAdapter(new GoogleHttp(api, googleToken)),
    uploaderFor: (_f, grant) => (grant ? new GoogleDriveUploader(new GoogleHttp(api, async () => grant)) : null),
    mailerFor: (_f, grant) => (grant ? new GmailSender(new GoogleHttp(api, async () => grant)) : null),
    ...ports(env0),
    baseUrl: cfg.baseUrl,
    mode: "live",
  };
  rebuilders.set(ctx, { sig: portSig(env0), build: ports });
  return ctx;
}

/**
 * Process-wide service context (repositories + Google ports). Each call also refreshes the connector values saved in
 * the app (cached CONNECTOR_TTL_MS, D087) and, in LIVE, rebuilds the Wise / Stripe / Instagram / backup ports when
 * one of their values changed. Environment variables always win.
 */
export async function getContext(): Promise<AppContext> {
  const cfg = getConfig();
  if (!cfg.ok || !cfg.mode) throw new SetupRequiredError(cfg.errors);
  const k = keyOf(cfg);
  if (!g.__valemontCtx || g.__valemontCtx.key !== k) {
    const ctx = buildContext(cfg);
    g.__valemontCtx = { key: k, ctx };
    ctx.catch(() => {
      if (g.__valemontCtx?.ctx === ctx) g.__valemontCtx = undefined;
    });
  }
  const ctx = await g.__valemontCtx.ctx;
  await refreshConnectorEnv(ctx); // never throws: a vault problem leaves the environment-only behaviour
  const r = rebuilders.get(ctx);
  if (r) {
    const env = connectorEnvSync();
    const sig = portSig(env);
    if (sig !== r.sig) {
      Object.assign(ctx, r.build(env));
      r.sig = sig;
    }
  }
  return ctx;
}

/** Backups (D084): the service account copies the live Sheet into BACKUP_DRIVE_FOLDER_ID (shared with it as Editor). */
const BACKUP_SCOPES = ["https://www.googleapis.com/auth/drive"];
function backupFromEnv(cfg: AppConfig, clientFor: (id: string) => SheetsClient, http: GoogleHttp, env: Env): BackupEnv {
  const s = backupSettingsFromEnv(env);
  return { sourceId: cfg.sheets.spreadsheetId, clientFor, drive: s.folderId ? new GoogleBackupDrive(http) : null, folderId: s.folderId, retentionDays: s.retentionDays };
}


