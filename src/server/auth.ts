import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FounderKey } from "@/domain/constants";
import { getConfig, type AppConfig } from "./config";
import { SESSION_COOKIE, readSessionToken, type Session } from "./session";

/** Allowlist: exactly the two configured founder addresses (spec 3.6). */
export function founderForEmail(cfg: AppConfig, emailAddr: string): FounderKey | null {
  const e = emailAddr.trim().toLowerCase();
  if (!e) return null;
  if (cfg.founders.theo.email && e === cfg.founders.theo.email) return "theo";
  if (cfg.founders.pablo.email && e === cfg.founders.pablo.email) return "pablo";
  return null;
}

export async function getSession(): Promise<Session | null> {
  const cfg = getConfig();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSessionToken(token, cfg.sessionSecret, cfg.mode);
}

/** For server components: redirects to setup or login. */
export async function requireSessionOrRedirect(): Promise<Session> {
  // Touch the request first: config must be evaluated at request time, never during prerender
  // (otherwise a build without env vars bakes a /setup redirect into the static shell).
  const jar = await cookies();
  const cfg = getConfig();
  if (!cfg.ok) redirect("/setup");
  const s = await readSessionToken(jar.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
  if (!s) redirect("/login");
  return s;
}
