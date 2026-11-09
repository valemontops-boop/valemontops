import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe signs webhooks with HMAC-SHA256 of `${timestamp}.${rawBody}` using the endpoint secret (whsec_…),
 * sent as `Stripe-Signature: t=…,v1=…`. Rejects missing/invalid signatures and timestamps older than 5 minutes.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string | null, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest();
  return sigs.some((s) => { const b = Buffer.from(s, "hex"); return b.length === expected.length && timingSafeEqual(b, expected); });
}
