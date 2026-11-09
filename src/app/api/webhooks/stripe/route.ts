import { NextResponse, type NextRequest } from "next/server";
import { RATE, guardInbound } from "@/server/guard";
import { getContext } from "@/server/repo";
import { syncStripe } from "@/server/services/bank";
import { verifyStripeSignature } from "@/server/stripe-webhook";

/** Stripe events (charges, payouts, subscriptions, balance): verified, then a read-only sync. No session: the signature authenticates Stripe. */
export async function POST(req: NextRequest) {
  const got = await guardInbound(req, "stripe", { maxBytes: 500_000, rule: RATE.webhook }); // rate limit + streaming size cap (D084)
  if ("refuse" in got) return got.refuse;
  const raw = got.raw;
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
