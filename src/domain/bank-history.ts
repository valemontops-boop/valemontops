import { z } from "zod";
import { NEUTRAL, isIncome, type BankCategory } from "./bank";

/**
 * D091: the full Wise history. Pure rules for the backwards walk (windows, stop rules, resumable progress) and for the
 * all-time Movements view (period, category, direction, search, totals). Tested in bank-history.test.ts.
 */
export const DAY_MS = 86_400_000;
/** Wise caps a statement at 469 days; we ask for at most 365 per call. */
export const BACKFILL_WINDOW_DAYS = 365;
/** Hard floor: Wise business accounts did not exist before; never walk further back. */
export const BACKFILL_FLOOR = "2015-01-01T00:00:00.000Z";
/** The account's start is reached after this many consecutive windows with no movement at all. */
export const BACKFILL_EMPTY_STOP = 2;
/** SystemSettings key holding the walk progress (JSON). */
export const BACKFILL_KEY = "wise_backfill_state";

export type BalanceProgress = { reached: string; empty: number; done: boolean };
export type Window = { from: string; to: string };

/** Where the walk starts for a balance: the earliest movement already stored (it is re-read, duplicates are skipped), else now. */
export function startProgress(earliestStored: string | null | undefined, nowIso: string): BalanceProgress {
  return { reached: earliestStored && earliestStored < nowIso ? earliestStored : nowIso, empty: 0, done: false };
}

/** The next window to fetch, walking backwards: [max(floor, reached − 365 d), reached]. Null when the balance is done. */
export function nextWindow(p: BalanceProgress, floor = BACKFILL_FLOOR, days = BACKFILL_WINDOW_DAYS): Window | null {
  if (p.done || p.reached <= floor) return null;
  const from = new Date(Math.max(Date.parse(floor), Date.parse(p.reached) - days * DAY_MS)).toISOString();
  return { from, to: p.reached };
}

/** Progress after a window that returned `count` movements from Wise (new or already stored). */
export function afterWindow(p: BalanceProgress, w: Window, count: number, floor = BACKFILL_FLOOR): BalanceProgress {
  const empty = count > 0 ? 0 : p.empty + 1;
  return { reached: w.from, empty, done: empty >= BACKFILL_EMPTY_STOP || w.from <= floor };
}

/** Every window from `startIso` back to the floor (planning aid and tests): no gap, no overlap, ≤ 365 days each. */
export function planWindows(startIso: string, floor = BACKFILL_FLOOR, days = BACKFILL_WINDOW_DAYS): Window[] {
  const out: Window[] = [];
  let p: BalanceProgress = { reached: startIso, empty: 0, done: false };
  for (let w = nextWindow(p, floor, days); w && out.length < 100; w = nextWindow(p, floor, days)) {
    out.push(w);
    p = { reached: w.from, empty: 0, done: w.from <= floor };
  }
  return out;
}

export const BACKFILL_STATUSES = ["running", "partial", "done", "sca_required", "error"] as const;
export const backfillStateSchema = z.object({
  v: z.literal(1),
  status: z.enum(BACKFILL_STATUSES),
  balances: z.record(z.string(), z.object({ reached: z.string(), empty: z.number().int().min(0), done: z.boolean(), currency: z.string().default("") })),
  added: z.number().int().min(0),
  started_at: z.string(),
  updated_at: z.string(),
  /** Another instance is walking until this time (cross-instance lock); null when idle. */
  lease_until: z.string().nullable(),
  error: z.string().default(""),
});
export type BackfillState = z.infer<typeof backfillStateSchema>;

