import { z } from "zod";
import { ScaRequiredError, type BankTx } from "@/data/bank/wise";
import type { Row } from "@/data/repository";
import { BANK_CATEGORIES } from "@/domain/bank";
import {
  BACKFILL_FLOOR, BACKFILL_KEY, MOVE_KINDS, afterWindow, backfillSummary, expensesByCategory, filterMovements, movementTotals, movementYears, nextWindow, parseBackfillState, startProgress,
  type BackfillState, type BackfillSummary,
} from "@/domain/bank-history";
import type { FounderKey } from "@/domain/constants";
import { localDate } from "@/domain/time";
import { childId } from "@/lib/ids";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { mergeStatement, setStatus, sheetsPause, sleep, type Actor } from "./bank";
import { userRow } from "./common";
import { financeItemsFor } from "./finance";

/**
 * D091: the whole Wise history, since the account was opened. Walks each balance BACKWARDS from the earliest movement
 * already stored (or now) in windows of at most 365 days (Wise allows 469), one batched insert per window, until two
 * windows in a row hold no movement at all or the 2015-01-01 floor. Progress lives in SystemSettings
 * BACKFILL_KEY (JSON), so a call stopped by the function time limit resumes where it stopped.
 */
const SETTING_ID = childId("setting", BACKFILL_KEY);
const SYSTEM: Actor = { founder: "system" };
/** One walk per server instance; a second click while it runs answers at once with the progress. */
let inflight: Promise<unknown> | null = null;

export async function readBackfill(ctx: AppContext): Promise<BackfillSummary> {
  const { rows } = await ctx.repo.list("SystemSettings");
  return backfillSummary(parseBackfillState(rows.find((r) => r.id === SETTING_ID && !r.is_archived)?.value));
}

async function saveState(ctx: AppContext, cur: Row<"SystemSettings"> | null, s: BackfillState, actor: Actor) {
  const value = JSON.stringify(s);
  if (cur) return ctx.repo.update("SystemSettings", SETTING_ID, cur.version, { value }, actor);
  return (await ctx.repo.insert("SystemSettings", [{ id: SETTING_ID, key: BACKFILL_KEY, value, description: "Wise full-history import progress (D091), JSON. Delete the row to start over." }], actor))[0];
}

export type BackfillOptions = {
  /** Stop starting new windows after this long (Vercel stops a function at ~300 s). */
  budgetMs?: number;
  /** Pause between two Wise windows (Wise rate limits; Sheets writes ≤ 60 per minute). */
  pauseMs?: number;
  /** Save progress at least this often while walking (an interrupted call loses at most this much). */
  checkpointMs?: number;
  floor?: string;
  now?: () => number;
};

export async function backfillBank(ctx: AppContext, actor: Actor = SYSTEM, opts: BackfillOptions = {}) {
  if (!ctx.bank) throw new RuleError("Wise is not connected. Add WISE_API_TOKEN (see docs/INTEGRATIONS.md).");
  if (inflight) return { ...(await readBackfill(ctx)), running: true, added_now: 0 };
  const run = walk(ctx, actor, opts);
  inflight = run;
  try {
    return await run;
  } finally {
    inflight = null;
  }
}

