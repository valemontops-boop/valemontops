/**
 * Managerial finance (spec 5.10, D078): pure, tested functions. This is management accounting, not statutory
 * bookkeeping: revenue is recognized by service period or revenue schedule, cash by recorded payments; quotes,
 * acceptance and weighted pipeline never enter either. Amounts are integer minor units (cents).
 */
import { NEUTRAL, type BankCategory } from "./bank";
import { COST_CENTERS, type CostCenter, type CostClass } from "./finance-constants";
export { COST_CENTERS, COST_CENTER_LABELS, COST_CLASSES, COST_CLASS_LABELS, type CostCenter, type CostClass } from "./finance-constants";

/** Default P&L class of a category (a founder can override direct vs operating per movement). */
export function defaultClass(category: BankCategory): CostClass {
  if (NEUTRAL.includes(category)) return "neutral";
  if (category === "revenue" || category === "refund") return "revenue";
  // Interest, cashback and other non-operating income stay outside EBITDA; taxes and VAT too.
  if (category === "other_income" || category === "taxes" || category === "vat") return "excluded";
  if (category === "contractors" || category === "api_tokens") return "direct";
  return "opex";
}

/* ---------------- months and periods ---------------- */
export const monthOf = (day: string) => day.slice(0, 7);
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  return out;
}
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let i = 0; i < 600; i++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const monthEnd = lastDay;
/** First day of the payment month → last day of the month `months − 1` later (a monthly subscription paid in a month covers that month). */
export function billingPeriod(date: string, months: number): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number);
  const endMonth = new Date(Date.UTC(y, m - 1 + Math.max(1, months) - 1, 1)).toISOString().slice(0, 7);
  return { from: `${date.slice(0, 7)}-01`, to: lastDay(endMonth) };
}

/**
 * Splits an amount over a service period by days, per month. Integer cents; the sum is exact (the remainder goes to
 * the months with the largest fractional parts).
 */
export function allocateByDays(amount: number, from: string, to: string): Map<string, number> {
  const out = new Map<string, number>();
  if (to < from) [from, to] = [to, from];
  const total = dayNum(to) - dayNum(from) + 1;
  const parts: { month: string; days: number }[] = [];
  for (const month of monthsBetween(from, to)) {
    const s = Math.max(dayNum(`${month}-01`), dayNum(from));
    const e = Math.min(dayNum(lastDay(month)), dayNum(to));
    if (e >= s) parts.push({ month, days: e - s + 1 });
  }
  const sign = Math.sign(amount), abs = Math.abs(amount);
  const raw = parts.map((p) => ({ ...p, exact: (abs * p.days) / total }));
  const floors = raw.map((r) => Math.floor(r.exact));
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r.exact - floors[i] })).sort((a, b) => b.frac - a.frac || b.i - a.i);
  for (const o of order) { if (rest <= 0) break; floors[o.i]++; rest--; }
  raw.forEach((r, i) => { if (floors[i]) out.set(r.month, sign * floors[i]); });
  return out;
}

/* ---------------- normalized ledger ---------------- */
export interface FinItem {
  id: string;
  source: "bank" | "manual";
  date: string;
  label: string;
  counterparty: string;
  category: BankCategory;
  cost_center: CostCenter;
  cls: CostClass;
  /** Original currency, signed (credit +, debit −), VAT included (cash). */
  currency: string;
  gross_minor: number;
  vat_minor: number;
  /** EUR amounts (cash and ex VAT); null for a movement in another currency: "hors EUR, non converti" (D082, never converted). */
  eur_gross: number | null;
  eur_net: number | null;
  eur_vat: number | null;
  service_from: string | null;
  service_to: string | null;
  contract_id: string;
  project_id: string;
  receipt_url: string;
  reference: string;
  reconciled: boolean;
}
export interface ContractLite {
  id: string; client_id: string; name: string; cost_center: CostCenter; kind: "subscription" | "one_off"; currency: string;
  setup_minor: number; one_off_minor: number; recurring_minor: number; billing_months: number; start_date: string; end_date: string | null;
  status: "active" | "paused" | "ended";
}
export interface ScheduleLine {
  id: string; contract_id: string; label: string; kind: string; period_start: string; period_end: string;
  amount_eur: number | null; currency: string; amount_minor: number; status: "planned" | "earned" | "cancelled"; earned_on: string | null; cost_center: CostCenter;
}

/* ---------------- MRR / ARR ---------------- */
/** Monthly value of one contract on `date` in its own currency: active subscriptions only, normalized by billing period; set-up fees never count. */
export function contractMrr(c: ContractLite, date: string): number {
  if (c.kind !== "subscription" || c.status !== "active") return 0;
  if (c.start_date > date || (c.end_date && c.end_date < date)) return 0;
  return Math.round(c.recurring_minor / Math.max(1, c.billing_months));
}
/** MRR on a date (EUR) from contracts; `toEur` returns null for a non-EUR contract (left out and counted, D082: no conversion). */
export function mrrOn(contracts: ContractLite[], date: string, toEur: (minor: number, currency: string) => number | null = (m) => m) {
  let mrr = 0, active = 0, missing = 0;
  const byCenter: Record<CostCenter, number> = { consulting: 0, local: 0, thirty: 0, shared: 0 };
  for (const c of contracts) {
    const v = contractMrr(c, date);
    if (!v) continue;
    const e = toEur(v, c.currency);
    if (e === null) { missing++; continue; }
    mrr += e; active++; byCenter[c.cost_center] += e;
  }
  return { mrr, arr: arr(mrr), active, missing, byCenter };
}
/** ARR = MRR × 12: a run rate, not booked annual revenue and not a forecast. */
export const arr = (mrr: number) => mrr * 12;

