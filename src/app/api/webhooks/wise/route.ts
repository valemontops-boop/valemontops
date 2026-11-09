import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/repo";
import { applyWiseEvent, wiseEventSchema } from "@/server/services/bank";
import { verifyWiseSignature } from "@/server/wise-webhook";

/**
 * Live bank movements: Wise calls this URL for `balances#update`. No session (Wise is the caller): the RSA
 * signature is the authentication. Invalid or unsigned bodies are refused; test pings are acknowledged.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 100_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const pem = process.env.WISE_WEBHOOK_PUBLIC_KEY_BASE64 ? Buffer.from(process.env.WISE_WEBHOOK_PUBLIC_KEY_BASE64, "base64").toString("utf8") : null;
  if (!verifyWiseSignature(raw, req.headers.get("x-signature-sha256"), pem)) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  if (req.headers.get("x-test-notification") === "true") return NextResponse.json({ ok: true });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "malformed" }, { status: 400 }); }
  const ev = wiseEventSchema.safeParse(body);
  if (!ev.success) return NextResponse.json({ ok: true, ignored: true }); // other event types: acknowledged, nothing stored
  try {
    const ctx = await getContext();
    const r = await applyWiseEvent(ctx, ev.data);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "wise-webhook", message: (e as Error).message }));
    return NextResponse.json({ error: "storage" }, { status: 503 }); // Wise retries
  }
}
