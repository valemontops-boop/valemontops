import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getConfig } from "@/server/config";
import { DRIVE_COOKIE, DRIVE_SCOPE } from "@/server/drive-grant";
import { OAUTH_COOKIE, SESSION_COOKIE, readSessionToken, seal, sessionCookieOptions } from "@/server/session";

/**
 * Incremental consent for drive.file, requested only when a founder first uploads (spec 3.6).
 * DEMO: records a simulated grant so the flow can be tried without Google.
 */
export async function GET(req: NextRequest) {
  const cfg = getConfig();
  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
  if (!cfg.ok || !session) return NextResponse.redirect(new URL("/login", req.url));
  const back = req.nextUrl.searchParams.get("back") ?? "/files";
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : "/files";
  if (cfg.mode === "demo") {
    const res = NextResponse.redirect(new URL(safeBack, req.url));
    res.cookies.set(DRIVE_COOKIE, await seal({ t: `demo-grant-${session.founder}`, f: session.founder }, cfg.sessionSecret, 3_600), sessionCookieOptions(cfg.production, 3_600));
    return res;
  }
  const client = new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, `${cfg.baseUrl}/api/auth/google/drive/callback`);
  const state = randomBytes(24).toString("base64url");
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({ scope: [DRIVE_SCOPE], include_granted_scopes: true, state, code_challenge: codeChallenge, code_challenge_method: "S256" as never, access_type: "online", login_hint: cfg.founders[session.founder].email });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, await seal({ state, v: codeVerifier, back: safeBack }, cfg.sessionSecret, 600), sessionCookieOptions(cfg.production, 600));
  return res;
}