/** MRR movements of a month, per client (spec 5.10): new, expansion, contraction, churn, reactivation. */
export function mrrMovements(contracts: ContractLite[], month: string, toEur: (minor: number, currency: string) => number | null = (m) => m) {
  const prevEnd = lastDay(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7));
  const end = lastDay(month);
  const byClient = (date: string) => {
    const m = new Map<string, number>();
    for (const c of contracts) { const v = contractMrr(c, date); if (v) m.set(c.client_id || c.id, (m.get(c.client_id || c.id) ?? 0) + (toEur(v, c.currency) ?? 0)); }
    return m;
  };
  const before = byClient(prevEnd), after = byClient(end);
  const everBefore = new Set(contracts.filter((c) => c.kind === "subscription" && c.start_date <= prevEnd).map((c) => c.client_id || c.id));
  const out = { new: 0, expansion: 0, contraction: 0, churn: 0, reactivation: 0 };
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(k) ?? 0, b = after.get(k) ?? 0;
    if (!a && b) { if (everBefore.has(k)) out.reactivation += b; else out.new += b; }
    else if (a && !b) out.churn += a;
    else if (b > a) out.expansion += b - a;
    else if (b < a) out.contraction += a - b;
  }
  return out;
}

/* ---------------- P&L ---------------- */
export type PnlLine = `rev:${CostCenter}` | "direct" | `opex:${string}` | "cash_in" | "cash_out" | "vat_in" | "vat_out" | "excluded" | "neutral";
export interface PnlMonth {
  month: string;
  revenue: Record<CostCenter, number> & { total: number };
  direct: number;
  gross_profit: number;
  /** Gross profit ÷ recognized revenue, null without revenue. */
  gross_margin: number | null;
  opex: number;
  opex_by_category: Record<string, number>;
  /** Estimated EBITDA = recognized revenue − direct costs − operating expenses (no interest, taxes, depreciation). */
  ebitda: number;
  /** True when part of the revenue is recognized on the payment date (no service period, no schedule): invoice-based estimate. */
  provisional: boolean;
  cash_in: number;
  cash_out: number;
  vat_in: number;
  vat_out: number;
  excluded: number;
  neutral: number;
}
export interface Contribution { ref: string; month: string; line: PnlLine; amount: number }

