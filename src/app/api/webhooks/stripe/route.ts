import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/repo";
import { syncStripe } from "@/server/services/bank";
import { verifyStripeSignature } from "@/server/stripe-webhook";

/** Stripe events (charges, payouts, subscriptions, balance): verified, then a read-only sync. No session: the signature authenticates Stripe. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 500_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET ?? null)) return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  let type = "";
  try { type = String((JSON.parse(raw) as { type?: string }).type ?? ""); } catch { return NextResponse.json({ error: "malformed" }, { status: 400 }); }
  if (!/^(charge|payout|customer\.subscription|invoice|balance|refund|payment_intent)\./.test(type)) return NextResponse.json({ received: true, ignored: true });
  try {
    const r = await syncStripe(await getContext());
    return NextResponse.json({ received: true, added: r.added });
  } catch (e) {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "stripe-webhook", message: (e as Error).message }));
    return NextResponse.json({ error: "storage" }, { status: 503 }); // Stripe retries
  }
}
