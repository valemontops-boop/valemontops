import type { BankBalance, BankPort, BankTx } from "../data/bank/wise";

/** In-memory Wise used by DEMO and tests. Synthetic data only. */
export class FakeWiseStore {
  profile = "demo-profile";
  balances: BankBalance[] = [];
  txs: (BankTx & { balanceId: string })[] = [];
  addTx(balanceId: string, t: Omit<BankTx, "running_balance_minor">) {
    const b = this.balances.find((x) => x.id === balanceId)!;
    b.amount_minor += t.amount_minor;
    this.txs.push({ ...t, balanceId, running_balance_minor: b.amount_minor });
  }
  /**
   * D091 tests: synthetic history for `balanceId`, one movement every `everyDays` days from `fromIso` up to `toIso`,
   * alternating a card expense and a client credit (example names only), references `${prefix}-n`.
   */
  addHistory(balanceId: string, fromIso: string, toIso: string, everyDays = 20, prefix = "H") {
    let n = 0;
    for (let t = Date.parse(fromIso); t <= Date.parse(toIso); t += everyDays * 86_400_000, n++) {
      const credit = n % 3 === 0;
      this.addTx(balanceId, {
        referenceNumber: `${prefix}-${n}`, direction: credit ? "credit" : "debit", occurred_at: new Date(t).toISOString(), amount_minor: credit ? 50000 : -(1000 + (n % 7) * 100), currency: "EUR", fee_minor: null,
        description: credit ? `Invoice ${n}` : "Notion Labs", counterparty: credit ? "Client (test)" : "Notion", detailsType: credit ? "DEPOSIT" : "CARD", merchantCategory: credit ? "" : "Computer Software",
      });
    }
    return n;
  }
}
export class MemoryBank implements BankPort {
  constructor(private readonly s: FakeWiseStore) {}
  async profileId() { return this.s.profile; }
  async balances() { return structuredClone(this.s.balances); }
  async statement(_p: string, balanceId: string, _c: string, fromIso: string, toIso: string) {
    return structuredClone(this.s.txs.filter((t) => t.balanceId === balanceId && t.occurred_at >= fromIso && t.occurred_at <= toIso).map((t) => { const { balanceId, ...rest } = t; void balanceId; return rest; }));
  }
}

/**
 * Demo account: a EUR balance with plausible, invented movements (example names only): the last weeks, plus ~2 years
 * of older history (D091) that the first sync (90 days) does not pull and the full-history import does.
 */
export function demoWiseStore(now = new Date()) {
  const s = new FakeWiseStore();
  s.balances.push({ id: "demo-eur", currency: "EUR", amount_minor: 0, name: "" });
  const day = (d: number, h = 10) => new Date(now.getTime() - d * 86_400_000 + h * 3600_000 - now.getUTCHours() * 3600_000).toISOString();
  const rows: [number, number, string, string, string, string][] = [
    [70, 500000, "MONEY_ADDED", "Apport depuis le compte d'un fondateur", "Théo (demo)", ""],
    [64, -2390, "CARD", "Google Workspace", "Google", "Computer Software"],
    [60, 150000, "DEPOSIT", "Facture VC-0001", "Plomberie Duval (demo)", ""],
    [55, -2000, "CARD", "Notion Labs", "Notion", "Computer Software"],
    [41, -15000, "CARD", "Meta ads", "Facebook", "Advertising Services"],
    [38, 10000, "DEPOSIT", "Abonnement VL-0001 mois 1", "Boulangerie Test (demo)", ""],
    [33, -1999, "CARD", "Movistar", "Movistar", "Telecommunication"],
    [28, -6400, "CARD", "Renfe Madrid", "Renfe", "Railroads"],
    [25, 150000, "DEPOSIT", "Facture VC-0002", "Garage du Parc (demo)", ""],
    [21, -2390, "CARD", "Google Workspace", "Google", "Computer Software"],
    // D085: a contractor paid in USD out of the EUR balance (326 $ sent for 300 € debited → real rate 0.920245).
    [12, -30000, "TRANSFER", "Designer freelance (demo)", "Studio Exemple (demo)", ""],
    [9, 10000, "DEPOSIT", "Abonnement VL-0001 mois 2", "Boulangerie Test (demo)", ""],
    [6, -2000, "CARD", "Notion Labs", "Notion", "Computer Software"],
    [3, 10000, "DEPOSIT", "Abonnement VL-0002 mois 1", "Électricité Démo (demo)", ""],
    [1, -120, "ACCRUAL_CHARGE", "Wise fee", "Wise", ""],
  ];
  // D091: older history, oldest first (running balances): a founders' contribution 25 months ago, then monthly tools,
  // a client invoice every other month, ads every third month and a train ticket every fourth.
  const old: [number, number, string, string, string, string][] = [[760, 800000, "MONEY_ADDED", "Apport initial des fondateurs", "Théo (demo)", ""]];
  for (let m = 24; m >= 4; m--) {
    const base = m * 30;
    old.push([base + 18, -2390, "CARD", "Google Workspace", "Google", "Computer Software"]);
    old.push([base + 14, -2000, "CARD", "Notion Labs", "Notion", "Computer Software"]);
    if (m % 2 === 0) old.push([base + 10, 90000 + (m % 5) * 15000, "DEPOSIT", `Facture historique ${25 - m}`, ["Plomberie Duval (demo)", "Garage du Parc (demo)", "Boulangerie Test (demo)"][m % 3], ""]);
    old.push([base + 8, -1999, "CARD", "Movistar", "Movistar", "Telecommunication"]);
    if (m % 3 === 0) old.push([base + 6, -12000, "CARD", "Meta ads", "Facebook", "Advertising Services"]);
    if (m % 4 === 0) old.push([base + 3, -8500, "CARD", "Renfe Madrid", "Renfe", "Railroads"]);
  }
  old.sort((a, b) => b[0] - a[0]).forEach(([d, amount, type, description, counterparty, mc], i) => s.addTx("demo-eur", {
    referenceNumber: `DEMO-H-${1000 + i}`, direction: amount >= 0 ? "credit" : "debit", occurred_at: day(d), amount_minor: amount, currency: "EUR", fee_minor: null,
    description, counterparty, detailsType: type, merchantCategory: mc,
  }));
  rows.forEach(([d, amount, type, description, counterparty, mc], i) => s.addTx("demo-eur", {
    referenceNumber: `DEMO-${1000 + i}`, direction: amount >= 0 ? "credit" : "debit", occurred_at: day(d), amount_minor: amount, currency: "EUR", fee_minor: null,
    description, counterparty, detailsType: type, merchantCategory: mc, ...(type === "TRANSFER" ? { fx_currency: "USD", fx_amount_minor: 32600 } : {}),
  }));
  return s;
}