export function buildPnl(input: { items: FinItem[]; schedule: ScheduleLine[]; contracts: ContractLite[]; months: string[] }) {
  const months = new Map<string, PnlMonth>(input.months.map((m) => [m, emptyMonth(m)]));
  const contrib: Contribution[] = [];
  const add = (ref: string, month: string, line: PnlLine, amount: number) => {
    const pm = months.get(month);
    if (!pm || !amount) return;
    contrib.push({ ref, month, line, amount });
    if (line.startsWith("rev:")) { const cc = line.slice(4) as CostCenter; pm.revenue[cc] += amount; pm.revenue.total += amount; }
    else if (line === "direct") pm.direct += amount;
    else if (line.startsWith("opex:")) { const k = line.slice(5); pm.opex_by_category[k] = (pm.opex_by_category[k] ?? 0) + amount; pm.opex += amount; }
    else if (line === "cash_in") pm.cash_in += amount;
    else if (line === "cash_out") pm.cash_out += amount;
    else if (line === "vat_in") pm.vat_in += amount;
    else if (line === "vat_out") pm.vat_out += amount;
    else if (line === "excluded") pm.excluded += amount;
    else if (line === "neutral") pm.neutral += amount;
  };
  const contractById = new Map(input.contracts.map((c) => [c.id, c]));
  // One-off contracts with schedule lines are recognized by their schedule; their payments are cash only.
  const scheduled = new Set(input.schedule.filter((s) => s.status !== "cancelled" && contractById.get(s.contract_id)?.kind !== "subscription").map((s) => s.contract_id));
  for (const it of input.items) {
    if (it.eur_gross === null || it.eur_net === null) continue; // not in EUR: left out and reported, never converted (D082)
    const m = monthOf(it.date);
    // Cash: recorded payments only, VAT included; contributions, transfers and loans are not operating cash.
    if (it.cls === "neutral") { add(it.id, m, "neutral", it.eur_gross); continue; }
    add(it.id, m, it.eur_gross >= 0 ? "cash_in" : "cash_out", Math.abs(it.eur_gross));
    if (it.eur_vat) add(it.id, m, it.eur_gross >= 0 ? "vat_in" : "vat_out", Math.abs(it.eur_vat ?? 0));
    if (it.cls === "excluded") { add(it.id, m, "excluded", it.eur_net); continue; }
    if (it.cls === "revenue") {
      if (it.contract_id && scheduled.has(it.contract_id)) continue; // revenue follows that contract's schedule: this payment is cash only
      const c = it.contract_id ? contractById.get(it.contract_id) : undefined;
      const period = it.service_from && it.service_to ? { from: it.service_from, to: it.service_to }
        : c?.kind === "subscription" ? billingPeriod(it.date, c.billing_months) : null;
      if (period) for (const [mm, v] of allocateByDays(it.eur_net, period.from, period.to)) add(it.id, mm, `rev:${it.cost_center}`, v);
      else { add(it.id, m, `rev:${it.cost_center}`, it.eur_net); const pm = months.get(m); if (pm) pm.provisional = true; }
      continue;
    }
    // Costs are negative amounts in the ledger; P&L shows them as positive costs.
    const cost = -it.eur_net;
    const line: PnlLine = it.cls === "direct" ? "direct" : `opex:${it.category}`;
    if (it.service_from && it.service_to) for (const [mm, v] of allocateByDays(cost, it.service_from, it.service_to)) add(it.id, mm, line, v);
    else add(it.id, m, line, cost);
  }
  for (const s of input.schedule) {
    if (s.status !== "earned" || s.amount_eur === null) continue;
    for (const [mm, v] of allocateByDays(s.amount_eur, s.period_start, s.period_end)) add(s.id, mm, `rev:${s.cost_center}`, v);
  }
  for (const pm of months.values()) {
    pm.gross_profit = pm.revenue.total - pm.direct;
    pm.gross_margin = pm.revenue.total ? pm.gross_profit / pm.revenue.total : null;
    pm.ebitda = pm.gross_profit - pm.opex;
  }
  return { months: [...months.values()], contributions: contrib };
}
function emptyMonth(month: string): PnlMonth {
  return { month, revenue: { consulting: 0, local: 0, thirty: 0, shared: 0, total: 0 }, direct: 0, gross_profit: 0, gross_margin: null, opex: 0, opex_by_category: {}, ebitda: 0, provisional: false, cash_in: 0, cash_out: 0, vat_in: 0, vat_out: 0, excluded: 0, neutral: 0 };
}
/** Sum of several months (period totals: quarter, year to date, 12 months). */
export function sumMonths(ms: PnlMonth[], label = "total"): PnlMonth {
  const t = emptyMonth(label);
  for (const m of ms) {
    for (const c of COST_CENTERS) t.revenue[c] += m.revenue[c];
    t.revenue.total += m.revenue.total; t.direct += m.direct; t.opex += m.opex;
    for (const [k, v] of Object.entries(m.opex_by_category)) t.opex_by_category[k] = (t.opex_by_category[k] ?? 0) + v;
    t.cash_in += m.cash_in; t.cash_out += m.cash_out; t.vat_in += m.vat_in; t.vat_out += m.vat_out; t.excluded += m.excluded; t.neutral += m.neutral;
    t.provisional ||= m.provisional;
  }
  t.gross_profit = t.revenue.total - t.direct;
  t.gross_margin = t.revenue.total ? t.gross_profit / t.revenue.total : null;
  t.ebitda = t.gross_profit - t.opex;
  return t;
}

/**
 * Months of cash left: cash ÷ average net operating cash burn of the last 3 complete months (cash out − cash in,
 * contributions and transfers excluded). Null when the business does not burn cash over that window.
 */
export function runwayMonths(cashEur: number, complete: PnlMonth[]): number | null {
  const last = complete.slice(-3);
  if (!last.length) return null;
  const burn = last.reduce((a, m) => a + (m.cash_out - m.cash_in), 0) / last.length;
  if (burn <= 0) return null;
  return Math.max(0, Math.round((cashEur / burn) * 10) / 10);
}

/** Suggested cost center of a bank credit: client name match, 30/30 sale, Local price, else Consulting (the main offer). */
export function suggestCostCenter(t: { category: BankCategory; amount_minor: number; counterparty: string; description: string }, clients: { name: string; brand: CostCenter }[], localMonthly: number): CostCenter {
  const cls = defaultClass(t.category);
  if (cls !== "revenue") return "shared";
  const text = `${t.counterparty} ${t.description}`.toLowerCase();
  const hit = clients.find((c) => c.name.trim().length >= 3 && text.includes(c.name.replace(/\s*\(d[eé]mo\)\s*/i, "").trim().toLowerCase()));
  if (hit) return hit.brand;
  if (/30\s*\/\s*30|thirty/.test(text) || Math.abs(t.amount_minor) === 3900) return "thirty";
  if (localMonthly > 0 && Math.abs(t.amount_minor) % localMonthly === 0 && Math.abs(t.amount_minor) <= localMonthly * 12 && /abonnement|suscripci|subscription|local/.test(text)) return "local";
  return "consulting";
}
