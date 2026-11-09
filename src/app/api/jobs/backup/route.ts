import { NextResponse, type NextRequest } from "next/server";
import { RATE, guardInbound } from "@/server/guard";
import { verifyJobBearer, verifyJobSignature } from "@/server/job-auth";
import { logger } from "@/server/log";
import { getContext } from "@/server/repo";
import { resolveSecret } from "@/server/connectors";
import { runBackup } from "@/server/services/backups";

/**
 * Daily backup for an external scheduler (Vercel Cron, GitHub Actions, Apps Script), D084. No session: signed with
 * BACKUP_JOB_SECRET (X-Valemont-Timestamp + X-Valemont-Signature, 5-minute window) or `Authorization: Bearer
 * <BACKUP_JOB_TOKEN>` (24+ characters; Vercel Cron sends `Bearer <CRON_SECRET>`, so CRON_SECRET is accepted too).
 * Nothing configured → refused. Idempotent per day: a repeat answers "skipped".
 */
async function handle(req: NextRequest) {
  // Env first, then the value saved in the app (D087); CRON_SECRET is Vercel's own and stays env-only.
  const secret = await resolveSecret("BACKUP_JOB_SECRET");
  const tokens = [await resolveSecret("BACKUP_JOB_TOKEN"), process.env.CRON_SECRET].filter((t): t is string => Boolean(t));
  if (!secret && !tokens.length) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const got = await guardInbound(req, "job-backup", { maxBytes: 10_000, rule: RATE.job });
  if ("refuse" in got) return got.refuse;
  const signed = verifyJobSignature(got.raw, req.headers.get("x-valemont-timestamp"), req.headers.get("x-valemont-signature"), secret);
  if (!signed && !tokens.some((t) => verifyJobBearer(req.headers.get("authorization"), t))) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  try {
    const ctx = await getContext();
    if (ctx.mode !== "live") return NextResponse.json({ error: "demo_mode", message: "DEMO never copies a real spreadsheet." }, { status: 409 });
    const r = await runBackup(ctx, { trigger: "scheduler" });
    const status = r.status === "error" ? 502 : r.status === "not_configured" ? 503 : 200;
    return NextResponse.json(r, { status, headers: { "cache-control": "no-store" } });
  } catch (e) {
    logger.error("backup_job", { error: e as Error });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export const POST = handle;
/** Vercel Cron calls GET. */
export const GET = handle;
