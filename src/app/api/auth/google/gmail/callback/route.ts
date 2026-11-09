import { NextResponse, type NextRequest } from "next/server";
import { safeBackPath } from "@/server/guard";
import { OAuth2Client } from "google-auth-library";
import { getConfig } from "@/server/config";
import { getContext } from "@/server/repo";
import { senderAddress } from "@/server/sender";
import { GMAIL_COOKIE, GMAIL_SCOPE, checkGmailSender } from "@/server/gmail-grant";
import { OAUTH_COOKIE, SESSION_COOKIE, readSessionToken, seal, sessionCookieOptions, unseal } from "@/server/session";

/**
 * Stores the gmail.send grant only when it comes from the Valemont sending address (D090): the verified email of the
 * id_token (openid email) must equal the Workspace setting `email_sender_address`. Anything else is refused and the
 * founder is told which address to sign in with.
 */
export async function GET(req: NextRequest) {
  const cfg = getConfig();
  const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
  const saved = await unseal<{ state?: string; v?: string; back?: string }>(req.cookies.get(OAUTH_COOKIE)?.value, cfg.sessionSecret);
  const back = safeBackPath(saved?.back, "/call");
  const sep = back.includes("?") ? "&" : "?";
  const fail = (e: string, sender = "") => {
    const res = NextResponse.redirect(new URL(`${back}${sep}gmail_error=${e}${sender ? `&gmail_sender=${encodeURIComponent(sender)}` : ""}`, req.url));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  if (!cfg.ok || cfg.mode !== "live" || !session) return fail("unavailable");
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  if (!saved?.state || !saved.v || state !== saved.state || !code) return fail("state");
  try {
    const client = new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, `${cfg.baseUrl}/api/auth/google/gmail/callback`);
    const { tokens } = await client.getToken({ code, codeVerifier: saved.v });
    if (!tokens.access_token || !(tokens.scope ?? "").includes(GMAIL_SCOPE)) return fail("not_granted");
    const sender = await senderAddress((await getContext()).repo);
    const claims = tokens.id_token ? (await client.verifyIdToken({ idToken: tokens.id_token, audience: cfg.google.clientId })).getPayload() : null;
    const check = checkGmailSender(claims, sender);
    if (!check.ok) return fail(check.error, sender);
    const ttl = Math.max(60, Math.floor(((tokens.expiry_date ?? Date.now() + 3_000_000) - Date.now()) / 1000) - 60);
    const res = NextResponse.redirect(new URL(back, req.url));
    res.cookies.delete(OAUTH_COOKIE);
    res.cookies.set(GMAIL_COOKIE, await seal({ t: tokens.access_token, f: session.founder, e: check.email }, cfg.sessionSecret, ttl), sessionCookieOptions(cfg.production, ttl));
    return res;
  } catch {
    return fail("oauth");
  }
}
