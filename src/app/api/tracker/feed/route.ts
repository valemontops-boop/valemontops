import { NextResponse, type NextRequest } from "next/server";
import { RATE, clientIp, ipHash, rateLimit } from "@/server/guard";
import { ZodError } from "zod";
import { getContext } from "@/server/repo";
import { RuleError } from "@/server/errors";
import { founderForFeedToken } from "@/server/tracker-auth";
import { feedSchema, trackerFeed } from "@/server/services/tracker";

/**
 * Pull feed for the founder's own tracker (docs/TRACKER.md). No session cookie: the bearer token
 * (TRACKER_FEED_TOKEN_<FOUNDER>, env only) authenticates and selects the founder. Read-only.
 */
export async function GET(req: NextRequest) {
  const wait = rateLimit("tracker-feed", ipHash(clientIp(req)), RATE.feed);
  if (wait) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(wait) } });
  const founder = founderForFeedToken(req.headers.get("authorization"));
  if (!founder) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: { "www-authenticate": "Bearer", "cache-control": "no-store" } });
  try {
    const input = feedSchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const ctx = await getContext();
    return NextResponse.json(await trackerFeed(ctx.repo, founder, input), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof ZodError || e instanceof RuleError) return NextResponse.json({ error: "validation_error", message: e instanceof RuleError ? e.message : "Invalid input" }, { status: 400 });
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "tracker-feed", name: (e as Error)?.name }));
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
