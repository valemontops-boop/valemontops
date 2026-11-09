import { NextResponse, type NextRequest } from "next/server";
import { RATE, clientIp, ipHash, rateLimit } from "@/server/guard";
import { getConfig } from "@/server/config";
import { getContext } from "@/server/repo";
import { readiness } from "@/server/services/health";

/**
 * GET /api/health (D084), unauthenticated and minimal: no secret, no address, no business data.
 * `?probe=live` → liveness only (the process answers; nothing else is touched).
 * Otherwise readiness: configuration valid + Google Sheets reachable (cheap call, cached 30 s) + integrations in error.
 * 200 when ready, 503 when not.
 */
export async function GET(req: NextRequest) {
  const headers = { "cache-control": "no-store", "x-request-id": req.headers.get("x-request-id") ?? "" };
  const wait = rateLimit("health", ipHash(clientIp(req)), RATE.health);
  if (wait) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "retry-after": String(wait) } });
  const at = new Date().toISOString();
  if (req.nextUrl.searchParams.get("probe") === "live") return NextResponse.json({ status: "ok", at }, { headers });
  const cfg = getConfig();
  if (!cfg.ok) return NextResponse.json({ status: "fail", checks: { process: "ok", config: "fail", sheets: "skipped" }, at }, { status: 503, headers });
  try {
    const r = await readiness(await getContext());
    return NextResponse.json({ status: r.ready ? (r.integrations.error ? "degraded" : "ok") : "fail", checks: r.checks, integrations: r.integrations, at }, { status: r.ready ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ status: "fail", checks: { process: "ok", config: "ok", sheets: "fail" }, at }, { status: 503, headers });
  }
}
