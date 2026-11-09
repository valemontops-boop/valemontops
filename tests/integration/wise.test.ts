import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeWiseServer } from "@/fake-wise/server";
import { WiseAdapter } from "@/data/bank/wise";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { applyWiseEvent, importBankCsv, moneyOverview, setCategory, syncBank, wiseEventSchema } from "@/server/services/bank";
import { verifyWiseSignature } from "@/server/wise-webhook";
import { commandCenter } from "@/server/services/insights";
import { freshSheetsRepo, makeRepo } from "../helpers";

let fake: FakeSheetsServer;
let wise: FakeWiseServer;
let ctx: AppContext;
let url: string;
const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  url = env.url;
  wise = new FakeWiseServer();
  await wise.start();
  wise.store.profile = "biz-1";
  wise.store.balances.push({ id: "b-eur", currency: "EUR", amount_minor: 0, name: "" });
  const at = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  wise.store.addTx("b-eur", { referenceNumber: "T-1", direction: "credit", occurred_at: at(10), amount_minor: 300000, currency: "EUR", fee_minor: null, description: "Money added", counterparty: "Founder (test)", detailsType: "MONEY_ADDED", merchantCategory: "" });
  wise.store.addTx("b-eur", { referenceNumber: "T-2", direction: "credit", occurred_at: at(5), amount_minor: 49000, currency: "EUR", fee_minor: null, description: "Invoice 1", counterparty: "Client (test)", detailsType: "DEPOSIT", merchantCategory: "" });
  wise.store.addTx("b-eur", { referenceNumber: "T-3", direction: "debit", occurred_at: at(2), amount_minor: -2390, currency: "EUR", fee_minor: null, description: "Google Workspace", counterparty: "Google", detailsType: "CARD", merchantCategory: "Computer Software" });
  ctx = { repo: env.repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo", bank: new WiseAdapter(wise.url, "wise-test-token", keys.privateKey) };
  await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => { await fake.stop(); await wise.stop(); });

describe("Wise", () => {
  it("signs the strong-authentication token, imports the statement once, and categorises it", async () => {
    wise.publicKeyPem = keys.publicKey;
    const r = await syncBank(ctx);
    expect(r).toEqual({ balances: 1, added: 3, sca: false });
    expect((await syncBank(ctx)).added).toBe(0); // idempotent
    const rows = (await makeRepo(url).list("BankTransactions")).rows;
    expect(rows.map((x) => [x.source_id, x.amount_minor, x.category]).sort()).toEqual([["T-1", 300000, "founder_contribution"], ["T-2", 49000, "revenue"], ["T-3", -2390, "software"]]);
    const m = await moneyOverview(ctx, "theo");
    expect(m.balances[0]).toMatchObject({ currency: "EUR", amount_minor: 346610 });
    expect(m.summary.current.income).toBe(m.summary.months.at(-1)!.income);
    expect(m.summary.toReview).toBe(1); // the client payment, auto-tagged
    const cc = await commandCenter(ctx, "theo");
    expect(cc.now.numbers.find((n) => n.key === "cash")).toMatchObject({ value: 346610 });
  });

  it("without an accepted key, keeps balances and reports that statements need strong authentication", async () => {
    wise.publicKeyPem = null; // the key is not registered in Wise
    const r = await syncBank(ctx);
    expect(r).toMatchObject({ balances: 1, added: 0, sca: true });
    const m = await moneyOverview(ctx, "theo");
    expect(m.status).toBe("sca_required");
    expect(m.balances).toHaveLength(1);
  });

  it("records a signed live webhook at once, and completes it (no duplicate) when the statement arrives", async () => {
    const hook = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const occurred = new Date(Date.now() - 60_000).toISOString();
    const body = JSON.stringify({ event_type: "balances#update", data: { resource: { id: "b-eur", profile_id: "biz-1" }, balance_id: "b-eur", amount: 99, currency: "EUR", transaction_type: "credit", occurred_at: occurred, post_transaction_balance_amount: 3565.1, channel_name: "TRANSFER" } });
    const sig = sign("sha256", Buffer.from(body), hook.privateKey).toString("base64");
    expect(verifyWiseSignature(body, sig, hook.publicKey)).toBe(true);
    expect(verifyWiseSignature(body.replace("99", "999"), sig, hook.publicKey)).toBe(false);
    expect(verifyWiseSignature(body, null, hook.publicKey)).toBe(false);
    await applyWiseEvent(ctx, wiseEventSchema.parse(JSON.parse(body)));
    await applyWiseEvent(ctx, wiseEventSchema.parse(JSON.parse(body))); // Wise retries: no duplicate
    let rows = (await ctx.repo.list("BankTransactions", { fresh: true })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "webhook", amount_minor: 9900, direction: "credit" });
    // The same movement later appears in the statement with Wise's reference: completed in place.
    wise.publicKeyPem = keys.publicKey;
    wise.store.addTx("b-eur", { referenceNumber: "T-4", direction: "credit", occurred_at: occurred, amount_minor: 9900, currency: "EUR", fee_minor: null, description: "Subscription", counterparty: "Client (test)", detailsType: "DEPOSIT", merchantCategory: "" });
    await syncBank(ctx);
    rows = (await ctx.repo.list("BankTransactions", { fresh: true })).rows;
    expect(rows.filter((x) => x.amount_minor === 9900)).toHaveLength(1);
    expect(rows.find((x) => x.amount_minor === 9900)).toMatchObject({ source_id: "T-4", origin: "api", counterparty: "Client (test)" });
    expect((await ctx.repo.list("BankBalances", { fresh: true })).rows[0].amount_minor).toBe(356510);
  });

  it("imports a Wise CSV statement idempotently and lets a founder recategorise", async () => {
    const csv = "TransferWise ID,Date,Amount,Currency,Description,Payment Reference,Running Balance,Exchange From,Exchange To,Exchange Rate,Payer Name,Payee Name,Payee Account Number,Merchant,Card Last Four Digits,Card Holder Full Name,Attachment,Note,Total fees\nTRANSFER-1,02-11-2026,490.00,EUR,Received money from Client (test),INV1,490.00,,,,Client (test),,,,,,,,0\nCARD-2,03-11-2026,-23.90,EUR,Card transaction of 23.90 EUR issued by Notion,,466.10,,,,,,,Notion,1234,Test,,,0\n";
    const r = await importBankCsv(ctx, "theo", { csv });
    expect(r).toMatchObject({ added: 2, skipped: 0, errors: [] });
    expect((await importBankCsv(ctx, "theo", { csv })).added).toBe(0);
    const rows = (await ctx.repo.list("BankTransactions", { fresh: true })).rows;
    const income = rows.find((x) => x.source_id === "TRANSFER-1")!;
    expect(income).toMatchObject({ amount_minor: 49000, category: "revenue", date: "2026-11-02" });
    expect(rows.find((x) => x.source_id === "CARD-2")!.category).toBe("software");
    const upd = await setCategory(ctx, "pablo", { id: income.id, expected_version: income.version, category: "founder_contribution" });
    expect(upd).toMatchObject({ category: "founder_contribution", category_source: "manual" });
  });
});
