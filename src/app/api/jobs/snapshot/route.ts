import { NextResponse, type NextRequest } from "next/server";
import { RATE, guardInbound } from "@/server/guard";
import { verifyJobBearer, verifyJobSignature } from "@/server/job-auth";
import { getContext } from "@/server/repo";
import { runSnapshot } from "@/server/services/snapshot";

/**
 * The audience snapshot job (spec 4.11), called every 6 hours by an external scheduler (Apps Script trigger,
 * GitHub Actions, host cron). Signed with SNAPSHOT_JOB_SECRET (timestamp + HMAC) or a bearer SNAPSHOT_JOB_TOKEN.
 * Idempotent per capture slot: a repeat returns "skipped". docs/INTEGRATIONS.md › Instagram.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SNAPSHOT_JOB_SECRET;
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` on a GET (D084, docs/DEPLOYMENT.md).
  const tokens = [process.env.SNAPSHOT_JOB_TOKEN, process.env.CRON_SECRET].filter((t): t is string => Boolean(t));
  if (!secret && !tokens.length) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const got = await guardInbound(req, "job-snapshot", { maxBytes: 10_000, rule: RATE.job }); // rate limit + streaming size cap (D084)
  if ("refuse" in got) return got.refuse;
  const raw = got.raw;
  const signed = verifyJobSignature(raw, req.headers.get("x-valemont-timestamp"), req.headers.get("x-valemont-signature"), secret);
  if (!signed && !tokens.some((t) => verifyJobBearer(req.headers.get("authorization"), t))) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  try {
    const ctx = await getContext();
    if (ctx.mode !== "live") return NextResponse.json({ error: "demo_mode", message: "DEMO never reads a real account." }, { status: 409 });
    const r = await runSnapshot(ctx, { trigger: "scheduler" });
    return NextResponse.json(r, { status: r.status === "error" ? 502 : 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "snapshot-job", name: (e as Error)?.name, message: (e as Error)?.message }));
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/** Vercel Cron calls GET with the CRON_SECRET bearer; same checks as POST. */
export const GET = POST;
