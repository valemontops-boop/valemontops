import { JOB_TOLERANCE_SEC, verifyJobSignature } from "./job-auth";
import { rateLimiter } from "./rate-limit";
import { WEBSITE_BODY_MAX, looksLikeBot, websiteLeadSchema } from "@/domain/website-lead";
import type { AppContext } from "./context";
import { ingestWebsiteLead } from "./services/website-leads";
import { recordIntegration } from "./services/integration-status";

/** 20 calls per minute per IP: a form handler never needs more; brute-forcing the signature gets nowhere. */
export const websiteLimiter = rateLimiter({ limit: 20, windowMs: 60_000 });

type Result = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

/**
 * POST /api/webhooks/website (Stage 4A, D083). No session: authenticated by
 * `X-Valemont-Timestamp: <unix seconds>` + `X-Valemont-Signature: sha256=<hex HMAC-SHA256(WEBSITE_WEBHOOK_SECRET, "<timestamp>.<raw body>")>`.
 * Order: configured → per-IP rate limit → size cap → timestamp window → signature → JSON → Zod → bot traps → store.
 * Nothing is read from or written to Sheets before the signature is verified.
 */
export async function handleWebsiteWebhook(i: {
  raw: string; contentLength: number | null; timestamp: string | null; signature: string | null; ip: string;
  secret: string | undefined; getCtx: () => Promise<AppContext>; now?: number;
}): Promise<Result> {
  const now = i.now ?? Date.now();
  if (!i.secret) return { status: 503, body: { error: "not_configured" } };
  const rl = websiteLimiter.hit(i.ip, now);
  if (!rl.ok) return { status: 429, body: { error: "rate_limited" }, headers: { "retry-after": String(rl.retryAfterSec) } };
  if ((i.contentLength ?? 0) > WEBSITE_BODY_MAX || i.raw.length > WEBSITE_BODY_MAX) return { status: 413, body: { error: "too_large" } };
  if (!i.timestamp || !/^\d{9,11}$/.test(i.timestamp) || Math.abs(now / 1000 - Number(i.timestamp)) > JOB_TOLERANCE_SEC) return { status: 401, body: { error: "stale_timestamp" } };
  if (!verifyJobSignature(i.raw, i.timestamp, i.signature, i.secret, now)) return { status: 401, body: { error: "bad_signature" } };
  let json: unknown;
  try { json = JSON.parse(i.raw); } catch { return { status: 400, body: { error: "malformed" } }; }
  const parsed = websiteLeadSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "validation_error", issues: parsed.error.issues.map((x) => ({ path: x.path, message: x.message })) } };
  // Bots get the same "accepted" answer as people, so they learn nothing; nothing is stored.
  if (looksLikeBot(parsed.data)) return { status: 202, body: { ok: true, status: "ignored" } };
  let ctx: AppContext | null = null;
  try {
    ctx = await i.getCtx();
    const r = await ingestWebsiteLead(ctx, parsed.data, new Date(now));
    await recordIntegration(ctx.repo, "website", true, "", new Date(now));
    return { status: 200, body: { ok: true, status: r.status } };
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "website-webhook", message: (e as Error)?.message }));
    if (ctx) await recordIntegration(ctx.repo, "website", false, (e as Error)?.message ?? "storage error", new Date(now));
    return { status: 503, body: { error: "storage" } }; // the form handler retries with the same event_id
  }
}
