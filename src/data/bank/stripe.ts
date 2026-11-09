import { StorageError } from "../repository";

/** Stripe read access (iteration 6): balance, balance transactions, active subscriptions (for MRR). */
export interface StripeBalanceTx { id: string; amount: number; fee: number; currency: string; type: string; created: number; description: string; reporting_category: string }
export interface StripeSub { id: string; customer: string; status: string; items: { unit_amount: number; quantity: number; interval: string; interval_count: number; currency: string }[] }
export interface StripePort {
  balance(): Promise<{ currency: string; amount_minor: number }[]>;
  balanceTransactions(sinceUnix: number): Promise<StripeBalanceTx[]>;
  activeSubscriptions(): Promise<StripeSub[]>;
}

/** Restricted, read-only key (rk_…): Balance, Balance transactions, Subscriptions, Customers = Read. */
export class StripeAdapter implements StripePort {
  constructor(private readonly base: string, private readonly key: string) {}
  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base.replace(/\/$/, "") + path, { headers: { authorization: `Bearer ${this.key}`, "stripe-version": "2024-06-20" }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    } catch {
      throw new StorageError("Stripe is unreachable", undefined, true);
    }
    if (!res.ok) throw new StorageError(`Stripe returned ${res.status}`, res.status, [429, 500, 502, 503, 504].includes(res.status));
    return (await res.json()) as T;
  }
  async balance() {
    const b = await this.get<{ available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] }>("/v1/balance");
    const m = new Map<string, number>();
    for (const x of [...(b.available ?? []), ...(b.pending ?? [])]) m.set(x.currency.toUpperCase(), (m.get(x.currency.toUpperCase()) ?? 0) + x.amount);
    return [...m.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor }));
  }
  async balanceTransactions(sinceUnix: number) {
    const out: StripeBalanceTx[] = [];
    let after = "";
    for (let page = 0; page < 20; page++) {
      const r = await this.get<{ data: (StripeBalanceTx & { description: string | null; reporting_category?: string })[]; has_more: boolean }>(`/v1/balance_transactions?limit=100&created[gte]=${sinceUnix}${after ? `&starting_after=${after}` : ""}`);
      out.push(...r.data.map((x) => ({ id: x.id, amount: x.amount, fee: x.fee ?? 0, currency: x.currency.toUpperCase(), type: x.type, created: x.created, description: x.description ?? "", reporting_category: x.reporting_category ?? "" })));
      if (!r.has_more || !r.data.length) break;
      after = r.data.at(-1)!.id;
    }
    return out;
  }
  async activeSubscriptions() {
    const out: StripeSub[] = [];
    let after = "";
    for (let page = 0; page < 10; page++) {
      type Raw = { id: string; status: string; customer: string | { id: string; name?: string | null; email?: string | null }; items: { data: { quantity?: number; price: { unit_amount: number | null; currency: string; recurring: { interval: string; interval_count: number } | null } }[] } };
      const r = await this.get<{ data: Raw[]; has_more: boolean }>(`/v1/subscriptions?status=active&limit=100&expand[]=data.customer${after ? `&starting_after=${after}` : ""}`);
      out.push(...r.data.map((s) => ({
        id: s.id, status: s.status, customer: typeof s.customer === "string" ? s.customer : s.customer.name || s.customer.id,
        items: s.items.data.filter((i) => i.price.recurring).map((i) => ({ unit_amount: i.price.unit_amount ?? 0, quantity: i.quantity ?? 1, interval: i.price.recurring!.interval, interval_count: i.price.recurring!.interval_count || 1, currency: i.price.currency.toUpperCase() })),
      })));
      if (!r.has_more || !r.data.length) break;
      after = r.data.at(-1)!.id;
    }
    return out;
  }
}

/** Monthly recurring revenue in one currency, from active subscriptions (yearly / 12, weekly × 52 / 12, daily × 365 / 12). */
export function mrrOf(subs: StripeSub[], currency = "EUR") {
  const perMonth = { month: 1, year: 1 / 12, week: 52 / 12, day: 365 / 12 } as Record<string, number>;
  let total = 0;
  for (const s of subs.filter((x) => x.status === "active"))
    for (const i of s.items.filter((x) => x.currency === currency)) total += (i.unit_amount * i.quantity * (perMonth[i.interval] ?? 0)) / (i.interval_count || 1);
  return Math.round(total);
}
