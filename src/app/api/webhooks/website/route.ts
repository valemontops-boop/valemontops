import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/repo";
import { resolveSecret } from "@/server/connectors";
import { clientIp } from "@/server/rate-limit";
import { handleWebsiteWebhook } from "@/server/website-webhook";
import { WEBSITE_BODY_MAX } from "@/domain/website-lead";

/**
 * Website forms (FR/ES sites: contact, lead, booking) → inbound lead + item to reply to (Stage 4A, D083).
 * Signed with WEBSITE_WEBHOOK_SECRET (see docs/INTEGRATIONS.md "Website forms webhook"). Not configured → 503.
 */
export async function POST(req: NextRequest) {
  const len = Number(req.headers.get("content-length") ?? "") || null;
  // Refuse an announced oversized body before reading it.
  const raw = len !== null && len > WEBSITE_BODY_MAX ? "" : await req.text();
  const r = await handleWebsiteWebhook({
    raw, contentLength: len, timestamp: req.headers.get("x-valemont-timestamp"), signature: req.headers.get("x-valemont-signature"),
    ip: clientIp(req.headers), secret: await resolveSecret("WEBSITE_WEBHOOK_SECRET"), getCtx: getContext,
  });
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store", ...(r.headers ?? {}) } });
}
