import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeWiseServer } from "@/fake-wise/server";
import { WiseAdapter } from "@/data/bank/wise";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { importBankCsv, moneyOverview, syncBank } from "@/server/services/bank";
import { backfillBank, movementsPage } from "@/server/services/bank-history";
import { financeOverview } from "@/server/services/finance";
import { freshSheetsRepo, makeRepo } from "../helpers";

let fake: FakeSheetsServer;
let wise: FakeWiseServer;
let ctx: AppContext;
let url: string;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const fast = { pauseMs: 0 };
let total = 0;

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  url = env.url;
  wise = new FakeWiseServer();
  await wise.start();
  wise.publicKeyPem = keys.publicKey;
  wise.store.profile = "biz-1";
  wise.store.balances.push({ id: "b-eur", currency: "EUR", amount_minor: 0, name: "" }, { id: "b-usd", currency: "EUR", amount_minor: 0, name: "Taxes" });
  // ~3.5 years of history on the main balance (opened 1 300 days ago), 2 years on the second one.
  total = wise.store.addHistory("b-eur", ago(1300), ago(1), 20, "E") + wise.store.addHistory("b-usd", ago(700), ago(200), 45, "S");
  ctx = { repo: env.repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo", bank: new WiseAdapter(wise.url, "wise-test-token", keys.privateKey) };
  await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => { await fake.stop(); await wise.stop(); });

const stored = async () => (await makeRepo(url).list("BankTransactions")).rows.filter((r) => r.origin === "api");
const appends = () => fake.requestLog.filter((r) => r.method === "POST" && decodeURIComponent(r.path).includes("BankTransactions") && r.path.includes(":append")).length;

