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
}
export class MemoryBank implements BankPort {
  constructor(private readonly s: FakeWiseStore) {}
  async profileId() { return this.s.profile; }
  async balances() { return structuredClone(this.s.balances); }
  async statement(_p: string, balanceId: string, _c: string, fromIso: string, toIso: string) {
    return structuredClone(this.s.txs.filter((t) => t.balanceId === balanceId && t.occurred_at >= fromIso && t.occurred_at <= toIso).map((t) => { const { balanceId, ...rest } = t; void balanceId; return rest; }));
  }
}

/** Demo account: a EUR balance with a few weeks of plausible, invented movements (example names only). */
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
    [12, -30000, "TRANSFER", "Designer freelance (demo)", "Studio Exemple (demo)", ""],
    [9, 10000, "DEPOSIT", "Abonnement VL-0001 mois 2", "Boulangerie Test (demo)", ""],
    [6, -2000, "CARD", "Notion Labs", "Notion", "Computer Software"],
    [3, 10000, "DEPOSIT", "Abonnement VL-0002 mois 1", "Électricité Démo (demo)", ""],
    [1, -120, "ACCRUAL_CHARGE", "Wise fee", "Wise", ""],
  ];
  rows.forEach(([d, amount, type, description, counterparty, mc], i) => s.addTx("demo-eur", {
    referenceNumber: `DEMO-${1000 + i}`, direction: amount >= 0 ? "credit" : "debit", occurred_at: day(d), amount_minor: amount, currency: "EUR", fee_minor: null,
    description, counterparty, detailsType: type, merchantCategory: mc,
  }));
  return s;
}
