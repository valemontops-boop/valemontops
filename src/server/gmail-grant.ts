import { sameAddress } from "./sender";

/** Encrypted httpOnly cookie holding the founder's own gmail.send access token. Never stored server-side, never in Sheets. */
export const GMAIL_COOKIE = "vos_gmail";
/** Send only: the app never reads the founder's inbox (spec 4.15). */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/**
 * D090: the incremental consent also asks `openid email`, so the callback learns WHICH mailbox granted gmail.send
 * (the verified email in the id_token) and refuses any other than the Valemont sending address.
 */
export const GMAIL_SCOPES = [GMAIL_SCOPE, "openid", "email"] as const;

/** What the grant cookie holds: token, founder, and the verified mailbox it belongs to. */
export interface GmailGrant { t?: string; f?: string; e?: string }

export type SenderCheck = { ok: true; email: string } | { ok: false; error: "no_sender" | "no_email" | "unverified" | "wrong_account" };
/** The mailbox that granted gmail.send must be the sending address, with a verified email (id_token claims). */
export function checkGmailSender(claims: { email?: string | null; email_verified?: boolean | string | null } | null | undefined, sender: string): SenderCheck {
  if (!sender.trim()) return { ok: false, error: "no_sender" };
  const email = (claims?.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, error: "no_email" };
  if (claims?.email_verified !== true && claims?.email_verified !== "true") return { ok: false, error: "unverified" };
  if (!sameAddress(email, sender)) return { ok: false, error: "wrong_account" };
  return { ok: true, email };
}

/** The token to send with: only the signed-in founder's own grant, and only while it belongs to the current sending address. */
export function grantToken(grant: GmailGrant | null | undefined, founder: string, sender: string): string | null {
  if (!grant?.t || grant.f !== founder) return null;
  return sameAddress(grant.e, sender) ? grant.t : null;
}
