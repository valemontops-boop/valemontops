import { describe, expect, it } from "vitest";
import {
  BACKFILL_FLOOR, DAY_MS, afterWindow, backfillSummary, expensesByCategory, filterMovements, inPeriod, movementTotals, movementYears, nextWindow, parseBackfillState, planWindows, splitCsv, startProgress,
  type MoveRow,
} from "./bank-history";

const now = "2026-11-09T10:00:00.000Z";

describe("backfill windows (D091)", () => {
  it("walks backwards from now in windows of at most 365 days, no gap, no overlap, down to the 2015 floor", () => {
    const ws = planWindows(now);
    expect(ws[0]).toEqual({ from: new Date(Date.parse(now) - 365 * DAY_MS).toISOString(), to: now });
    for (let i = 1; i < ws.length; i++) expect(ws[i].to).toBe(ws[i - 1].from);
    for (const w of ws) expect(Date.parse(w.to) - Date.parse(w.from)).toBeLessThanOrEqual(365 * DAY_MS);
    expect(ws.at(-1)!.from).toBe(BACKFILL_FLOOR);
    expect(ws).toHaveLength(12);
  });
  it("starts from the earliest movement already stored, else now", () => {
    expect(startProgress("2025-08-01T00:00:00.000Z", now)).toEqual({ reached: "2025-08-01T00:00:00.000Z", empty: 0, done: false });
    expect(startProgress(null, now).reached).toBe(now);
    expect(startProgress("2027-01-01T00:00:00.000Z", now).reached).toBe(now); // a future date is not trusted
  });
  it("stops after two consecutive empty windows; a window with movements resets the count", () => {
    let p = startProgress(null, now);
    const step = (count: number) => { const w = nextWindow(p)!; p = afterWindow(p, w, count); return p; };
    expect(step(0)).toMatchObject({ empty: 1, done: false });
    expect(step(4)).toMatchObject({ empty: 0, done: false }); // resets
    expect(step(0)).toMatchObject({ empty: 1, done: false });
    expect(step(0)).toMatchObject({ empty: 2, done: true });
    expect(nextWindow(p)).toBeNull();
  });
  it("stops at the floor even with movements, and the last window is clipped to it", () => {
    let p = startProgress("2015-06-01T00:00:00.000Z", now);
    const w = nextWindow(p)!;
    expect(w.from).toBe(BACKFILL_FLOOR);
    p = afterWindow(p, w, 10);
    expect(p.done).toBe(true);
  });
  it("resumes from saved progress: the next window starts where the last one ended", () => {
    const saved = parseBackfillState(JSON.stringify({ v: 1, status: "partial", balances: { b1: { reached: "2024-03-10T00:00:00.000Z", empty: 1, done: false, currency: "EUR" } }, added: 120, started_at: now, updated_at: now, lease_until: null, error: "" }))!;
    expect(nextWindow(saved.balances.b1)!.to).toBe("2024-03-10T00:00:00.000Z");
    expect(backfillSummary(saved, now)).toMatchObject({ started: true, done: false, reached: "2024-03-10T00:00:00.000Z", added: 120, running: false });
    expect(parseBackfillState("{not json")).toBeNull();
    expect(backfillSummary(null)).toMatchObject({ started: false, done: false });
  });
  it("a running state with an expired lease is not running any more (a crashed call is resumed)", () => {
    const s = parseBackfillState(JSON.stringify({ v: 1, status: "running", balances: {}, added: 0, started_at: now, updated_at: now, lease_until: "2026-11-09T09:00:00.000Z", error: "" }))!;
    expect(backfillSummary(s, now).running).toBe(false);
    expect(backfillSummary({ ...s, lease_until: "2026-11-09T11:00:00.000Z" }, now).running).toBe(true);
  });
});

const row = (date: string, amount: number, category: MoveRow["category"], extra: Partial<MoveRow> = {}): MoveRow => ({ date, currency: "EUR", amount_minor: amount, direction: amount >= 0 ? "credit" : "debit", category, bank: "wise", counterparty: "", description: "", category_source: "auto", ...extra });

describe("all-time movements (D091)", () => {
  const rows = [
    row("2023-04-02", 800000, "founder_contribution"),
    row("2023-05-10", -2390, "software", { counterparty: "Google" }),
    row("2024-01-15", 150000, "revenue", { counterparty: "Plomberie Démo" }),
    row("2024-02-01", -15000, "ads", { counterparty: "Meta" }),
    row("2025-06-01", -5000, "internal_transfer"),
    row("2026-10-20", -2000, "software", { counterparty: "Notion" }),
    row("2026-10-21", -3000, "other_expense", { currency: "USD" }),
    row("2026-11-01", -1000, "refund", { direction: "debit" }),
  ];
  const all = { period: "all", category: "" as const, kind: "all" as const, source: "all" as const, q: "" };
  it("filters by period: since the start, a year, the last 12 months", () => {
    expect(filterMovements(rows, all, "2026-11-09")).toHaveLength(8);
    expect(filterMovements(rows, { ...all, period: "2024" }, "2026-11-09")).toHaveLength(2);
    expect(filterMovements(rows, { ...all, period: "12m" }, "2026-11-09").map((r) => r.date)).toEqual(["2026-10-20", "2026-10-21", "2026-11-01"]);
    expect(inPeriod("2025-11-09", "12m", "2026-11-09")).toBe(false);
  });
  it("filters by category, direction and an accent-insensitive search", () => {
    expect(filterMovements(rows, { ...all, category: "software" }, "2026-11-09")).toHaveLength(2);
    expect(filterMovements(rows, { ...all, kind: "in" }, "2026-11-09")).toHaveLength(2);
    expect(filterMovements(rows, { ...all, kind: "review" }, "2026-11-09").map((r) => r.category)).toEqual(["revenue"]);
    expect(filterMovements(rows, { ...all, q: "plomberie demo" }, "2026-11-09")).toHaveLength(1);
  });
  it("totals in EUR only: income (refund negative), expenses without neutral categories, net", () => {
    const tot = movementTotals(rows);
    expect(tot).toEqual({ income: 149000, expenses: 19390, net: 129610, non_eur: 1, count: 8 });
    expect(expensesByCategory(rows)).toEqual([
      { category: "ads", amount: 15000, count: 1 },
      { category: "software", amount: 4390, count: 2 },
    ]);
    expect(movementYears(rows)).toEqual(["2026", "2025", "2024", "2023"]);
  });
});

describe("multi-year CSV parts (D091)", () => {
  it("splits on record boundaries outside quotes, repeats the header and keeps row offsets", () => {
    const head = "TransferWise ID,Date,Amount,Currency,Description\n";
    const body = Array.from({ length: 50 }, (_, i) => `T-${i},01-02-2024,-${i}.00,EUR,"Line ${i}\nwith a newline, and a comma"\n`).join("");
    const parts = splitCsv(`﻿${head}${body}`, 400);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.csv.startsWith(head))).toBe(true);
    expect(parts.reduce((a, p) => a + p.rows, 0)).toBe(50);
    expect(parts.map((p) => p.offset)).toEqual(parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + p.rows, 0)));
    expect(parts.map((p) => p.csv.slice(head.length)).join("")).toBe(body);
    expect(splitCsv(head, 400)).toEqual([{ csv: head, rows: 0, offset: 0 }]);
  });
});
