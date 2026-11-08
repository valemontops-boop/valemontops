import { NextResponse, type NextRequest } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { getConfig } from "@/server/config";
import { founderForEmail } from "@/server/auth";
import { OAUTH_COOKIE, SESSION_COOKIE, createSessionToken, sessionCookieOptions, unseal } from "@/server/session";

export async function GET(req: NextRequest) {
  const cfg = getConfig();
  const fail = (e: string) => {
    const r = NextResponse.redirect(new URL(`/login?error=${e}`, req.url));
    r.cookies.delete(OAUTH_COOKIE);
    return r;
  };
  if (!cfg.ok || cfg.mode !== "live") return fail("live_only");
  const saved = await unseal<{ state?: string; v?: string }>(req.cookies.get(OAUTH_COOKIE)?.value, cfg.sessionSecret);
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!saved?.state || !saved.v || !state || state !== saved.state || !code) return fail("oauth_state");
  try {
    const client = new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, `${cfg.baseUrl}/api/auth/google/callback`);
    const { tokens } = await client.getToken({ code, codeVerifier: saved.v });
    if (!tokens.id_token) return fail("oauth_failed");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: cfg.google.clientId });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) return fail("email_unverified");
    const founder = founderForEmail(cfg, p.email);
    if (!founder) return fail("not_allowed");
    const res = NextResponse.redirect(new URL("/my-day", req.url));
    res.cookies.delete(OAUTH_COOKIE);
    res.cookies.set(SESSION_COOKIE, await createSessionToken({ founder, role: "founder", mode: "live" }, cfg.sessionSecret), sessionCookieOptions(cfg.production));
    return res;
  } catch {
    return fail("oauth_failed");
  }
}
