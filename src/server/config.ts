import "server-only";
import { z } from "zod";
import { decodeServiceAccountKey } from "@/data/sheets/auth";
import { isValidTimeZone } from "@/domain/time";

export type AppMode = "demo" | "live";

export interface AppConfig {
  mode: AppMode | null;
  ok: boolean;
  errors: string[]; // human-readable, never contain secret values
  production: boolean;
  baseUrl: string;
  sessionSecret: string;
  pollSeconds: number;
  founders: { theo: { email: string; timezone: string }; pablo: { email: string; timezone: string } };
  google: { clientId: string; clientSecret: string };
  sheets: { spreadsheetId: string; baseUrl: string; serviceAccountB64: string; isGoogle: boolean };
  demo: { backend: "memory" | "fake-sheets"; fakeUrl: string; fakeSpreadsheetId: string; accessCode: string };
}

const GOOGLE_SHEETS = "https://sheets.googleapis.com";
const email = z.string().trim().toLowerCase().email();

export function readConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const errors: string[] = [];
  const production = env.NODE_ENV === "production";
  const rawMode = (env.APP_MODE ?? "").trim().toLowerCase();
  const mode: AppMode | null = rawMode === "demo" || rawMode === "live" ? rawMode : null;
  if (!mode) errors.push("APP_MODE must be set to 'live' or 'demo'.");

  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) errors.push("SESSION_SECRET must be at least 32 characters (generate with: openssl rand -base64 48).");

  const tzTheo = env.FOUNDER_THEO_TIMEZONE || "Europe/Paris";
  const tzPablo = env.FOUNDER_PABLO_TIMEZONE || "Europe/Madrid";
  for (const [k, v] of [["FOUNDER_THEO_TIMEZONE", tzTheo], ["FOUNDER_PABLO_TIMEZONE", tzPablo]] as const) {
    if (!isValidTimeZone(v)) errors.push(`${k} is not a valid IANA time zone.`);
  }

  const sheetsBase = (env.SHEETS_API_BASE_URL || GOOGLE_SHEETS).replace(/\/$/, "");
  const cfg: AppConfig = {
    mode,
    ok: false,
    errors,
    production,
    baseUrl: (env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
    sessionSecret,
    pollSeconds: Math.min(60, Math.max(30, Number(env.SYNC_POLL_SECONDS) || 30)),
    founders: {
      theo: { email: (env.FOUNDER_THEO_EMAIL ?? "").trim().toLowerCase(), timezone: tzTheo },
      pablo: { email: (env.FOUNDER_PABLO_EMAIL ?? "").trim().toLowerCase(), timezone: tzPablo },
    },
    google: { clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? "", clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? "" },
    sheets: {
      spreadsheetId: env.SHEETS_SPREADSHEET_ID ?? "",
      baseUrl: sheetsBase,
      serviceAccountB64: env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 ?? "",
      isGoogle: sheetsBase === GOOGLE_SHEETS,
    },
    demo: {
      backend: env.DEMO_BACKEND === "fake-sheets" ? "fake-sheets" : "memory",
      fakeUrl: (env.FAKE_SHEETS_URL || "http://127.0.0.1:4010").replace(/\/$/, ""),
      fakeSpreadsheetId: env.FAKE_SHEETS_SPREADSHEET_ID || "demo-spreadsheet",
      accessCode: env.DEMO_ACCESS_CODE ?? "",
    },
  };

  if (mode === "live") {
    for (const k of ["FOUNDER_THEO_EMAIL", "FOUNDER_PABLO_EMAIL"] as const) {
      if (!email.safeParse(env[k] ?? "").success) errors.push(`${k} must be the founder's Google sign-in address.`);
    }
    if (cfg.founders.theo.email && cfg.founders.theo.email === cfg.founders.pablo.email) {
      errors.push("FOUNDER_THEO_EMAIL and FOUNDER_PABLO_EMAIL must be different.");
    }
    if (!cfg.google.clientId) errors.push("GOOGLE_OAUTH_CLIENT_ID is missing (Google Cloud > APIs & Services > Credentials).");
    if (!cfg.google.clientSecret) errors.push("GOOGLE_OAUTH_CLIENT_SECRET is missing.");
    if (!cfg.sheets.spreadsheetId) errors.push("SHEETS_SPREADSHEET_ID is missing (the id in the URL of the Sheet you created).");
    if (!cfg.sheets.serviceAccountB64) {
      errors.push("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is missing (base64 of the service account JSON key).");
    } else {
      try {
        decodeServiceAccountKey(cfg.sheets.serviceAccountB64);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (!env.APP_BASE_URL) errors.push("APP_BASE_URL is missing (used for the Google sign-in redirect).");
    if (production && !cfg.sheets.isGoogle) errors.push("SHEETS_API_BASE_URL must not point to a fake server in production.");
  }
  if (mode === "demo" && production && cfg.demo.accessCode.length < 12) {
    errors.push("A production DEMO deployment requires DEMO_ACCESS_CODE (12+ characters).");
  }
  cfg.ok = errors.length === 0;
  return cfg;
}

let cached: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!cached || process.env.NODE_ENV === "test") cached = readConfig();
  return cached;
}

/** Safe subset for the browser. */
export function publicConfig(cfg = getConfig()): PublicConfig {
  return {
    mode: cfg.mode,
    pollSeconds: cfg.pollSeconds,
    backend:
      cfg.mode === "live"
        ? cfg.sheets.isGoogle
          ? "google-sheets"
          : "fake-sheets"
        : cfg.demo.backend === "fake-sheets"
          ? "fake-sheets"
          : "memory",
  };
}
export interface PublicConfig {
  mode: AppMode | null;
  pollSeconds: number;
  /** "browser" is used only by the static review preview (preview/), never by the server. */
  backend: "google-sheets" | "fake-sheets" | "memory" | "browser";
}
