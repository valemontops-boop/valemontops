import { z } from "zod";
import { ConflictError, type DataRepository, type Row } from "@/data/repository";
import { BANK_CATEGORIES, type BankCategory } from "@/domain/bank";
import {
  COST_CENTERS, COST_CLASSES, buildPnl, defaultClass, lastMonths, monthEnd, mrrMovements, mrrOn, runwayMonths, suggestCostCenter, sumMonths,
  type ContractLite, type CostCenter, type FinItem, type PnlMonth, type ScheduleLine,
} from "@/domain/finance";
import { addDays, localDate } from "@/domain/time";
import type { FounderKey } from "@/domain/constants";
import { childId } from "@/lib/ids";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { offerDefaults, settingValue, userRow } from "./common";
import { PAY_CURRENCIES, USD_RATE_SOURCES, parseRate, rateString, usdToEur, type UsdRate, type UsdRateSource } from "@/domain/usd";
import { bankRatesOf, currentUsdRate, usdRateOverview } from "./usd-rates";

/**
 * Stage 3 finance (spec 5.10, D078): ledger (bank movements + manual entries), contracts, revenue schedule, managerial
 * P&L and MRR/ARR. Reads only through the repository; every derived number is recomputed on read.
 * Everything is EUR (D082: the founders dropped EUR/USD and ECB rates): a movement in another currency is shown in its
 * own currency and left out of the EUR totals, never converted with an invented rate. Exception (D085): a manual entry
 * paying a supplier in USD locks its rate at entry (Wise payment > Wise today > manual > demo); without one it stays
 * "rate missing" and out of the EUR totals.
 */
const FINANCE_TABLES = ["BankTransactions", "BankBalances", "RevenueSnapshots", "FinanceAllocations", "LedgerEntries", "Contracts", "RevenueSchedules", "Clients", "Projects", "Milestones", "Quotes"] as const;

/* ---------------- read model ---------------- */
type Db = { [K in (typeof FINANCE_TABLES)[number]]: { rows: Row<K>[] } };
const live = <R extends { is_archived: boolean; id: string; created_at: string }>(rows: R[]) => {
  const seen = new Map<string, R>();
  for (const r of rows) if (!r.is_archived) { const p = seen.get(r.id); if (!p || r.created_at < p.created_at) seen.set(r.id, r); }
  return [...seen.values()];
};
const contractLite = (c: Row<"Contracts">): ContractLite => ({ id: c.id, client_id: c.client_id, name: c.name, cost_center: c.cost_center, kind: c.kind, currency: c.currency, setup_minor: c.setup_minor, one_off_minor: c.one_off_minor, recurring_minor: c.recurring_minor, billing_months: c.billing_months, start_date: c.start_date, end_date: c.end_date, status: c.status });

/** EUR only: a non-EUR amount is "hors EUR, non converti" (null), shown in its own currency and left out of EUR totals. */
const eurOnly = (minor: number, currency: string): number | null => (currency.toUpperCase() === "EUR" ? minor : null);

