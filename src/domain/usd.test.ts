import { describe, expect, it } from "vitest";
import { bankUsdRate, effectiveRate, eurConverter, parseRate, pickUsdRate, rateString, sumInEur, usdToEur, usdView } from "./usd";

describe("USD → EUR conversion (D085)", () => {
  it("parses a founder-typed rate and refuses typos", () => {
    expect(parseRate("0,92")).toBe(920_000);
    expect(parseRate("0.921345")).toBe(921_345);
    expect(parseRate(0.92)).toBe(920_000);
    expect(parseRate("92")).toBeNull(); // EUR per USD cannot be 92
    expect(parseRate("0.9213456")).toBeNull(); // more than 6 decimals
    expect(parseRate("")).toBeNull();
    expect(parseRate("abc")).toBeNull();
    expect(rateString(920_000)).toBe("0.92");
    expect(rateString(921_345)).toBe("0.921345");
  });
  it("converts with integer maths, half away from zero", () => {
    expect(usdToEur(120000, 920_000)).toBe(110400); // 1 200 $ ≈ 1 104 €
    expect(usdToEur(1, 925_000)).toBe(1); // 0.925 → 1
    expect(usdToEur(-1, 925_000)).toBe(-1);
    expect(usdToEur(1, 400_000)).toBe(0);
    expect(usdToEur(10_000_000_000, 1_234_567)).toBe(12_345_670_000); // no float drift on large amounts
  });
  it("takes the real rate of a Wise payment from the EUR debited and the USD sent", () => {
    expect(effectiveRate(-30000, 32600)).toBe(920_245);
    expect(effectiveRate(0, 100)).toBeNull();
    const tx = { id: "t1", currency: "EUR", amount_minor: -30000, fx_currency: "USD", fx_amount_minor: 32600, date: "2026-10-28" };
    expect(bankUsdRate(tx)).toEqual({ micro: 920_245, date: "2026-10-28", source: "bank", bank_tx_id: "t1" });
    expect(bankUsdRate({ ...tx, fx_currency: "" })).toBeNull();
    expect(bankUsdRate({ ...tx, currency: "USD" })).toBeNull();
  });
  it("picks the rate by priority: Wise payment > Wise today > manual > demo", () => {
    const bank = { micro: 920_245, date: "2026-10-28", source: "bank" as const };
    const wise = { micro: 930_000, date: "2026-11-09", source: "wise" as const };
    const manual = { micro: 900_000, date: "2026-11-01", source: "manual" as const };
    const demo = { micro: 920_000, date: "2026-11-09", source: "demo" as const };
    expect(pickUsdRate({ bank, wise, manual, demo })).toBe(bank);
    expect(pickUsdRate({ bank: null, wise, manual, demo })).toBe(wise);
    expect(pickUsdRate({ wise: null, manual, demo })).toBe(manual);
    expect(pickUsdRate({ demo })).toBe(demo);
    expect(pickUsdRate({})).toBeNull();
  });
  it("excludes USD without a rate from EUR totals and never converts other currencies", () => {
    const none = eurConverter(null);
    expect(none(5000, "EUR")).toBe(5000);
    expect(none(5000, "USD")).toBeNull();
    expect(eurConverter({ micro: 920_000, date: "2026-11-09", source: "manual" })(5000, "GBP")).toBeNull();
    expect(sumInEur([{ minor: 1000, currency: "EUR" }, { minor: 2000, currency: "USD" }, { minor: 3000, currency: "USD", eur: 2700 }], none)).toEqual({ eur: 3700, missing: 1, missing_usd_minor: 2000 });
    expect(usdView(120000, null)).toEqual({ usd_minor: 120000, eur_minor: null, rate: null });
  });
});
