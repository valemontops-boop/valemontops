import Papa from "papaparse";
import { z } from "zod";
import type { Row } from "@/data/repository";
import { ScaRequiredError, type BankTx } from "@/data/bank/wise";
import { childId } from "@/lib/ids";
import { BANK_CATEGORIES, autoCategory, moneySummary, parseWiseCsv } from "@/domain/bank";
import type { FounderKey } from "@/domain/constants";
import { localDate } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { userRow } from "./common";

const SYSTEM = { founder: "system" };
type Actor = { founder: string };
const STATUS_ID = childId("integration", "wise");

async function setStatus(ctx: AppContext, status: string, error = "", actor: Actor = SYSTEM) {
  const cur = await ctx.repo.get("IntegrationStatuses", STATUS_ID, { fresh: true });
  const patch = { status, last_error: error.slice(0, 500), ...(status === "ok" ? { last_success_at: new Date().toISOString() } : {}) };
  if (cur) await ctx.repo.update("IntegrationStatuses", STATUS_ID, cur.version, patch, actor);
  else await ctx.repo.insert("IntegrationStatuses", [{ id: STATUS_ID, integration: "wise", last_success_at: null, ...patch }], actor);
}

const txRow = (src: { source_id: string; origin: "api" | "webhook" | "csv" | "demo"; balance_id: string; currency: string; amount_minor: number; fee_minor: number | null; occurred_at: string; description: string; counterparty: string; bank_type: string; merchant_category: string; running_balance_minor: number | null }, tz: string) => {
  const direction = src.amount_minor >= 0 ? ("credit" as const) : ("debit" as const);
  return {
    id: childId("wise-tx", src.source_id), bank: "wise" as const, ...src, direction, date: localDate(new Date(src.occurred_at), tz), note: "",
    category: autoCategory({ direction, bank_type: src.bank_type, description: src.description, counterparty: src.counterparty, merchant_category: src.merchant_category }), category_source: "auto" as const,
  };
};
const signed = (t: BankTx) => (t.direction === "credit" ? Math.abs(t.amount_minor) : -Math.abs(t.amount_minor));

/** A live (webhook) row and a statement row for the same movement: same balance and amount, within 15 minutes. */
function sameMovement(a: { balance_id: string; amount_minor: number; occurred_at: string }, b: { balance_id: string; amount_minor: number; occurred_at: string }) {
  return a.balance_id === b.balance_id && a.amount_minor === b.amount_minor && Math.abs(Date.parse(a.occurred_at) - Date.parse(b.occurred_at)) <= 15 * 60_000;
}

/**
 * Pulls balances and statements from Wise into Sheets. Idempotent: a movement is keyed by Wise's reference
 * number; a row first seen live (webhook) is completed instead of duplicated.
 */
