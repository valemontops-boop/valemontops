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

export class SetupRequiredError extends Error {
  readonly code = "setup_required";
  constructor(readonly errors: string[]) {
    super("Setup required: " + errors.join(" "));
  }
}

const g = globalThis as unknown as { __valemontRepo?: { key: string; repo: Promise<DataRepository> } };

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
