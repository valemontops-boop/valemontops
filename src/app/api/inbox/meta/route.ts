import { NextResponse, type NextRequest } from "next/server";
import { metaToItems } from "@/domain/inbox";
import { metaChallenge, verifyHmacSha256 } from "@/server/inbox-webhook";
import { getContext } from "@/server/repo";
import { ingestInboxItems, instagramLabels } from "@/server/services/inbox";

/** Meta subscription check: echoes hub.challenge when hub.verify_token equals META_VERIFY_TOKEN. */
export async function GET(req: NextRequest) {
  const challenge = metaChallenge(req.nextUrl.searchParams, process.env.META_VERIFY_TOKEN);
  return challenge === null ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/**
 * Instagram webhook (fields `comments` and `messages`): verified with X-Hub-Signature-256 (HMAC-SHA256 of the
 * raw body with META_APP_SECRET), turned into "to reply" items. Nothing is ever answered automatically.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 500_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!verifyHmacSha256(raw, req.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "malformed" }, { status: 400 }); }
  try {
    const ctx = await getContext();
    const items = metaToItems(body, await instagramLabels(ctx));
    const r = items.length ? await ingestInboxItems(ctx, items) : { added: 0, duplicates: 0 };
    return NextResponse.json({ ok: true, ...r }); // other objects/fields: acknowledged, nothing stored
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "meta-webhook", message: (e as Error).message }));
    return NextResponse.json({ error: "storage" }, { status: 503 });
  }
}