export async function syncBank(ctx: AppContext, actor: Actor = SYSTEM, days = 90) {
  if (!ctx.bank) throw new RuleError("Wise is not connected. Add WISE_API_TOKEN (see docs/INTEGRATIONS.md).");
  const tz = (await userRow(ctx.repo, "theo").catch(() => null))?.timezone ?? "Europe/Paris";
  const t = await ctx.repo.listMany(["BankTransactions", "BankBalances"], { fresh: true });
  const profile = await ctx.bank.profileId();
  const balances = await ctx.bank.balances(profile);
  const now = new Date();
  for (const b of balances) {
    const id = childId("wise-balance", b.id);
    const cur = t.BankBalances.rows.find((x) => x.id === id);
    const v = { bank: "wise" as const, balance_id: b.id, currency: b.currency, name: b.name, amount_minor: b.amount_minor, as_of: now.toISOString() };
    if (cur) { if (cur.amount_minor !== b.amount_minor || cur.name !== b.name) await ctx.repo.update("BankBalances", id, cur.version, v, actor); }
    else await ctx.repo.insert("BankBalances", [{ id, ...v }], actor);
  }
  let added = 0, sca = false;
  for (const b of balances) {
    const mine = t.BankTransactions.rows.filter((r) => r.balance_id === b.id && r.origin !== "webhook");
    const last = mine.map((r) => r.occurred_at).sort().at(-1);
    const from = last ? new Date(Date.parse(last) - 3 * 86_400_000) : new Date(now.getTime() - days * 86_400_000);
    let txs: BankTx[];
    try {
      txs = await ctx.bank.statement(profile, b.id, b.currency, from.toISOString(), now.toISOString());
    } catch (e) {
      if (e instanceof ScaRequiredError) { sca = true; continue; }
      throw e;
    }
    const rows = t.BankTransactions.rows;
    const fresh: ReturnType<typeof txRow>[] = [];
    for (const x of txs) {
      if (!x.referenceNumber) continue;
      const r = txRow({ source_id: x.referenceNumber, origin: "api", balance_id: b.id, currency: x.currency || b.currency, amount_minor: signed(x), fee_minor: x.fee_minor, occurred_at: x.occurred_at, description: x.description, counterparty: x.counterparty, bank_type: x.detailsType, merchant_category: x.merchantCategory, running_balance_minor: x.running_balance_minor }, tz);
      if (rows.some((y) => y.id === r.id) || fresh.some((y) => y.id === r.id)) continue;
      const live = rows.find((y) => y.origin === "webhook" && !y.is_archived && sameMovement(y, r));
      if (live) {
        await ctx.repo.update("BankTransactions", live.id, live.version, { source_id: r.source_id, origin: "api", description: r.description, counterparty: r.counterparty, bank_type: r.bank_type, merchant_category: r.merchant_category, fee_minor: r.fee_minor, running_balance_minor: r.running_balance_minor, ...(live.category_source === "auto" ? { category: r.category } : {}) }, actor);
        continue;
      }
      fresh.push(r);
    }
    if (fresh.length) { await ctx.repo.insert("BankTransactions", fresh, actor); added += fresh.length; }
  }
  await setStatus(ctx, sca ? "sca_required" : "ok", sca ? "Statements need strong authentication" : "", actor);
  return { balances: balances.length, added, sca };
}

/** Wise webhook `balances#update` / `balances#credit`: one movement, recorded at once (live view). */
export const wiseEventSchema = z.object({
  event_type: z.string(),
  data: z.object({
    resource: z.object({ id: z.union([z.string(), z.number()]).optional(), profile_id: z.union([z.string(), z.number()]).optional() }).partial().optional(),
    balance_id: z.union([z.string(), z.number()]).optional(),
    amount: z.number(),
    currency: z.string().length(3),
    transaction_type: z.string().optional(),
    occurred_at: z.string(),
    post_transaction_balance_amount: z.number().optional(),
    channel_name: z.string().optional(),
    transfer_reference: z.string().optional(),
  }).passthrough(),
}).passthrough();

export async function applyWiseEvent(ctx: AppContext, ev: z.infer<typeof wiseEventSchema>) {
  if (!["balances#update", "balances#credit"].includes(ev.event_type)) return { ignored: true };
  const d = ev.data;
  const balanceId = String(d.balance_id ?? d.resource?.id ?? "");
  const debit = (d.transaction_type ?? (ev.event_type === "balances#credit" ? "credit" : "")).toLowerCase() === "debit";
  const amount = Math.round(Math.abs(d.amount) * 100) * (debit ? -1 : 1);
  const occurred = new Date(d.occurred_at).toISOString();
  const tz = (await userRow(ctx.repo, "theo").catch(() => null))?.timezone ?? "Europe/Paris";
  const t = await ctx.repo.listMany(["BankTransactions", "BankBalances"], { fresh: true });
  const r = txRow({ source_id: `wh:${balanceId}:${occurred}:${amount}`, origin: "webhook", balance_id: balanceId, currency: d.currency, amount_minor: amount, fee_minor: null, occurred_at: occurred, description: d.transfer_reference ?? d.channel_name ?? "", counterparty: "", bank_type: d.channel_name ?? "", merchant_category: "", running_balance_minor: d.post_transaction_balance_amount !== undefined ? Math.round(d.post_transaction_balance_amount * 100) : null }, tz);
  const known = t.BankTransactions.rows.find((y) => y.id === r.id || (y.origin === "api" && sameMovement(y, r)));
  if (!known) await ctx.repo.insert("BankTransactions", [r], SYSTEM);
  if (d.post_transaction_balance_amount !== undefined && balanceId) {
    const id = childId("wise-balance", balanceId);
    const cur = t.BankBalances.rows.find((x) => x.id === id);
    const v = { amount_minor: Math.round(d.post_transaction_balance_amount * 100), as_of: occurred };
    if (cur && cur.as_of <= occurred) await ctx.repo.update("BankBalances", id, cur.version, v, SYSTEM);
    else if (!cur) await ctx.repo.insert("BankBalances", [{ id, bank: "wise", balance_id: balanceId, currency: d.currency, name: "", ...v }], SYSTEM);
  }
  return { recorded: !known };
}