describe("Wise full history (D091)", () => {
  it("inserts every movement once across windows of ≤ 365 days, one append per window, then stops; a re-run adds nothing", async () => {
    await syncBank(ctx); // first sync: the last 90 days only
    const first = (await stored()).length;
    expect(first).toBeLessThan(total);
    const before = appends();
    const r = await backfillBank(ctx, { founder: "theo" }, fast);
    expect(r).toMatchObject({ done: true, status: "done", added: total - first, added_now: total - first });
    const rows = await stored();
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((x) => x.source_id)).size).toBe(total);
    expect(r.first).toBe(rows.map((x) => x.occurred_at).sort()[0]); // "since the account was opened" = the oldest movement found
    for (const w of wise.windows.filter((x) => x.from !== x.to && Date.parse(x.to) - Date.parse(x.from) > 100 * DAY)) expect(Date.parse(w.to) - Date.parse(w.from)).toBeLessThanOrEqual(365 * DAY);
    // Backwards walk: each balance stops after two empty windows (b-eur opened ~3.6 years ago → 4 full windows + 2 empty).
    const eurWindows = wise.windows.filter((w) => w.balanceId === "b-eur" && Date.parse(w.to) - Date.parse(w.from) > 100 * DAY);
    expect(eurWindows.length).toBeGreaterThanOrEqual(5);
    expect(eurWindows.length).toBeLessThanOrEqual(7);
    expect(appends() - before).toBeLessThanOrEqual(eurWindows.length + 4); // batched: at most one append per window, never per row
    // Re-run: done, no Wise call, nothing added.
    const calls = wise.windows.length;
    expect(await backfillBank(ctx, { founder: "theo" }, fast)).toMatchObject({ done: true, added_now: 0 });
    expect(wise.windows.length).toBe(calls);
    expect((await moneyOverview(ctx, "theo")).backfill).toMatchObject({ started: true, done: true, added: total - first });
  });

  it("resumes after an interruption (Wise error, then the time budget) without inserting twice", async () => {
    await syncBank(ctx);
    wise.failAfterWindows = wise.windows.length + 2; // two windows, then Wise fails
    await expect(backfillBank(ctx, { founder: "theo" }, fast)).rejects.toThrow(/503/);
    expect((await moneyOverview(ctx, "theo")).backfill).toMatchObject({ started: true, status: "error", done: false });
    const mid = (await stored()).length;
    expect(mid).toBeLessThan(total);
    wise.failAfterWindows = null;
    // A call that runs out of time after one window saves its progress as "partial".
    let tick = 0;
    const r1 = await backfillBank(ctx, { founder: "theo" }, { ...fast, budgetMs: 1, now: () => (tick++ < 4 ? 0 : 10) });
    expect(r1).toMatchObject({ status: "partial", done: false });
    const r2 = await backfillBank(ctx, { founder: "theo" }, fast);
    expect(r2).toMatchObject({ status: "done", done: true });
    const rows = await stored();
    expect(rows).toHaveLength(total);
    expect(new Set(rows.map((x) => x.id)).size).toBe(total);
  });

  it("without an accepted signing key: status sca_required, a clear message pointing to the CSV import, nothing inserted", async () => {
    wise.publicKeyPem = null;
    const r = await backfillBank(ctx, { founder: "theo" }, fast);
    expect(r).toMatchObject({ status: "sca_required", done: false });
    expect(r.error).toMatch(/CSV/);
    expect(await stored()).toHaveLength(0);
    expect((await moneyOverview(ctx, "theo")).status).toBe("sca_required");
  });

  it("imports a multi-year CSV in chunks of 500 rows (one append each) and re-importing adds nothing", async () => {
    const head = "TransferWise ID,Date,Amount,Currency,Description,Payment Reference,Running Balance,Exchange From,Exchange To,Exchange Rate,Payer Name,Payee Name,Payee Account Number,Merchant,Card Last Four Digits,Card Holder Full Name,Attachment,Note,Total fees\n";
    const lines: string[] = [];
    for (let i = 0; i < 1_200; i++) {
      const d = new Date(Date.UTC(2023, 0, 1) + i * DAY);
      const day = `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
      lines.push(i % 4 === 0 ? `TRANSFER-${i},${day},450.00,EUR,Received money from Client (test),INV${i},,,,,Client (test),,,,,,,,0` : `CARD-${i},${day},-12.50,EUR,"Card transaction, Notion",,,,,,,,,Notion,1234,Test,,,0`);
    }
    const csv = head + lines.join("\n") + "\n";
    const before = appends();
    const r = await importBankCsv(ctx, "theo", { csv }, fast);
    expect(r).toMatchObject({ added: 1_200, skipped: 0, errors: [] });
    expect(appends() - before).toBe(3); // 500 + 500 + 200
    expect(await importBankCsv(ctx, "theo", { csv }, fast)).toMatchObject({ added: 0, skipped: 1_200 });
    // A bad row keeps its true row number in the whole file.
    expect((await importBankCsv(ctx, "theo", { csv: `${head}X-1,,1.00,EUR,x,,,,,,,,,,,,,,0\n`, row_offset: 999 }, fast)).errors).toEqual(["Row 1001: missing ID, date or amount"]);
  });

  it("all-time totals, filters, pages and the P&L since the first movement", async () => {
    await syncBank(ctx);
    await backfillBank(ctx, { founder: "theo" }, fast);
    const rows = await stored();
    const all = await movementsPage(ctx, "theo", { size: 20 });
    expect(all.total).toBe(total);
    expect(all.rows).toHaveLength(20);
    expect(all.items.map((i) => i.id).sort()).toEqual(all.rows.map((r) => r.id).sort());
    const income = rows.filter((r) => r.category === "revenue").reduce((a, r) => a + r.amount_minor, 0);
    const expenses = -rows.filter((r) => r.direction === "debit").reduce((a, r) => a + r.amount_minor, 0);
    expect(all.totals).toMatchObject({ income, expenses, net: income - expenses });
    expect(all.by_category[0]).toMatchObject({ category: "software", amount: expenses });
    expect(all.years.length).toBeGreaterThanOrEqual(4);
    const y = all.years[1];
    const year = await movementsPage(ctx, "theo", { period: y, kind: "out" });
    expect(year.total).toBe(rows.filter((r) => r.date.startsWith(y) && r.direction === "debit").length);
    const p2 = await movementsPage(ctx, "theo", { page: 1, size: 20 });
    expect(p2.rows[0].id).not.toBe(all.rows[0].id);
    expect((await movementsPage(ctx, "theo", { q: "notion", category: "software" })).total).toBe(rows.filter((r) => r.category === "software").length);
    const fin = await financeOverview(ctx, "theo", { span: "all" });
    expect(fin.pnl[0].month).toBe(all.first_date!.slice(0, 7));
    expect(fin.pnl.reduce((a, m) => a + m.cash_out, 0)).toBe(expenses);
  });
});
