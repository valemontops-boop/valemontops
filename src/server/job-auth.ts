import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Authentication of POST /api/jobs/snapshot (spec 4.11): no session cookie, env secrets only.
 * - Signed (preferred): `X-Valemont-Timestamp: <unix seconds>` and `X-Valemont-Signature: sha256=<hex HMAC-SHA256 of
 *   "<timestamp>.<raw body>">` with SNAPSHOT_JOB_SECRET; the timestamp must be within 5 minutes (replay window).
 * - Bearer (schedulers that cannot sign): `Authorization: Bearer <SNAPSHOT_JOB_TOKEN>`, 24+ characters.
 * Nothing configured → every call is refused.
 */
export const JOB_TOLERANCE_SEC = 300;

const eq = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function verifyJobSignature(raw: string, ts: string | null, sig: string | null, secret: string | null | undefined, nowMs = Date.now()): boolean {
  if (!secret || !ts || !sig || !/^\d{9,11}$/.test(ts)) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > JOB_TOLERANCE_SEC) return false;
  const hex = sig.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  return eq(Buffer.from(hex, "hex"), createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest());
}

export function verifyJobBearer(header: string | null, token: string | null | undefined): boolean {
  if (!token || token.length < 24 || !header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return Boolean(m) && eq(Buffer.from(m![1]), Buffer.from(token));
}

export function signJob(raw: string, secret: string, nowMs = Date.now()) {
  const ts = String(Math.floor(nowMs / 1000));
  return { ts, sig: `sha256=${createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest("hex")}` };
}
