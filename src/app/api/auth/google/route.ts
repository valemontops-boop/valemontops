import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getConfig } from "@/server/config";
import { OAUTH_COOKIE, seal, sessionCookieOptions } from "@/server/session";

/** Starts Google sign-in with PKCE. Requests only openid email profile (spec 3.6). */
export async function GET(req: NextRequest) {
  const cfg = getConfig();
  if (!cfg.ok) return NextResponse.redirect(new URL("/setup", req.url));
  if (cfg.mode !== "live") return NextResponse.redirect(new URL("/login?error=live_only", req.url));
  const client = new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, `${cfg.baseUrl}/api/auth/google/callback`);
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = randomBytes(24).toString("base64url");
  const url = client.generateAuthUrl({
    scope: ["openid", "email", "profile"],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256" as never,
    prompt: "select_account",
    access_type: "online",
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, await seal({ state, v: codeVerifier }, cfg.sessionSecret, 600), sessionCookieOptions(cfg.production, 600));
  return res;
}