/** Every movement as one ledger line (bank rows read through their allocation, manual entries). */
export function ledgerItems(db: Db, localMonthly: number) {
  const clients = live(db.Clients.rows);
  const contracts = live(db.Contracts.rows);
  const allocs = new Map(live(db.FinanceAllocations.rows).map((a) => [a.bank_tx_id, a]));
  const bankRates = bankRatesOf(db.BankTransactions.rows);
  const items: (FinItem & { alloc_version: number; bank: string; auto: boolean; kind: string; corrects_id: string; reversed: boolean; fx: UsdRate | null; rate_missing: boolean; fx_minor: number | null; fx_currency: string })[] = [];
  const nameMatch = (text: string) => clients.find((c) => c.name.trim().length >= 3 && text.toLowerCase().includes(c.name.replace(/\s*\(d[eé]mo\)\s*/i, "").trim().toLowerCase()));
  for (const t of live(db.BankTransactions.rows)) {
    const a = allocs.get(t.id);
    const cls = (a?.cost_class || defaultClass(t.category)) as FinItem["cls"];
    const client = cls === "revenue" ? nameMatch(`${t.counterparty} ${t.description}`) : undefined;
    const cc: CostCenter = a?.cost_center ?? suggestCostCenter(t, clients.map((c) => ({ name: c.name, brand: c.brand })), localMonthly);
    const autoContract = !a && client ? (contracts.filter((c) => c.client_id === client.id && c.status !== "ended").sort((x, y) => Number(y.kind === "subscription" && y.recurring_minor === Math.abs(t.amount_minor)) - Number(x.kind === "subscription" && x.recurring_minor === Math.abs(t.amount_minor)))[0]?.id ?? "") : "";
    const vat = Math.sign(t.amount_minor) * Math.abs(a?.vat_minor ?? 0);
    const g = eurOnly(t.amount_minor, t.currency);
    const v = eurOnly(vat, t.currency);
    items.push({
      id: t.id, source: "bank", bank: t.bank, date: t.date, label: t.description, counterparty: t.counterparty, category: t.category, cost_center: cc, cls,
      currency: t.currency, gross_minor: t.amount_minor, vat_minor: vat, eur_gross: g, eur_vat: v, eur_net: g === null || v === null ? null : g - v,
      service_from: a?.service_from ?? null, service_to: a?.service_to ?? null, contract_id: a ? a.contract_id : autoContract, project_id: a?.project_id ?? "",
      receipt_url: a?.receipt_url ?? "", reference: a?.reference ?? "", reconciled: a?.reconciled ?? false, alloc_version: a?.version ?? 0, auto: !a, kind: t.direction, corrects_id: "", reversed: false,
      // A Wise payment sent in USD from the EUR balance: the EUR debited is what counts; the USD sent and its real rate are shown.
      fx: bankRates.get(t.id) ?? null, rate_missing: false, fx_minor: t.fx_amount_minor ?? null, fx_currency: t.fx_currency ?? "",
    });
  }
  const entries = live(db.LedgerEntries.rows);
  const reversed = new Set(entries.map((e) => e.corrects_id).filter(Boolean));
  for (const e of entries) {
    const usd = e.currency.toUpperCase() === "USD";
    const fx = usd ? entryRate(e) : null;
    // EUR as is; USD at its locked rate (D085); legacy non-EUR entries (before D082, e.g. ECB) are not converted.
    const eur = e.currency.toUpperCase() === "EUR";
    const g = eur ? e.amount_minor + e.vat_minor : fx ? e.eur_minor + e.eur_vat_minor : null;
    const v = eur ? e.vat_minor : fx ? e.eur_vat_minor : null;
    items.push({
      id: e.id, source: "manual", bank: "", date: e.date, label: e.note, counterparty: e.counterparty, category: e.category, cost_center: e.cost_center, cls: (e.cost_class || defaultClass(e.category)) as FinItem["cls"],
      currency: e.currency, gross_minor: e.amount_minor + e.vat_minor, vat_minor: e.vat_minor, eur_gross: g, eur_vat: v, eur_net: g === null || v === null ? null : g - v,
      fx, rate_missing: usd && !fx, fx_minor: null, fx_currency: "",
      service_from: e.service_from, service_to: e.service_to,
      contract_id: e.contract_id, project_id: e.project_id, receipt_url: e.receipt_url, reference: e.reference, reconciled: true, alloc_version: e.version, auto: false, kind: e.kind, corrects_id: e.corrects_id, reversed: reversed.has(e.id),
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** The rate locked on a USD manual entry (D085 sources only; an ECB rate from before D082 is not used). */
function entryRate(e: Row<"LedgerEntries">): UsdRate | null {
  const micro = parseRate(e.fx_rate);
  if (micro === null || !e.fx_date || !(USD_RATE_SOURCES as readonly string[]).includes(e.fx_source)) return null;
  return { micro, date: e.fx_date, source: e.fx_source as UsdRateSource, ...(e.wise_tx_id ? { bank_tx_id: e.wise_tx_id } : {}) };
}

/** Revenue schedule lines; a line tied to a project milestone is earned the day the milestone is done. */
export function scheduleLines(db: Db): (ScheduleLine & { version: number; milestone_id: string; derived_earned: boolean })[] {
  const contracts = new Map(live(db.Contracts.rows).map((c) => [c.id, c]));
  const milestones = new Map(live(db.Milestones.rows).map((m) => [m.id, m]));
  return live(db.RevenueSchedules.rows).filter((s) => contracts.has(s.contract_id)).map((s) => {
    const done = s.milestone_id ? milestones.get(s.milestone_id)?.done_at ?? null : null;
    const derived = s.status === "planned" && Boolean(done);
    const status = derived ? ("earned" as const) : s.status;
    const earned = derived ? done!.slice(0, 10) : s.earned_on;
    const [ps, pe] = s.kind === "milestone" && earned && status === "earned" ? [earned, earned] : [s.period_start, s.period_end];
    return {
      id: s.id, contract_id: s.contract_id, label: s.label, kind: s.kind, period_start: ps, period_end: pe, amount_minor: s.amount_minor, currency: s.currency,
      amount_eur: eurOnly(s.amount_minor, s.currency), status, earned_on: earned, cost_center: contracts.get(s.contract_id)!.cost_center,
      version: s.version, milestone_id: s.milestone_id, derived_earned: derived,
    };
  }).sort((a, b) => a.period_start.localeCompare(b.period_start));
}

async function readDb(ctx: AppContext, fresh = false): Promise<Db> {
  return (await ctx.repo.listMany([...FINANCE_TABLES], { fresh })) as unknown as Db;
}

export const overviewSchema = z.object({ months: z.coerce.number().int().min(3).max(24).default(12) });

/** The finance read model behind Money: dashboard numbers, P&L by month with drill-down, contracts, schedule. */
export async function financeOverview(ctx: AppContext, founder: FounderKey, input: { months?: number } = {}) {
  const months = input.months ?? 12;
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const db = await readDb(ctx);
  const { local } = await offerDefaults(ctx.repo);
  const items = ledgerItems(db, local);
  const schedule = scheduleLines(db);
  const contracts = live(db.Contracts.rows);
  const lites = contracts.map(contractLite);
  const window = lastMonths(today, months);
  const pnl = buildPnl({ items, schedule, contracts: lites, months: window });

  // Cash: what the accounts hold now in EUR (Wise balances + Stripe balance not yet paid out); other currencies are counted apart, never converted.
  const balances = live(db.BankBalances.rows);
  let cash = 0, cashMissing = 0;
  for (const b of balances) { const e = eurOnly(b.amount_minor, b.currency); if (e === null) cashMissing++; else cash += e; }
  const current = pnl.months.at(-1)!;
  const complete = pnl.months.slice(0, -1);
  const mrrC = mrrOn(lites, today, eurOnly);
  const snaps = live(db.RevenueSnapshots.rows).filter((r) => r.currency === "EUR").sort((a, b) => a.date.localeCompare(b.date));
  const stripe = snaps.at(-1) ?? null;
  const hasSubs = lites.some((c) => c.kind === "subscription");
  const mrr = hasSubs ? { value: mrrC.mrr, source: "contracts" as const, active: mrrC.active } : stripe ? { value: stripe.mrr_minor, source: "stripe" as const, active: stripe.active_subscriptions } : { value: null, source: null, active: 0 };
  const movements = mrrMovements(lites, today.slice(0, 7), eurOnly);

  const windowStart = `${window[0]}-01`;
  const contributing = new Set(pnl.contributions.map((c) => c.ref));
  const shown = items.filter((i) => i.date >= windowStart || contributing.has(i.id));
  const projects = new Map(live(db.Projects.rows).map((p) => [p.id, p]));
  const clients = new Map(live(db.Clients.rows).map((c) => [c.id, c]));
  const projectsWithoutContract = live(db.Projects.rows).filter((p) => (p.mrr_minor > 0 || p.revenue_one_off_minor > 0) && !contracts.some((c) => c.project_id === p.id)).length;
  const nonEur = items.filter((i) => i.eur_gross === null && !i.rate_missing).length;
  const usdMissing = items.filter((i) => i.rate_missing && !i.reversed && i.kind !== "adjustment");
  const quarterStart = window.slice(-((Number(today.slice(5, 7)) - 1) % 3 + 1));
  const ytd = window.filter((m) => m.startsWith(today.slice(0, 4)));
  return {
    today, mode: ctx.mode,
    numbers: {
      cash, cash_missing: cashMissing, mrr, arr: mrr.value === null ? null : mrr.value * 12, stripe_mrr: stripe?.mrr_minor ?? null,
      revenue_month: current.revenue.total, cash_in_month: current.cash_in, ebitda_month: current.ebitda, provisional: current.provisional,
      runway: runwayMonths(cash, complete), burning: complete.slice(-3).some((m) => m.cash_out > m.cash_in),
    },
    pnl: pnl.months,
    totals: { window: sumMonths(pnl.months), quarter: sumMonths(pnl.months.filter((m) => quarterStart.includes(m.month))), ytd: sumMonths(pnl.months.filter((m) => ytd.includes(m.month))) },
    contributions: pnl.contributions,
    items: shown.map((i) => ({ ...i, project_name: projects.get(i.project_id)?.name ?? "", contract_name: contracts.find((c) => c.id === i.contract_id)?.name ?? "" })),
    contracts: contracts.sort((a, b) => b.start_date.localeCompare(a.start_date)).map((c) => ({ ...c, client_name: clients.get(c.client_id)?.name ?? "", mrr_now: mrrOn([contractLite(c)], today).mrr })),
    schedule,
    mrr_movements: movements,
    /** Movements in another currency: listed in their own currency, left out of every EUR total (no conversion, D082). */
    non_eur: nonEur,
    /** USD supplier payments with no rate (D085): shown in USD with "rate missing", left out of EUR totals. */
    usd_missing: { count: usdMissing.length, usd_minor: usdMissing.reduce((a, i) => a + Math.abs(i.gross_minor), 0) },
    usd: await usdRateOverview(ctx, founder),
    projects_without_contract: projectsWithoutContract,
    projects: live(db.Projects.rows).map((p) => ({ id: p.id, name: p.name })),
    setup_fee_policy: (await settingValue(ctx.repo, "finance_setup_fee_recognition")) === "over_term" ? "over_term" : "at_payment",
  };
}

/* ---------------- mutations ---------------- */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDay = day.nullable().optional();
const url = z.string().trim().max(1_000).refine((s) => s === "" || /^https:\/\//.test(s), "https link expected").default("");
const periodOk = (v: { service_from?: string | null; service_to?: string | null }) => Boolean(v.service_from) === Boolean(v.service_to) && (!v.service_from || v.service_from <= v.service_to!);

export const allocationSchema = z.object({
  bank_tx_id: z.string().uuid(),
  expected_version: z.number().int().min(0),
  cost_center: z.enum(COST_CENTERS),
  cost_class: z.enum(["", ...COST_CLASSES]).default(""),
  vat_minor: z.number().int().min(0).max(1_000_000_000).default(0),
  service_from: optDay,
  service_to: optDay,
  contract_id: z.string().max(40).default(""),
  project_id: z.string().max(40).default(""),
  receipt_url: url,
  reference: z.string().trim().max(120).default(""),
  reconciled: z.boolean().default(false),
  note: z.string().trim().max(500).default(""),
}).refine(periodOk, { message: "Service period: both dates, start before end", path: ["service_to"] });

/** How a bank movement is read: cost center, direct/operating, VAT, service period, contract, receipt link, reconciled. */
export async function saveAllocation(ctx: AppContext, founder: FounderKey, input: z.infer<typeof allocationSchema>) {
  const tx = await ctx.repo.get("BankTransactions", input.bank_tx_id, { fresh: true });
  if (!tx || tx.is_archived) throw new RuleError("Movement not found");
  if (input.vat_minor > Math.abs(tx.amount_minor)) throw new RuleError("VAT cannot exceed the amount");
  const id = childId("alloc", input.bank_tx_id);
  const { expected_version, ...v } = input;
  const patch = { ...v, service_from: v.service_from ?? null, service_to: v.service_to ?? null };
  const cur = await ctx.repo.get("FinanceAllocations", id, { fresh: true });
  if (!cur) {
    if (expected_version !== 0) throw new ConflictError("FinanceAllocations", id, expected_version, null);
    return (await ctx.repo.insert("FinanceAllocations", [{ id, ...patch }], { founder }))[0];
  }
  if (expected_version === 0) throw new ConflictError("FinanceAllocations", id, 0, cur as unknown as Record<string, unknown>);
  return ctx.repo.update("FinanceAllocations", id, expected_version, patch, { founder });
}

export const entrySchema = z.object({
  id: z.string().uuid(),
  date: day,
  kind: z.enum(["income", "expense"]),
  category: z.enum(BANK_CATEGORIES),
  cost_center: z.enum(COST_CENTERS),
  cost_class: z.enum(["", ...COST_CLASSES]).default(""),
  /** EUR; USD only for an expense paying a supplier (D085). */
  currency: z.enum(PAY_CURRENCIES).default("EUR"),
  /** USD only: the Wise payment whose real rate to use (else Wise today > manual rate). */
  wise_tx_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  /** Ex VAT, positive; the sign comes from `kind`. */
  amount_minor: z.number().int().min(1).max(10_000_000_000),
  vat_minor: z.number().int().min(0).max(10_000_000_000).default(0),
  counterparty: z.string().trim().max(200).default(""),
  reference: z.string().trim().max(120).default(""),
  receipt_url: url,
  project_id: z.string().max(40).default(""),
  contract_id: z.string().max(40).default(""),
  service_from: optDay,
  service_to: optDay,
  note: z.string().trim().max(500).default(""),
}).refine(periodOk, { message: "Service period: both dates, start before end", path: ["service_to"] })
  .refine((v) => v.currency === "EUR" || v.kind === "expense", { message: "USD only for paying a supplier", path: ["currency"] })
  .refine((v) => !v.wise_tx_id || v.currency === "USD", { message: "Only a USD entry takes the rate of a Wise payment", path: ["wise_tx_id"] });

/**
 * Manual entry for money that did not go through Wise or Stripe. Append-only, idempotent by the id generated when the
 * form opened. EUR, or USD for a supplier payment (D085): the rate, its date and source are locked at entry with the EUR
 * amounts; with no rate at all the entry is kept in USD, "rate missing", out of EUR totals (never an invented rate).
 */
export async function addEntry(ctx: AppContext, founder: FounderKey, input: z.infer<typeof entrySchema>) {
  const existing = await ctx.repo.get("LedgerEntries", input.id, { fresh: true });
  if (existing) return existing;
  if (input.vat_minor > input.amount_minor * 2) throw new RuleError("VAT looks wrong: check the amount ex VAT and the VAT");
  const sign = input.kind === "income" ? 1 : -1;
  const { amount_minor, vat_minor, wise_tx_id, ...rest } = input;
  let fx = { fx_rate: "", fx_date: null as string | null, fx_source: "", eur_minor: sign * amount_minor, eur_vat_minor: sign * vat_minor };
  if (input.currency === "USD") {
    let rate: UsdRate | null = null;
    if (wise_tx_id) {
      const tx = await ctx.repo.get("BankTransactions", wise_tx_id);
      rate = tx && !tx.is_archived ? bankRatesOf([tx]).get(tx.id) ?? null : null;
      if (!rate) throw new RuleError("This Wise movement is not a USD payment.");
    } else {
      const today = localDate(new Date(), (await userRow(ctx.repo, founder)).timezone);
      rate = (await currentUsdRate(ctx, today)).rate;
    }
    fx = rate
      ? { fx_rate: rateString(rate.micro), fx_date: rate.date, fx_source: rate.source, eur_minor: sign * usdToEur(amount_minor, rate.micro), eur_vat_minor: sign * usdToEur(vat_minor, rate.micro) }
      : { fx_rate: "", fx_date: null, fx_source: "", eur_minor: 0, eur_vat_minor: 0 };
  }
  return (await ctx.repo.insert("LedgerEntries", [{
    ...rest, service_from: rest.service_from ?? null, service_to: rest.service_to ?? null, amount_minor: sign * amount_minor, vat_minor: sign * vat_minor,
    ...fx, corrects_id: "", wise_tx_id,
  }], { founder }))[0];
}

export const reverseSchema = z.object({ id: z.string().uuid(), note: z.string().trim().max(500).default("") });
/** History is never erased: a reversing entry (opposite amounts) cancels an entry. Idempotent. */
export async function reverseEntry(ctx: AppContext, founder: FounderKey, input: z.infer<typeof reverseSchema>) {
  const rows = (await ctx.repo.list("LedgerEntries", { fresh: true })).rows;
  const e = rows.find((r) => r.id === input.id && !r.is_archived);
  if (!e) throw new RuleError("Entry not found");
  if (e.corrects_id) throw new RuleError("A correction cannot be reversed: add a new entry instead");
  const id = childId("ledger-reverse", e.id);
  const done = rows.find((r) => r.id === id);
  if (done) return done;
  const today = localDate(new Date(), (await userRow(ctx.repo, founder)).timezone);
  return (await ctx.repo.insert("LedgerEntries", [{
    id, date: today < e.date ? e.date : today, kind: "adjustment", category: e.category, cost_center: e.cost_center, cost_class: e.cost_class, currency: e.currency,
    amount_minor: -e.amount_minor, vat_minor: -e.vat_minor, fx_rate: e.fx_rate, fx_date: e.fx_date, fx_source: e.fx_source, eur_minor: -e.eur_minor, eur_vat_minor: -e.eur_vat_minor,
    counterparty: e.counterparty, reference: e.reference, receipt_url: e.receipt_url, project_id: e.project_id, contract_id: e.contract_id,
    service_from: e.service_from, service_to: e.service_to, corrects_id: e.id, note: input.note || e.note, wise_tx_id: e.wise_tx_id,
  }], { founder }))[0];
}

/* ---------------- contracts and revenue schedule ---------------- */
const addMonthsDay = (d: string, n: number) => { const [y, m, dd] = d.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); return `${x.toISOString().slice(0, 7)}-${String(Math.min(dd, last)).padStart(2, "0")}`; };

/** Client contracts from projects (Stage 2B): Local = subscription (MRR, set-up apart), Consulting / 30/30 = one-off. Idempotent ids. */
export async function contractsFromProjects(ctx: AppContext, founder: FounderKey | "system") {
  const t = await ctx.repo.listMany(["Projects", "Contracts", "Clients"], { fresh: true });
  const existing = new Set(t.Contracts.rows.map((c) => c.id));
  const fresh: Parameters<DataRepository["insert"]>[1] = [];
  for (const p of live(t.Projects.rows)) {
    const sub = p.mrr_minor > 0;
    if (!sub && p.revenue_one_off_minor <= 0) continue;
    const id = childId("contract", p.id, sub ? "subscription" : "one_off");
    if (existing.has(id)) continue;
    const client = t.Clients.rows.find((c) => c.id === p.client_id);
    fresh.push({
      id, client_id: p.client_id, project_id: p.id, quote_id: p.quote_id, name: client?.name || p.name, cost_center: p.brand, kind: sub ? "subscription" : "one_off", currency: "EUR",
      setup_minor: sub ? p.revenue_one_off_minor : 0, one_off_minor: sub ? 0 : p.revenue_one_off_minor, recurring_minor: p.mrr_minor, billing_months: 1,
      start_date: p.start_date, end_date: sub && p.term_months ? addDays(addMonthsDay(p.start_date, p.term_months), -1) : null, status: p.status === "on_hold" ? "paused" : "active", source: "project", notes: "",
    } as never);
  }
  if (fresh.length) await ctx.repo.insert("Contracts", fresh as never, { founder });
  const made = fresh.map((c) => (c as { id: string }).id);
  for (const id of made) await generateSchedule(ctx, founder, { contract_id: id });
  return { added: made.length };
}

export const contractSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  client_id: z.string().max(40).default(""),
  project_id: z.string().max(40).default(""),
  cost_center: z.enum(COST_CENTERS),
  kind: z.enum(["subscription", "one_off"]),
  /** Everything is EUR (D082). */
  currency: z.literal("EUR").default("EUR"),
  setup_minor: z.number().int().min(0).default(0),
  one_off_minor: z.number().int().min(0).default(0),
  recurring_minor: z.number().int().min(0).default(0),
  billing_months: z.number().int().min(1).max(36).default(1),
  start_date: day,
  end_date: optDay,
  notes: z.string().trim().max(1_000).default(""),
}).refine((c) => (c.kind === "subscription" ? c.recurring_minor > 0 : c.one_off_minor > 0), { message: "Amount required", path: ["recurring_minor"] })
  .refine((c) => !c.end_date || c.end_date >= c.start_date, { message: "End before start", path: ["end_date"] });
export async function createContract(ctx: AppContext, founder: FounderKey, input: z.infer<typeof contractSchema>) {
  const cur = await ctx.repo.get("Contracts", input.id, { fresh: true });
  if (cur) return cur;
  const row = (await ctx.repo.insert("Contracts", [{ ...input, quote_id: "", end_date: input.end_date ?? null, status: "active", source: "manual" }], { founder }))[0];
  await generateSchedule(ctx, founder, { contract_id: row.id });
  return row;
}

export const contractUpdateSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int().min(1),
  status: z.enum(["active", "paused", "ended"]).optional(),
  end_date: optDay,
  recurring_minor: z.number().int().min(0).optional(),
  billing_months: z.number().int().min(1).max(36).optional(),
  cost_center: z.enum(COST_CENTERS).optional(),
  notes: z.string().trim().max(1_000).optional(),
});
export async function updateContract(ctx: AppContext, founder: FounderKey, input: z.infer<typeof contractUpdateSchema>) {
  const { id, expected_version, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return ctx.repo.update("Contracts", id, expected_version, patch as never, { founder });
}

export const generateSchema = z.object({ contract_id: z.string().uuid() });
/**
 * Revenue schedule of a one-off contract: one line per project milestone (amount split by the accepted quote's
 * milestone percentages when they match, else equally), or a single line at the start. Earned when the milestone is done.
 * Subscriptions need no lines: each payment carries its service period. Deterministic ids, so a retry adds nothing.
 */
export async function generateSchedule(ctx: AppContext, founder: FounderKey | "system", input: z.infer<typeof generateSchema>) {
  const t = await ctx.repo.listMany(["Contracts", "RevenueSchedules", "Milestones", "Quotes"], { fresh: true });
  const c = t.Contracts.rows.find((x) => x.id === input.contract_id && !x.is_archived);
  if (!c) throw new RuleError("Contract not found");
  if (c.kind !== "one_off") return { added: 0 };
  const have = new Set(t.RevenueSchedules.rows.filter((r) => r.contract_id === c.id).map((r) => r.id));
  if (t.RevenueSchedules.rows.some((r) => r.contract_id === c.id && !r.is_archived)) return { added: 0 };
  const ms = live(t.Milestones.rows).filter((m) => c.project_id && m.project_id === c.project_id).sort((a, b) => a.sort - b.sort);
  const quote = c.quote_id ? t.Quotes.rows.find((q) => q.id === c.quote_id) : undefined;
  const pcts = quote && quote.milestones.length === ms.length && Math.round(quote.milestones.reduce((a, m) => a + m.amount_pct, 0)) === 100 ? quote.milestones.map((m) => m.amount_pct) : null;
  const parts = ms.length ? split(c.one_off_minor, pcts ?? ms.map(() => 1)) : [c.one_off_minor];
  const rows = (ms.length ? ms : [null]).map((m, i) => {
    const d = m?.due_date ?? c.start_date;
    return {
      id: childId("schedule", c.id, m ? m.id : "one_off"), contract_id: c.id, line_key: m ? `milestone:${m.id}` : "one_off", label: m ? m.title : c.name, kind: (m ? "milestone" : "one_off") as "milestone" | "one_off",
      milestone_id: m?.id ?? "", period_start: d, period_end: d, amount_minor: parts[i], currency: c.currency, status: "planned" as const, earned_on: null,
    };
  }).filter((r) => !have.has(r.id) && r.amount_minor > 0);
  if (rows.length) await ctx.repo.insert("RevenueSchedules", rows, { founder });
  return { added: rows.length };
}
/** Integer split by weights, exact sum. */
function split(total: number, weights: number[]) {
  const w = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((x) => (total * x) / w);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, f: r - out[i] })).sort((a, b) => b.f - a.f).forEach((o) => { if (rest > 0) { out[o.i]++; rest--; } });
  return out;
}

