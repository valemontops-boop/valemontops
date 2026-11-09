import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeStripeStore, MemoryStripe } from "@/fake-stripe";
import { mrrOf } from "@/data/bank/stripe";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { moneyOverview, syncStripe } from "@/server/services/bank";
import { commandCenter } from "@/server/services/insights";
import { verifyStripeSignature } from "@/server/stripe-webhook";
import { autoCategory } from "@/domain/bank";
import { freshSheetsRepo } from "../helpers";

let fake: FakeSheetsServer;
let ctx: AppContext;
let store: FakeStripeStore;
beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  store = new FakeStripeStore();
  const now = Math.floor(Date.now() / 1000);
  store.balance = [{ currency: "EUR", amount_minor: 19800 }];
  store.txs = [
    { id: "txn_1", amount: 49000, fee: 760, currency: "EUR", type: "charge", created: now - 5 * 86400, description: "Set-up (test)", reporting_category: "charge" },
    { id: "txn_2", amount: -48240, fee: 0, currency: "EUR", type: "payout", created: now - 3 * 86400, description: "Payout", reporting_category: "payout" },
    { id: "txn_3", amount: 9900, fee: 174, currency: "EUR", type: "charge", created: now - 86400, description: "Monthly (test)", reporting_category: "charge" },
  ];
  store.subs = [
    { id: "s1", customer: "A (test)", status: "active", items: [{ unit_amount: 9900, quantity: 1, interval: "month", interval_count: 1, currency: "EUR" }] },
    { id: "s2", customer: "B (test)", status: "active", items: [{ unit_amount: 118800, quantity: 1, interval: "year", interval_count: 1, currency: "EUR" }] },
  ];
  ctx = { repo: env.repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo", payments: new MemoryStripe(store) };
  await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => fake.stop());

describe("Stripe", () => {
  it("computes MRR from active subscriptions (yearly divided by 12)", () => {
    expect(mrrOf(store.subs)).toBe(9900 + 9900);
  });
  it("imports sales as revenue with their fee, payouts as internal transfers, once, and feeds MRR to the Command Center", async () => {
    const r = await syncStripe(ctx);
    expect(r).toMatchObject({ added: 5, mrr_minor: 19800, subscriptions: 2 }); // 2 charges + 2 fees + 1 payout
    expect((await syncStripe(ctx)).added).toBe(0);
    const rows = (await ctx.repo.list("BankTransactions", { fresh: true })).rows;
    expect(rows.find((x) => x.source_id === "txn_1")).toMatchObject({ bank: "stripe", category: "revenue", amount_minor: 49000 });
    expect(rows.find((x) => x.source_id === "txn_1:fee")).toMatchObject({ category: "bank_fees", amount_minor: -760 });
    expect(rows.find((x) => x.source_id === "txn_2")).toMatchObject({ category: "internal_transfer" });
    const m = await moneyOverview(ctx, "theo");
    expect(m.stripe).toMatchObject({ connected: true, mrr: 19800, subscriptions: 2 });
    expect(m.summary.current.income).toBe(49000 + 9900);
    const cc = await commandCenter(ctx, "theo");
    expect(cc.now.numbers.find((n) => n.key === "mrr")).toMatchObject({ value: 19800 });
  });
  it("does not count a Stripe payout landing in Wise as revenue", () => {
    expect(autoCategory({ direction: "credit", bank_type: "DEPOSIT", description: "Received money from STRIPE PAYMENTS EUROPE", counterparty: "Stripe Payments Europe Ltd", merchant_category: "" })).toBe("internal_transfer");
  });
  it("verifies the Stripe-Signature header (HMAC, timestamp tolerance)", () => {
    const secret = "whsec_test_example";
    const body = JSON.stringify({ type: "charge.succeeded" });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t - 3600},v1=${sig}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, null, secret)).toBe(false);
  });
});