export function parseBackfillState(raw: string | null | undefined): BackfillState | null {
  if (!raw) return null;
  try {
    const r = backfillStateSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** What the UI shows: started or not, done, the earliest date reached across balances, rows added so far. */
export function backfillSummary(s: BackfillState | null, nowIso = new Date().toISOString()) {
  if (!s) return { started: false, status: null, done: false, reached: null, added: 0, updated_at: null, running: false, error: "" };
  const reached = Object.values(s.balances).map((b) => b.reached).sort()[0] ?? null;
  const running = s.status === "running" && Boolean(s.lease_until && s.lease_until > nowIso);
  return { started: true, status: s.status, done: s.status === "done", reached, added: s.added, updated_at: s.updated_at, running, error: s.error };
}
export type BackfillSummary = ReturnType<typeof backfillSummary>;

/* ---------------- all-time Movements view ---------------- */

export type MoveRow = { date: string; currency: string; amount_minor: number; direction: "credit" | "debit"; category: BankCategory; bank: string; counterparty: string; description: string; note?: string; category_source: string };
export const MOVE_KINDS = ["all", "in", "out", "review"] as const;
export type MoveFilter = { period: string; category: BankCategory | ""; kind: (typeof MOVE_KINDS)[number]; source: "all" | "wise" | "stripe"; q: string };

/** "all" (since the first movement), a year "2024", or "12m" (the last 12 months up to today). */
export function inPeriod(date: string, period: string, today: string): boolean {
  if (period === "all") return true;
  if (/^\d{4}$/.test(period)) return date.startsWith(period);
  if (period === "12m") return date > new Date(Date.parse(`${today}T12:00:00Z`) - 365 * DAY_MS).toISOString().slice(0, 10) && date <= today;
  return true;
}

/** A credit auto-tagged as income on Wise: a founder should confirm it (same rule as the "To check" filter). */
export const toReview = (r: MoveRow) => r.bank !== "stripe" && r.category_source === "auto" && r.direction === "credit" && isIncome(r.category);

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filterMovements<R extends MoveRow>(rows: R[], f: MoveFilter, today: string): R[] {
  const q = fold(f.q.trim());
  return rows.filter((r) =>
    inPeriod(r.date, f.period, today) &&
    (f.source === "all" || r.bank === f.source) &&
    (!f.category || r.category === f.category) &&
    (f.kind === "all" || (f.kind === "in" ? r.direction === "credit" : f.kind === "out" ? r.direction === "debit" : toReview(r))) &&
    (!q || fold(`${r.counterparty} ${r.description} ${r.note ?? ""}`).includes(q)));
}

/**
 * Totals of a filtered set, EUR only (D082: other currencies counted apart, never converted). Same definitions as the
 * monthly summary: income = income categories (a refund is negative income); expenses = debits outside income and
 * the neutral categories (contributions, transfers, loans); net = income − expenses.
 */
export function movementTotals(rows: MoveRow[]) {
  let income = 0, expenses = 0, nonEur = 0;
  for (const r of rows) {
    if (r.currency.toUpperCase() !== "EUR") { nonEur++; continue; }
    if (isIncome(r.category)) income += r.amount_minor;
    else if (!NEUTRAL.includes(r.category) && r.direction === "debit") expenses -= r.amount_minor;
  }
  return { income, expenses, net: income - expenses, non_eur: nonEur, count: rows.length };
}

/** Expenses by category over the set (EUR, same definition as the totals), largest first. */
export function expensesByCategory(rows: MoveRow[]) {
  const m = new Map<BankCategory, { amount: number; count: number }>();
  for (const r of rows) {
    if (r.currency.toUpperCase() !== "EUR" || isIncome(r.category) || NEUTRAL.includes(r.category) || r.direction !== "debit") continue;
    const c = m.get(r.category) ?? { amount: 0, count: 0 };
    c.amount -= r.amount_minor; c.count++;
    m.set(r.category, c);
  }
  return [...m.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount);
}

/** Years that hold at least one movement, newest first (the year presets of the period filter). */
export const movementYears = (rows: { date: string }[]) => [...new Set(rows.map((r) => r.date.slice(0, 4)))].filter((y) => /^\d{4}$/.test(y)).sort().reverse();

/**
 * Splits a CSV text into parts of at most `maxChars` on record boundaries (a newline outside quotes), repeating the
 * header line in each part, so a multi-year statement can be sent in several requests without breaking a quoted field.
 * `offset` = data records before the part (for true row numbers in error messages).
 */
export function splitCsv(text: string, maxChars: number): { csv: string; rows: number; offset: number }[] {
  const src = text.replace(/^\uFEFF/, "");
  const records: string[] = [];
  let start = 0, quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') quoted = !quoted;
    else if (c === "\n" && !quoted) { records.push(src.slice(start, i + 1)); start = i + 1; }
  }
  if (start < src.length) records.push(src.slice(start) + "\n");
  const [header, ...body] = records.filter((r) => r.trim() !== "");
  if (!header) return [];
  const parts: { csv: string; rows: number; offset: number }[] = [];
  let cur = { csv: header, rows: 0, offset: 0 };
  let seen = 0;
  for (const r of body) {
    if (cur.rows && cur.csv.length + r.length > maxChars) { parts.push(cur); cur = { csv: header, rows: 0, offset: seen }; }
    cur.csv += r; cur.rows++; seen++;
  }
  if (cur.rows || parts.length === 0) parts.push(cur);
  return parts;
}
