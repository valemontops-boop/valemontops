/**
 * USD for contractor payments (D085). The founders pay some contractors in USD and need the EUR they cost; nothing else
 * is converted (D082 still holds for every other currency). A rate is EUR per 1 USD, kept as an integer in millionths
 * ("micro") so conversions are exact integer maths (half away from zero, like the rest of the money code).
 *
 * Rate priority (never invented): (1) the real rate of the matching Wise payment (EUR actually debited ÷ USD sent),
 * (2) today's Wise rate (LIVE, cached once per day in UsdRates), (3) the founders' manual rate (setting
 * `usd_eur_rate_manual`), (4) in DEMO / preview only, the stored demo rate. None → "rate missing": the USD amount is
 * shown, counted, and left out of every EUR total.
 */
export const USD_RATE_SOURCES = ["bank", "wise", "manual", "demo"] as const;
export type UsdRateSource = (typeof USD_RATE_SOURCES)[number];
export const PAY_CURRENCIES = ["EUR", "USD"] as const;
export type PayCurrency = (typeof PAY_CURRENCIES)[number];

export interface UsdRate {
  /** EUR per 1 USD × 1 000 000. */
  micro: number;
  /** Day the rate applies to (YYYY-MM-DD). */
  date: string;
  source: UsdRateSource;
  /** For a "bank" rate: the Wise movement it comes from. */
  bank_tx_id?: string;
}

const MICRO = BigInt(1_000_000);
const ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2);
/** Sanity bounds for EUR per USD: anything outside is a typo (e.g. 92 instead of 0.92), not a rate. */
const MIN_MICRO = 200_000, MAX_MICRO = 5_000_000;

/** "0,92" / "0.9213" / 0.92 → 920000 (micro); null when not a plausible EUR-per-USD rate. At most 6 decimals. */
export function parseRate(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  const micro = Number(i) * 1_000_000 + Number(f.padEnd(6, "0"));
  return Number.isSafeInteger(micro) && micro >= MIN_MICRO && micro <= MAX_MICRO ? micro : null;
}

/** 920000 → "0.92" (decimal string, trailing zeros trimmed, at least 2 decimals). */
export function rateString(micro: number): string {
  const s = (micro / 1_000_000).toFixed(6).replace(/0+$/, "");
  return s.split(".")[1]?.length >= 2 ? s : Number(s).toFixed(2);
}

const divRound = (n: bigint, d: bigint) => { const q = n / d, r = n % d; return TWO * (r < ZERO ? -r : r) >= d ? q + (n < ZERO ? -ONE : ONE) : q; };

/** USD cents → EUR cents at a rate (micro), integer maths, half away from zero. */
export function usdToEur(usdMinor: number, micro: number): number {
  return Number(divRound(BigInt(Math.round(usdMinor)) * BigInt(micro), MICRO));
}

/** Effective rate of a real payment: EUR debited ÷ USD sent (both cents, sign ignored); null when not computable. */
export function effectiveRate(eurMinor: number, usdMinor: number): number | null {
  const e = Math.abs(Math.round(eurMinor)), u = Math.abs(Math.round(usdMinor));
  if (!e || !u) return null;
  const micro = Number(divRound(BigInt(e) * MICRO, BigInt(u)));
  return micro >= MIN_MICRO && micro <= MAX_MICRO ? micro : null;
}

/** A Wise movement that paid USD out of a EUR balance: its real rate (the EUR actually debited is the truth). */
export function bankUsdRate(tx: { id: string; currency: string; amount_minor: number; fx_currency?: string; fx_amount_minor?: number | null; date: string }): UsdRate | null {
  if (tx.currency.toUpperCase() !== "EUR" || (tx.fx_currency ?? "").toUpperCase() !== "USD" || !tx.fx_amount_minor) return null;
  const micro = effectiveRate(tx.amount_minor, tx.fx_amount_minor);
  return micro === null ? null : { micro, date: tx.date, source: "bank", bank_tx_id: tx.id };
}

/** Priority: matching Wise payment > today's Wise rate > manual rate > demo rate. Null = rate missing. */
export function pickUsdRate(c: { bank?: UsdRate | null; wise?: UsdRate | null; manual?: UsdRate | null; demo?: UsdRate | null }): UsdRate | null {
  return c.bank ?? c.wise ?? c.manual ?? c.demo ?? null;
}

export type ToEur = (minor: number, currency: string | undefined) => number | null;
/** EUR passes through; USD converts at the rate; USD without a rate, or any other currency, → null (left out of EUR totals). */
export function eurConverter(rate: UsdRate | null): ToEur {
  return (minor, currency) => {
    const c = (currency || "EUR").toUpperCase();
    if (c === "EUR") return minor;
    if (c === "USD" && rate) return usdToEur(minor, rate.micro);
    return null;
  };
}

/** One amount as shown in the UI: the original USD, its EUR equivalent (null = rate missing) and the rate used. */
export interface UsdView { usd_minor: number; eur_minor: number | null; rate: UsdRate | null }
export function usdView(usdMinor: number, rate: UsdRate | null): UsdView {
  return { usd_minor: usdMinor, eur_minor: rate ? usdToEur(usdMinor, rate.micro) : null, rate };
}

/** Sum amounts in EUR; USD without a rate is counted apart ("rate missing"), never guessed. */
export function sumInEur(items: { minor: number; currency: string; eur?: number | null }[], toEur: ToEur): { eur: number; missing: number; missing_usd_minor: number } {
  let eur = 0, missing = 0, missingUsd = 0;
  for (const i of items) {
    const v = i.eur !== undefined ? i.eur : toEur(i.minor, i.currency);
    if (v === null) { missing++; if (i.currency.toUpperCase() === "USD") missingUsd += i.minor; } else eur += v;
  }
  return { eur, missing, missing_usd_minor: missingUsd };
}
