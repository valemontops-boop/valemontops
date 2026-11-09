import { NextResponse, type NextRequest } from "next/server";
import { safeBackPath } from "@/server/guard";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { getConfig } from "@/server/config";
import { getContext } from "@/server/repo";
import { senderAddress } from "@/server/sender";
import { GMAIL_COOKIE, GMAIL_SCOPES } from "@/server/gmail-grant";
import { OAUTH_COOKIE, SESSION_COOKIE, readSessionToken, seal, sessionCookieOptions } from "@/server/session";

/**
 * Incremental consent for gmail.send (+ openid email, D090), requested only when a founder connects the mailbox.
 * Google is asked for the Valemont sending address (login_hint); the callback refuses any other mailbox.
 * DEMO: records a simulated grant for the sending address so the flow can be tried without Google.
 */
export async function GET(req: NextRequest) {
  const cfg = getConfig();
  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
  if (!cfg.ok || !session) return NextResponse.redirect(new URL("/login", req.url));
  const back = req.nextUrl.searchParams.get("back") ?? "/call";
  const safeBack = safeBackPath(back, "/call"); // "/\\evil.example" was an open redirect (D084)
  const sender = await senderAddress((await getContext()).repo);
  if (cfg.mode === "demo") {
    const res = NextResponse.redirect(new URL(safeBack, req.url));
    res.cookies.set(GMAIL_COOKIE, await seal({ t: `demo-gmail-${session.founder}`, f: session.founder, e: sender }, cfg.sessionSecret, 3_600), sessionCookieOptions(cfg.production, 3_600));
    return res;
  }
  if (!sender) return NextResponse.redirect(new URL(`${safeBack}${safeBack.includes("?") ? "&" : "?"}gmail_error=no_sender`, req.url));
  const client = new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, `${cfg.baseUrl}/api/auth/google/gmail/callback`);
  const state = randomBytes(24).toString("base64url");
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({ scope: [...GMAIL_SCOPES], include_granted_scopes: true, state, code_challenge: codeChallenge, code_challenge_method: "S256" as never, access_type: "online", login_hint: sender, prompt: "select_account" });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, await seal({ state, v: codeVerifier, back: safeBack }, cfg.sessionSecret, 600), sessionCookieOptions(cfg.production, 600));
  return res;
}
