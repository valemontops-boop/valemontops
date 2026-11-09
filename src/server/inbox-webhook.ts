import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 of the raw body, hex, sent as `sha256=<hex>` (or bare hex). Used for our own inbox webhook
 * (`X-Valemont-Signature`, secret INBOX_WEBHOOK_SECRET) and for Meta (`X-Hub-Signature-256`, secret META_APP_SECRET).
 * No secret configured → always refused. Constant-time comparison.
 */
export function verifyHmacSha256(rawBody: string, header: string | null, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const hex = header.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const got = Buffer.from(hex, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Meta webhook subscription check (GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…): the challenge, or null. */
export function metaChallenge(params: URLSearchParams, verifyToken: string | null | undefined): string | null {
  if (!verifyToken) return null;
  const a = Buffer.from(params.get("hub.verify_token") ?? "");
  const b = Buffer.from(verifyToken);
  if (params.get("hub.mode") !== "subscribe" || a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return params.get("hub.challenge");
}
