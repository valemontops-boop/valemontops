import type { StripeBalanceTx, StripePort, StripeSub } from "./data/bank/stripe";

/** In-memory Stripe for DEMO and tests (synthetic data only). */
export class FakeStripeStore {
  balance: { currency: string; amount_minor: number }[] = [];
  txs: StripeBalanceTx[] = [];
  subs: StripeSub[] = [];
}
export class MemoryStripe implements StripePort {
  constructor(private readonly s: FakeStripeStore) {}
  async balance() { return structuredClone(this.s.balance); }
  async balanceTransactions(since: number) { return structuredClone(this.s.txs.filter((t) => t.created >= since)); }
  async activeSubscriptions() { return structuredClone(this.s.subs.filter((x) => x.status === "active")); }
}
/** Demo: Local subscriptions at 99 €/month, a 490 € set-up, Stripe fees and payouts to Wise. */
export function demoStripeStore(now = new Date()) {
  const s = new FakeStripeStore();
  const at = (d: number) => Math.floor((now.getTime() - d * 86_400_000) / 1000);
  let n = 0;
  const add = (d: number, amount: number, type: string, description: string) => s.txs.push({ id: `txn_demo_${++n}`, amount, fee: type === "charge" ? Math.round(amount * 0.015) + 25 : 0, currency: "EUR", type, created: at(d), description, reporting_category: type });
  add(40, 49000, "charge", "Set-up Valemont Local · Atelier Exemple (demo)");
  add(38, 9900, "charge", "Valemont Local monthly · Atelier Exemple (demo)");
  add(35, -55000, "payout", "Payout to bank");
  add(20, 9900, "charge", "Valemont Local monthly · Boulangerie Test (demo)");
  add(8, 9900, "charge", "Valemont Local monthly · Atelier Exemple (demo)");
  add(4, 9900, "charge", "Valemont Local monthly · Boulangerie Test (demo)");
  add(2, 9900, "charge", "Valemont Local monthly · Électricité Démo (demo)");
  s.balance = [{ currency: "EUR", amount_minor: 29000 }];
  s.subs = ["Atelier Exemple (demo)", "Boulangerie Test (demo)", "Électricité Démo (demo)"].map((c, i) => ({ id: `sub_demo_${i}`, customer: c, status: "active", items: [{ unit_amount: 9900, quantity: 1, interval: "month", interval_count: 1, currency: "EUR" }] }));
  return s;
}
