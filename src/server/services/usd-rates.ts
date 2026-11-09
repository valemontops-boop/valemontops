import { z } from "zod";
import { ConflictError, type DataRepository, type Row } from "@/data/repository";
import type { FounderKey } from "@/domain/constants";
import { localDate } from "@/domain/time";
import { bankUsdRate, parseRate, pickUsdRate, rateString, type UsdRate } from "@/domain/usd";
import { childId } from "@/lib/ids";
import type { AppContext } from "../context";
import { RuleError } from "../errors";
import { recordIntegration } from "./integration-status";
import { userRow } from "./common";

/**
 * USD → EUR rates for contractor payments (D085). Order: the real rate of the matching Wise payment (per movement,
 * `bankRatesOf`), else today's Wise rate (LIVE only, `GET /v1/rates`, cached once per day in the `UsdRates` tab), else the
 * founders' manual rate (setting `usd_eur_rate_manual`), else in DEMO / preview the stored demo rate. Nothing → null:
 * "rate missing", the USD amount is left out of EUR totals. No rate is ever invented.
 */
export const MANUAL_RATE_KEY = "usd_eur_rate_manual";
const MANUAL_ID = childId("setting", MANUAL_RATE_KEY);
/** Demo / preview rate, stored in UsdRates with source "demo" by the demo seed, labelled "démo" in the UI. */
export const DEMO_USD_EUR = "0.92";
/** After a failed Wise call, wait this long before asking again (per server instance). */
const RETRY_MS = 60 * 60_000;
let lastFailure = 0;
export const _testUsd = { reset: () => { lastFailure = 0; } };

const usdRateId = (date: string, source: "wise" | "demo") => childId("usd-rate", date, source);

/** The founders' manual rate (JSON {rate, date}) with the setting row's version (0 = none yet). */
export async function manualUsdRate(repo: DataRepository, fresh = false): Promise<{ rate: UsdRate | null; version: number }> {
  const row = await repo.get("SystemSettings", MANUAL_ID, { fresh });
  if (!row || row.is_archived || !row.value) return { rate: null, version: row?.version ?? 0 };
  try {
    const v = JSON.parse(row.value) as { rate?: string; date?: string };
    const micro = parseRate(v.rate);
    if (micro === null || !/^\d{4}-\d{2}-\d{2}$/.test(v.date ?? "")) return { rate: null, version: row.version };
    return { rate: { micro, date: v.date!, source: "manual" }, version: row.version };
  } catch {
    return { rate: null, version: row.version };
  }
}

function rowRate(r: Row<"UsdRates"> | null | undefined): UsdRate | null {
  if (!r || r.is_archived) return null;
  const micro = parseRate(r.rate);
  return micro === null ? null : { micro, date: r.date, source: r.source };
}

/** Today's Wise rate: from the UsdRates cache, else fetched once (LIVE with the Wise token only), else null. */
export async function wiseUsdRate(ctx: AppContext, today: string, now = Date.now()): Promise<{ rate: UsdRate | null; status: "ok" | "failed" | "not_configured" | "demo" }> {
  if (ctx.mode !== "live") return { rate: null, status: "demo" };
  const id = usdRateId(today, "wise");
  const cached = rowRate(await ctx.repo.get("UsdRates", id));
  if (cached) return { rate: cached, status: "ok" };
  if (!ctx.bank?.rate) return { rate: null, status: "not_configured" };
  if (now - lastFailure < RETRY_MS) return { rate: null, status: "failed" };
  try {
    const r = await ctx.bank.rate("USD", "EUR");
    const micro = parseRate(r.rate.toFixed(6));
    if (micro === null) throw new Error("Wise returned an implausible USD/EUR rate");
    // Another request (or the other founder) may have stored it meanwhile: same id, so a race at most duplicates a row read once.
    const again = rowRate(await ctx.repo.get("UsdRates", id, { fresh: true }));
    if (again) return { rate: again, status: "ok" };
    await ctx.repo.insert("UsdRates", [{ id, date: today, rate: rateString(micro), source: "wise" }], { founder: "system" });
    await recordIntegration(ctx.repo, "wise_rates", true);
    return { rate: { micro, date: today, source: "wise" }, status: "ok" };
  } catch (e) {
    lastFailure = now;
    await recordIntegration(ctx.repo, "wise_rates", false, (e as Error).message || "Wise rate unavailable");
    return { rate: null, status: "failed" };
  }
}

