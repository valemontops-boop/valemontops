import { NextResponse, type NextRequest } from "next/server";
import { RATE, guardInbound } from "@/server/guard";
import { webhookBodySchema } from "@/domain/inbox";
import { verifyHmacSha256 } from "@/server/inbox-webhook";
import { getContext } from "@/server/repo";
import { ingestInboxItems } from "@/server/services/inbox";

/**
 * New comments and messages pushed by a relay (Make, Zapier, n8n, a Meta relay): one normalized item or
 * `{ items: [...] }`. No session: `X-Valemont-Signature: sha256=<HMAC-SHA256 hex of the raw body>` with
 * INBOX_WEBHOOK_SECRET authenticates the caller. Not configured → refused. Idempotent by external_id.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INBOX_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const got = await guardInbound(req, "inbox", { maxBytes: 200_000, rule: RATE.webhook }); // rate limit + streaming size cap (D084)
  if ("refuse" in got) return got.refuse;
  const raw = got.raw;
  if (!verifyHmacSha256(raw, req.headers.get("x-valemont-signature"), secret)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "malformed" }, { status: 400 }); }
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_error", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  try {
    const r = await ingestInboxItems(await getContext(), "items" in parsed.data ? parsed.data.items : [parsed.data]);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "inbox-webhook", message: (e as Error).message }));
    return NextResponse.json({ error: "storage" }, { status: 503 }); // the relay retries
  }
}
