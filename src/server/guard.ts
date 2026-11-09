import { createHmac } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "./log";
import { clientIp as headerIp, rateLimiter } from "./rate-limit";

/**
 * Request guards shared by route() and the unauthenticated endpoints (webhooks, jobs, feeds, health). Stage 4 (D084).
 * - body size cap enforced while reading (Content-Length first, then a streaming count), never after a full read;
 * - per-client, per-endpoint rate limit (in-process fixed window from rate-limit.ts; per server instance, see SECURITY.md);
 * - client IP kept only as a keyed hash.
 */

export class BodyTooLargeError extends Error {
  readonly code = "too_large";
  constructor(readonly limit: number) {
    super(`Request body larger than ${limit} bytes`);
  }
}

/** Reads the body as UTF-8 text, refusing more than `max` bytes without buffering the excess. */
export async function readCappedText(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLargeError(max);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(max);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString("utf8");
}

/** Client address as the host reports it (Vercel sets x-forwarded-for / x-real-ip). Never stored in clear. */
export function clientIp(req: Request): string {
  return headerIp(req.headers);
}

/** Keyed hash (HMAC-SHA256, 16 hex) so an address can be correlated in the audit log but not read back or brute-forced offline. */
export function ipHash(ip: string, secret = process.env.SESSION_SECRET ?? ""): string {
  return createHmac("sha256", `ip:${secret}`).update(ip).digest("hex").slice(0, 16);
}

/* ---------------- rate limit (the Stage 4A fixed-window limiter, one per endpoint family) ---------------- */

export interface RateRule {
  limit: number;
  windowMs: number;
}
/** Defaults: webhooks 120/min per client (providers burst on retries), jobs 30/min, health 60/min, feeds 60/min. */
export const RATE = {
  webhook: { limit: 120, windowMs: 60_000 },
  job: { limit: 30, windowMs: 60_000 },
  health: { limit: 60, windowMs: 60_000 },
  feed: { limit: 60, windowMs: 60_000 },
} satisfies Record<string, RateRule>;

const g = globalThis as unknown as { __valemontLimiters?: Map<string, ReturnType<typeof rateLimiter>> };
const limiters = () => (g.__valemontLimiters ??= new Map());

/** Returns the seconds to wait when the caller is over the limit for this endpoint, otherwise 0. */
export function rateLimit(name: string, key: string, rule: RateRule, now = Date.now()): number {
  const id = `${name}:${rule.limit}:${rule.windowMs}`;
  let l = limiters().get(id);
  if (!l) limiters().set(id, (l = rateLimiter(rule)));
  const r = l.hit(key, now);
  return r.ok ? 0 : r.retryAfterSec;
}

export function resetRateLimits() {
  for (const l of limiters().values()) l.reset();
}

/**
 * Guard for endpoints authenticated by a signature or token instead of a session (webhooks, jobs, feeds):
 * rate limit by client then body cap. Returns the raw body, or the refusal to send.
 */
export async function guardInbound(req: NextRequest, name: string, opts: { maxBytes: number; rule?: RateRule }): Promise<{ raw: string } | { refuse: NextResponse }> {
  const ip = ipHash(clientIp(req));
  const wait = rateLimit(name, ip, opts.rule ?? RATE.webhook);
  if (wait) {
    logger.warn("rate_limited", { endpoint: name, ip_hash: ip });
    return { refuse: NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(wait) } }) };
  }
  try {
    return { raw: await readCappedText(req, opts.maxBytes) };
  } catch (e) {
    if (e instanceof BodyTooLargeError) return { refuse: NextResponse.json({ error: "too_large" }, { status: 413 }) };
    throw e;
  }
}

/**
 * Same-origin check for mutations (CSRF): a cross-site browser request is refused; a malformed Origin ("null",
 * garbage) is refused instead of crashing. Requests without Origin (server-to-server, old clients) pass: the
 * session cookie is SameSite=Lax, so a cross-site form post never carries it.
 */
export function isCrossOrigin(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    return true;
  }
}

/** A post-login / post-consent return path: same-site relative path only (no `//host`, no `/\host`, no control chars). */
export function safeBackPath(raw: string | null | undefined, fallback: string): string {
  const v = raw ?? "";
  if (!v.startsWith("/") || v.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(v)) return fallback;
  try {
    const u = new URL(v, "https://same.invalid");
    return u.host === "same.invalid" ? `${u.pathname}${u.search}${u.hash}` : fallback;
  } catch {
    return fallback;
  }
}
