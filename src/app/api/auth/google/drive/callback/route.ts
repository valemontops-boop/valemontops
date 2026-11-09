import { NextResponse, type NextRequest } from "next/server";
import { safeBackPath } from "@/server/guard";
import { OAuth2Client } from "google-auth-library";
import { getConfig } from "@/server/config";
import { DRIVE_COOKIE, DRIVE_SCOPE } from "@/server/drive-grant";
import { OAUTH_COOKIE, SESSION_COOKIE, readSessionToken, seal, sessionCookieOptions, unseal } from "@/server/session";

export async function GET(req: NextRequest) {
  const cfg = getConfig();
  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
  const saved = await unseal<{ state?: string; v?: string; back?: string }>(req.cookies.get(OAUTH_COOKIE)?.value, cfg.sessionSecret);
  const back = safeBackPath(saved?.back, "/files");
  const fail = (e: string) => NextResponse.redirect(new URL(`${back}?drive_error=${e}`, req.url));
  if (!cfg.ok || cfg.mode !== "live" || !session) return fail("unavailable");
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!saved?.state || !saved.v || state !== saved.state || !code) return fail("state");
  try {
    const client = new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, `${cfg.baseUrl}/api/auth/google/drive/callback`);
    const { tokens } = await client.getToken({ code, codeVerifier: saved.v });
    if (!tokens.access_token || !(tokens.scope ?? "").includes(DRIVE_SCOPE)) return fail("not_granted");
    const ttl = Math.max(60, Math.floor(((tokens.expiry_date ?? Date.now() + 3_000_000) - Date.now()) / 1000) - 60);
    const res = NextResponse.redirect(new URL(back, req.url));
    res.cookies.delete(OAUTH_COOKIE);
    res.cookies.set(DRIVE_COOKIE, await seal({ t: tokens.access_token, f: session.founder }, cfg.sessionSecret, ttl), sessionCookieOptions(cfg.production, ttl));
    return res;
  } catch {
    return fail("oauth");
  }
}
