import { z } from "zod";
import { decodeServiceAccountKey } from "@/data/sheets/auth";
import { isValidTimeZone } from "@/domain/time";
import { vercelBaseUrl } from "./config";

/**
 * D086: the few variables a LIVE deployment needs before anyone can sign in, for the public /setup page and the
 * Vercel Deploy button. Only states leave this module (set / missing / invalid / automatic / default), never a value.
 */
export type VarState = "set" | "missing" | "invalid" | "auto" | "default";
export interface BootstrapVar {
  name: BootstrapName;
  state: VarState;
  /** Needed before sign-in in LIVE (timezones and APP_BASE_URL on Vercel have defaults). */
  required: boolean;
  /** English dictionary key explaining why a set value is refused (never the value). */
  problem?: string;
}

export const BOOTSTRAP_NAMES = [
  "APP_MODE",
  "SESSION_SECRET",
  "APP_BASE_URL",
  "FOUNDER_THEO_EMAIL",
  "FOUNDER_PABLO_EMAIL",
  "FOUNDER_THEO_TIMEZONE",
  "FOUNDER_PABLO_TIMEZONE",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "SHEETS_SPREADSHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64",
] as const;
export type BootstrapName = (typeof BOOTSTRAP_NAMES)[number];

const email = z.string().trim().toLowerCase().email();

export function bootstrapStatus(env: Record<string, string | undefined> = process.env): BootstrapVar[] {
  const v = (k: string) => (env[k] ?? "").trim();
  const out: BootstrapVar[] = [];
  const push = (name: BootstrapName, state: VarState, required: boolean, problem?: string) => out.push(problem ? { name, state, required, problem } : { name, state, required });

  const mode = v("APP_MODE").toLowerCase();
  push("APP_MODE", !mode ? "missing" : mode === "live" || mode === "demo" ? "set" : "invalid", true, mode && mode !== "live" && mode !== "demo" ? "Must be exactly live." : undefined);

  const secret = env.SESSION_SECRET ?? "";
  push("SESSION_SECRET", !secret ? "missing" : secret.length >= 32 ? "set" : "invalid", true, secret && secret.length < 32 ? "Too short: at least 32 characters. Use “Generate a secret”." : undefined);

  const base = v("APP_BASE_URL");
  if (base) {
    let ok = false;
    try {
      const u = new URL(base);
      ok = (u.protocol === "https:" || u.hostname === "localhost") && (u.pathname === "/" || u.pathname === "") && !base.endsWith("/");
    } catch {
      ok = false;
    }
    push("APP_BASE_URL", ok ? "set" : "invalid", true, ok ? undefined : "Must be the address only, starting with https:// and without a slash at the end.");
  } else push("APP_BASE_URL", vercelBaseUrl(env) ? "auto" : "missing", !vercelBaseUrl(env));

  const theo = v("FOUNDER_THEO_EMAIL").toLowerCase();
  const pablo = v("FOUNDER_PABLO_EMAIL").toLowerCase();
  for (const [name, val] of [["FOUNDER_THEO_EMAIL", theo], ["FOUNDER_PABLO_EMAIL", pablo]] as const) {
    if (!val) push(name, "missing", true);
    else if (!email.safeParse(val).success) push(name, "invalid", true, "Not a valid email address.");
    else if (theo === pablo) push(name, "invalid", true, "The two founder addresses must be different.");
    else push(name, "set", true);
  }

  for (const name of ["FOUNDER_THEO_TIMEZONE", "FOUNDER_PABLO_TIMEZONE"] as const) {
    const tz = v(name);
    push(name, !tz ? "default" : isValidTimeZone(tz) ? "set" : "invalid", false, tz && !isValidTimeZone(tz) ? "Not a valid time zone (example: Europe/Paris)." : undefined);
  }

  for (const name of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] as const) push(name, v(name) ? "set" : "missing", true);

  const sheet = v("SHEETS_SPREADSHEET_ID");
  push("SHEETS_SPREADSHEET_ID", !sheet ? "missing" : /[/:\s]/.test(sheet) ? "invalid" : "set", true, sheet && /[/:\s]/.test(sheet) ? "Only the id: the part of the Sheet's address between /d/ and /edit." : undefined);

  const key = v("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64");
  let keyOk = false;
  if (key) {
    try {
      decodeServiceAccountKey(key);
      keyOk = true;
    } catch {
      keyOk = false;
    }
  }
  push("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64", !key ? "missing" : keyOk ? "set" : "invalid", true, key && !keyOk ? "Not a service account key: paste the whole JSON key file (or its base64)." : undefined);
  return out;
}

/** Origin of the current request (proposed APP_BASE_URL and the exact OAuth redirect URI to register). */
export function requestOrigin(h: { get(name: string): string | null }): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return "";
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto === "http" ? "http" : "https"}://${host}`;
}
