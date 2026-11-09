/**
 * EUR/USD (and other currencies) with ECB reference rates (spec 3.12, 4.6, 5.10). Pure functions, integer maths:
 * a rate is "1 EUR = rate × currency" kept as a decimal string (never a binary float) and scaled by 10^6.
 * No rate is ever invented: a missing rate is an explicit NoRateError.
 */
export interface FxRate { quote: string; rate: string; rate_date: string; source: "ecb" | "manual" | "demo"; created_at?: string }

export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_HIST_90_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
export const ECB_HIST_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
/** ECB publishes on TARGET business days: a rate up to this many days old is "the last published rate" (weekends, holidays). */
export const MAX_RATE_AGE_DAYS = 7;
const SCALE = 1_000_000;
const RATE = /^\d{1,6}(\.\d{1,6})?$/;

export class NoRateError extends Error {
  readonly code = "no_rate";
  constructor(readonly currency: string, readonly date: string) {
    super(`No ECB rate for ${currency} on ${date}. Retry later or enter the rate by hand.`);
  }
}

export const isRate = (s: string) => RATE.test(s.trim()) && scaled(s) > 0;
/** "1.1000" → 1_100_000. */
export function scaled(rate: string): number {
  const [i, f = ""] = rate.trim().split(".");
  return Number(i) * SCALE + Number((f + "000000").slice(0, 6));
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const PRIORITY: Record<FxRate["source"], number> = { ecb: 0, manual: 1, demo: 2 };

/**
 * Rate applicable on `date`: the latest publication on or before it, at most MAX_RATE_AGE_DAYS old, ECB first, then a
 * founder's manual rate, then a labelled demo rate; on the same date the earliest row wins (cached rates never change).
 */
export function rateOn(rates: FxRate[], currency: string, date: string): FxRate {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return { quote: "EUR", rate: "1", rate_date: date, source: "ecb" };
  const best = rates
    .filter((r) => r.quote.toUpperCase() === cur && r.rate_date <= date && daysBetween(r.rate_date, date) <= MAX_RATE_AGE_DAYS && isRate(r.rate))
    .sort((a, b) => b.rate_date.localeCompare(a.rate_date) || PRIORITY[a.source] - PRIORITY[b.source] || (a.created_at ?? "").localeCompare(b.created_at ?? ""))[0];
  if (!best) throw new NoRateError(cur, date);
  return best;
}
/** Latest known rate whatever its age (for the reporting toggle), or null. */
export function latestRate(rates: FxRate[], currency: string): FxRate | null {
  const all = rates.filter((r) => r.quote.toUpperCase() === currency.toUpperCase() && isRate(r.rate)).sort((a, b) => b.rate_date.localeCompare(a.rate_date) || PRIORITY[a.source] - PRIORITY[b.source]);
  return all[0] ?? null;
}

/** Half away from zero, on integers. */
function div(n: number, d: number) {
  const s = Math.sign(n) * Math.sign(d);
  const a = Math.abs(n), b = Math.abs(d);
  return s * Math.floor((2 * a + b) / (2 * b));
}
/** Amount in `currency` minor units → EUR minor units with this rate. */
export function toEur(amountMinor: number, currency: string, rate: Pick<FxRate, "rate">): number {
  if (currency.toUpperCase() === "EUR") return amountMinor;
  return div(amountMinor * SCALE, scaled(rate.rate));
}
/** EUR minor units → `rate`'s currency (reporting conversion, never a restatement of the stored amount). */
export function fromEur(eurMinor: number, rate: Pick<FxRate, "rate">): number {
  return div(eurMinor * scaled(rate.rate), SCALE);
}

/** ECB XML (daily, 90 days or full history) → rates. Only the currencies asked for when `only` is given. */
export function parseEcbXml(xml: string, only?: string[]): Omit<FxRate, "source">[] {
  const out: Omit<FxRate, "source">[] = [];
  const want = only ? new Set(only.map((c) => c.toUpperCase())) : null;
  const dayRe = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
  for (const m of xml.matchAll(dayRe)) {
    for (const r of m[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/>/g)) {
      if (want && !want.has(r[1])) continue;
      if (!isRate(r[2])) continue;
      out.push({ quote: r[1], rate: r[2], rate_date: m[1] });
    }
  }
  return out;
}