export const csvSchema = z.object({ csv: z.string().min(10).max(3_000_000) });
/** Wise CSV statement export (fallback when the API statement needs strong authentication). Re-importing adds nothing. */
export async function importBankCsv(ctx: AppContext, founder: FounderKey, input: z.infer<typeof csvSchema>) {
  const parsed = Papa.parse<Record<string, string>>(input.csv.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const { rows, errors } = parseWiseCsv(parsed.data);
  const u = await userRow(ctx.repo, founder);
  const t = await ctx.repo.list("BankTransactions", { fresh: true });
  const fresh = rows.map((x) => txRow({ ...x, origin: "csv", balance_id: `csv-${x.currency}`, occurred_at: `${x.date}T12:00:00.000Z` }, u.timezone)).filter((r, i, all) => !t.rows.some((y) => y.id === r.id) && all.findIndex((z) => z.id === r.id) === i);
  if (fresh.length) await ctx.repo.insert("BankTransactions", fresh, { founder });
  return { added: fresh.length, skipped: rows.length - fresh.length, errors };
}

export const categorySchema = z.object({ id: z.string().uuid(), expected_version: z.number().int().min(1), category: z.enum(BANK_CATEGORIES), note: z.string().trim().max(500).optional() });
export async function setCategory(ctx: AppContext, founder: FounderKey, input: z.infer<typeof categorySchema>) {
  return ctx.repo.update("BankTransactions", input.id, input.expected_version, { category: input.category, category_source: "manual", ...(input.note !== undefined ? { note: input.note } : {}) }, { founder });
}

/** The Money page: balances now, this month and 6 months of income vs expenses, latest movements. Syncs if stale. */
export async function moneyOverview(ctx: AppContext, founder: FounderKey) {
  let syncError: string | null = null;
  if (ctx.bank) {
    const st = await ctx.repo.get("IntegrationStatuses", STATUS_ID);
    const stale = !st?.last_success_at || Date.now() - Date.parse(st.last_success_at) > 15 * 60_000;
    if (stale) { try { await syncBank(ctx, { founder }); } catch (e) { syncError = (e as Error).message; } }
  }
  const t = await ctx.repo.listMany(["BankTransactions", "BankBalances", "IntegrationStatuses"]);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const balances = t.BankBalances.rows.filter((b) => !b.is_archived).sort((a, b) => b.amount_minor - a.amount_minor);
  const status = t.IntegrationStatuses.rows.find((r) => r.id === STATUS_ID) ?? null;
  const rows = t.BankTransactions.rows.filter((r) => !r.is_archived);
  return {
    connected: Boolean(ctx.bank), status: status?.status ?? null, lastSync: status?.last_success_at ?? null, syncError,
    balances: balances.map((b) => ({ currency: b.currency, amount_minor: b.amount_minor, name: b.name, as_of: b.as_of })),
    summary: moneySummary(rows, "EUR", today),
    transactions: rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 80) as Row<"BankTransactions">[],
  };
}