export const scheduleUpdateSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int().min(1),
  status: z.enum(["planned", "earned", "cancelled"]),
  earned_on: optDay,
  amount_minor: z.number().int().min(0).optional(),
});
export async function updateScheduleLine(ctx: AppContext, founder: FounderKey, input: z.infer<typeof scheduleUpdateSchema>) {
  const today = localDate(new Date(), (await userRow(ctx.repo, founder)).timezone);
  const earned = input.status === "earned" ? input.earned_on ?? today : null;
  return ctx.repo.update("RevenueSchedules", input.id, input.expected_version, {
    status: input.status, earned_on: earned, ...(earned ? { period_start: earned, period_end: earned } : {}), ...(input.amount_minor !== undefined ? { amount_minor: input.amount_minor } : {}),
  }, { founder });
}

/* ---------------- export (Markdown / Excel, team scope) ---------------- */
/** Managerial P&L by month for the period of an export (calendar months touching it). */
export async function pnlForExport(ctx: AppContext, from: string, to: string) {
  const db = await readDb(ctx);
  const { local } = await offerDefaults(ctx.repo);
  const months = lastMonths(to, Math.min(24, Math.max(1, (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1)));
  const lites = live(db.Contracts.rows).map(contractLite);
  const pnl = buildPnl({ items: ledgerItems(db, local), schedule: scheduleLines(db), contracts: lites, months });
  const mrr = mrrOn(lites, to, eurOnly);
  return { months: pnl.months, mrr: lites.some((c) => c.kind === "subscription") ? mrr.mrr : null, monthEnd };
}

export type FinanceOverview = Awaited<ReturnType<typeof financeOverview>>;
export type { PnlMonth };
export const _test = { split, addMonthsDay };
export type { BankCategory };
