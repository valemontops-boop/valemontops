import "server-only";
import { InMemoryRepository } from "@/data/memory";
import type { DataRepository } from "@/data/repository";
import { decodeServiceAccountKey, serviceAccountTokenProvider } from "@/data/sheets/auth";
import { SheetsClient } from "@/data/sheets/client";
import { GoogleSheetsRepository } from "@/data/sheets/repository";
import { setupSpreadsheet } from "@/data/sheets/setup";
import { getConfig, type AppConfig } from "./config";
import { seedBaseline } from "./services/baseline";
import { seedDemo } from "./services/demo-seed";
import type { AppContext } from "./context";
import { GoogleHttp } from "@/data/google/http";
import { GoogleCalendarAdapter, GoogleDriveAdapter, GoogleDriveUploader } from "@/data/google/adapters";
import { MemoryCalendar, MemoryDrive, MemoryDriveUploader } from "@/fake-google/store";
import { demoGoogleStore } from "./services/demo-google";
import { seedDemoWork } from "./services/demo-seed";

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
      return repo;
    }
    const client = new SheetsClient({ baseUrl: cfg.demo.fakeUrl, spreadsheetId: cfg.demo.fakeSpreadsheetId, getToken: async () => "fake-demo-token" });
    await setupSpreadsheet(client);
    const repo = new GoogleSheetsRepository(client);
    await seedBaseline(repo, tz);
    await seedDemo(repo);
    return repo;
  }
  // LIVE: never seeds demo data and never creates the spreadsheet; setup:sheets prepares it.
  const key = decodeServiceAccountKey(cfg.sheets.serviceAccountB64);
  const client = new SheetsClient({ baseUrl: cfg.sheets.baseUrl, spreadsheetId: cfg.sheets.spreadsheetId, getToken: serviceAccountTokenProvider(key) });
  return new GoogleSheetsRepository(client);
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
    return {
      repo,
      privateRepo,
      calendar: new MemoryCalendar(store),
      drive: new MemoryDrive(store),
      uploaderFor: (f, grant) => (grant ? new MemoryDriveUploader(store, f) : null),
      baseUrl: cfg.baseUrl,
      mode: "demo",
    };
  }
  const key = decodeServiceAccountKey(cfg.sheets.serviceAccountB64);
  const privateIds: Record<string, string> = { theo: process.env.PRIVATE_SHEET_ID_THEO ?? "", pablo: process.env.PRIVATE_SHEET_ID_PABLO ?? "" };
  const privates = new Map<string, DataRepository>();
  const sheetsToken = serviceAccountTokenProvider(key);
  const googleToken = serviceAccountTokenProvider(key, GOOGLE_SCOPES);
  const api = (process.env.GOOGLE_API_BASE_URL || "https://www.googleapis.com").replace(/\/$/, "");
  return {
    repo,
    privateRepo: (f) => {
      if (!privateIds[f]) return null;
      if (!privates.has(f)) privates.set(f, new GoogleSheetsRepository(new SheetsClient({ baseUrl: cfg.sheets.baseUrl, spreadsheetId: privateIds[f], getToken: sheetsToken })));
      return privates.get(f)!;
    },
    calendar: new GoogleCalendarAdapter(new GoogleHttp(api, googleToken)),
    drive: new GoogleDriveAdapter(new GoogleHttp(api, googleToken)),
    uploaderFor: (_f, grant) => (grant ? new GoogleDriveUploader(new GoogleHttp(api, async () => grant)) : null),
    baseUrl: cfg.baseUrl,
    mode: "live",
  };
}

/** Process-wide service context (repositories + Google ports). */
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
  return g.__valemontCtx.ctx;
}