async function walk(ctx: AppContext, actor: Actor, opts: BackfillOptions) {
  const bank = ctx.bank!;
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? 240_000;
  const pause = opts.pauseMs ?? sheetsPause(ctx, 2_000);
  const checkpoint = opts.checkpointMs ?? 60_000;
  const floor = opts.floor ?? BACKFILL_FLOOR;
  const iso = () => new Date(clock()).toISOString();

  // One fresh read of both tabs (Sheets: 60 reads per minute for the whole app).
  const t = await ctx.repo.listMany(["BankTransactions", "SystemSettings"], { fresh: true });
  let cur = t.SystemSettings.rows.find((r) => r.id === SETTING_ID && !r.is_archived) ?? null;
  const prev = parseBackfillState(cur?.value);
  if (prev?.status === "done") return { ...backfillSummary(prev, iso()), added_now: 0 };
  if (prev?.status === "running" && prev.lease_until && prev.lease_until > iso()) return { ...backfillSummary(prev, iso()), running: true, added_now: 0 };

  const tz = (await userRow(ctx.repo, "theo").catch(() => null))?.timezone ?? "Europe/Paris";
  const profile = await bank.profileId();
  const balances = await bank.balances(profile);
  const s: BackfillState = prev ?? { v: 1, status: "running", balances: {}, added: 0, started_at: iso(), updated_at: iso(), lease_until: null, error: "" };
  for (const b of balances) {
    if (s.balances[b.id]) continue;
    const earliest = t.BankTransactions.rows.filter((r) => r.balance_id === b.id && r.bank === "wise" && !r.is_archived).map((r) => r.occurred_at).sort()[0];
    s.balances[b.id] = { ...startProgress(earliest, iso()), currency: b.currency, first: earliest ?? "" };
  }
  const lease = () => new Date(clock() + budget + 60_000).toISOString();
  Object.assign(s, { status: "running", lease_until: lease(), updated_at: iso(), error: "" });
  cur = await saveState(ctx, cur, s, actor);
  let lastSave = clock();

  const known = new Set(t.BankTransactions.rows.map((r) => r.id));
  const rows = t.BankTransactions.rows;
  let addedNow = 0, sca = false, windows = 0;
  try {
    outer: for (const b of balances) {
      for (let w = nextWindow(s.balances[b.id], floor); w; w = nextWindow(s.balances[b.id], floor)) {
        if (clock() - started > budget) break outer;
        if (windows++) await sleep(pause);
        let txs: BankTx[];
        try {
          txs = await bank.statement(profile, b.id, b.currency, w.from, w.to);
        } catch (e) {
          if (e instanceof ScaRequiredError) { sca = true; break outer; }
          throw e;
        }
        const n = await mergeStatement(ctx, actor, b, txs, rows, known, tz);
        addedNow += n;
        s.added += n;
        const oldest = [s.balances[b.id].first, ...txs.map((x) => x.occurred_at)].filter(Boolean).sort()[0] ?? "";
        s.balances[b.id] = { ...afterWindow(s.balances[b.id], w, txs.length, floor), currency: b.currency, first: oldest };
        if (clock() - lastSave > checkpoint) {
          Object.assign(s, { lease_until: lease(), updated_at: iso() });
          cur = await saveState(ctx, cur, s, actor);
          lastSave = clock();
        }
      }
    }
  } catch (e) {
    Object.assign(s, { status: "error", lease_until: null, updated_at: iso(), error: (e as Error).message.slice(0, 300) });
    await saveState(ctx, cur, s, actor).catch(() => undefined);
    throw e;
  }
  const allDone = balances.every((b) => s.balances[b.id]?.done);
  Object.assign(s, {
    status: sca ? "sca_required" : allDone ? "done" : "partial", lease_until: null, updated_at: iso(),
    error: sca ? "Wise requires strong authentication for the statement history. Import the full history as a CSV statement instead." : "",
  });
  await saveState(ctx, cur, s, actor);
  if (sca) await setStatus(ctx, "sca_required", "Statements need strong authentication", actor);
  return { ...backfillSummary(s, iso()), added_now: addedNow };
}

/* ---------------- all-time Movements (read only, cached reads) ---------------- */

export const movementsSchema = z.object({
  period: z.string().regex(/^(all|12m|\d{4})$/).default("all"),
  category: z.enum(["", ...BANK_CATEGORIES]).default(""),
  kind: z.enum(MOVE_KINDS).default("all"),
  source: z.enum(["all", "wise", "stripe"]).default("all"),
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  size: z.coerce.number().int().min(10).max(200).default(100),
});

/** Bank movements over a period (since the first one by default) with filters, EUR totals, expenses by category and one page of rows. */
export async function movementsPage(ctx: AppContext, founder: FounderKey, input: z.input<typeof movementsSchema>) {
  const f = movementsSchema.parse(input);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const all = (await ctx.repo.list("BankTransactions")).rows.filter((r) => !r.is_archived);
  const shown = filterMovements(all, f, today).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id));
  const page = shown.slice(f.page * f.size, (f.page + 1) * f.size);
  const items = await financeItemsFor(ctx, new Set(page.map((r) => r.id)));
  const first = all.map((r) => r.date).sort()[0] ?? null;
  return {
    filter: f, today, first_date: first, years: movementYears(all),
    totals: movementTotals(shown), by_category: expensesByCategory(shown),
    total: shown.length, page: f.page, size: f.size,
    rows: page.map((r) => ({ bank: r.bank, id: r.id, version: r.version, occurred_at: r.occurred_at, date: r.date, amount_minor: r.amount_minor, currency: r.currency, description: r.description, counterparty: r.counterparty, category: r.category, category_source: r.category_source, direction: r.direction, origin: r.origin })),
    items,
  };
}