/** The demo rate (DEMO / preview only): the newest UsdRates row with source "demo". */
async function demoUsdRate(ctx: AppContext): Promise<UsdRate | null> {
  if (ctx.mode !== "demo") return null;
  const rows = (await ctx.repo.list("UsdRates")).rows.filter((r) => !r.is_archived && r.source === "demo").sort((a, b) => b.date.localeCompare(a.date));
  return rowRate(rows[0]);
}

/** The rate for an amount not (yet) tied to a Wise payment: Wise today > manual > demo. */
export async function currentUsdRate(ctx: AppContext, today: string) {
  const wise = await wiseUsdRate(ctx, today);
  const manual = await manualUsdRate(ctx.repo);
  const demo = await demoUsdRate(ctx);
  return { rate: pickUsdRate({ wise: wise.rate, manual: manual.rate, demo }), wise_status: wise.status, manual: manual.rate, manual_version: manual.version };
}

/** Real rates of Wise payments made in USD from a EUR balance, by movement id. */
export function bankRatesOf(rows: Row<"BankTransactions">[]): Map<string, UsdRate> {
  const out = new Map<string, UsdRate>();
  for (const t of rows) {
    if (t.is_archived) continue;
    const r = bankUsdRate(t);
    if (r) out.set(t.id, r);
  }
  return out;
}

/** Wise payments sent in USD (to link a project cost or a manual entry to the real payment). Newest first, at most 50. */
export function usdPayments(rows: Row<"BankTransactions">[]) {
  const rates = bankRatesOf(rows);
  return rows.filter((t) => rates.has(t.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map((t) => ({
    id: t.id, date: t.date, label: t.counterparty || t.description, eur_minor: Math.abs(t.amount_minor), usd_minor: t.fx_amount_minor ?? 0, rate: rates.get(t.id)!,
  }));
}

/** What Money and Clients show about the USD rate: the rate in use, the manual one (with its version) and the Wise payments in USD. */
export async function usdRateOverview(ctx: AppContext, founder: FounderKey) {
  const today = localDate(new Date(), (await userRow(ctx.repo, founder)).timezone);
  const cur = await currentUsdRate(ctx, today);
  const tx = (await ctx.repo.list("BankTransactions")).rows;
  return { today, mode: ctx.mode, current: cur.rate, wise_status: cur.wise_status, manual: cur.manual, manual_version: cur.manual_version, payments: usdPayments(tx) };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const manualRateSchema = z.object({
  /** EUR per 1 USD, as on the bank's or Wise's screen ("0,92"). */
  rate: z.string().trim().max(20).refine((s) => parseRate(s) !== null, "Rate looks wrong: EUR for 1 USD, e.g. 0,92"),
  date: day,
  expected_version: z.number().int().min(0),
});
/** Save the founders' manual rate (version-checked: 409 when the other founder changed it meanwhile). */
export async function saveManualRate(ctx: AppContext, founder: FounderKey, i: z.infer<typeof manualRateSchema>) {
  const micro = parseRate(i.rate);
  if (micro === null) throw new RuleError("Rate looks wrong: EUR for 1 USD, e.g. 0,92");
  const value = JSON.stringify({ rate: rateString(micro), date: i.date });
  const cur = await ctx.repo.get("SystemSettings", MANUAL_ID, { fresh: true });
  if (!cur) {
    if (i.expected_version !== 0) throw new ConflictError("SystemSettings", MANUAL_ID, i.expected_version, null);
    await ctx.repo.insert("SystemSettings", [{ id: MANUAL_ID, key: MANUAL_RATE_KEY, value, description: "Manual USD→EUR rate (EUR for 1 USD) and its date, JSON. Used only when no Wise rate is available (D085)." }], { founder });
  } else {
    if (i.expected_version === 0) throw new ConflictError("SystemSettings", MANUAL_ID, 0, cur as unknown as Record<string, unknown>);
    await ctx.repo.update("SystemSettings", MANUAL_ID, i.expected_version, { value }, { founder });
  }
  return { rate: { micro, date: i.date, source: "manual" as const } };
}

/** DEMO seed: the stored demo rate (labelled "démo"); never used in LIVE. */
export async function seedDemoUsdRate(repo: DataRepository, today: string) {
  const id = usdRateId(today, "demo");
  if (await repo.get("UsdRates", id, { fresh: true })) return;
  await repo.insert("UsdRates", [{ id, date: today, rate: DEMO_USD_EUR, source: "demo" }], { founder: "system" });
}
