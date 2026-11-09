/**
 * Simple fixed-window rate limit kept in this server's memory (Stage 4A): an abuse brake for public webhooks, not a
 * durable counter. Several server instances each keep their own window; a restart resets it. Bounded in size.
 */
export function rateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }) {
  const hits = new Map<string, { start: number; count: number }>();
  const maxKeys = opts.maxKeys ?? 5_000;
  return {
    hit(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
      let w = hits.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        if (!w && hits.size >= maxKeys) {
          for (const [k, v] of hits) if (now - v.start >= opts.windowMs) hits.delete(k);
          if (hits.size >= maxKeys) hits.delete(hits.keys().next().value as string);
        }
        w = { start: now, count: 0 };
        hits.set(key, w);
      }
      w.count += 1;
      return w.count <= opts.limit ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + opts.windowMs - now) / 1000)) };
    },
    reset() { hits.clear(); },
  };
}

/** Caller IP from the platform's proxy headers (first X-Forwarded-For hop), "unknown" otherwise. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}
