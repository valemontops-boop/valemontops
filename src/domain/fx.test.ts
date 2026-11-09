import { describe, expect, it } from "vitest";
import { NoRateError, fromEur, latestRate, parseEcbXml, rateOn, scaled, toEur, type FxRate } from "./fx";

const FIXTURE: FxRate[] = [{ quote: "USD", rate: "1.1000", rate_date: "2026-11-06", source: "demo" }];

describe("FX with ECB reference rates (spec 3.12, scenario 9)", () => {
  it("converts EUR 99.00 to USD 108.90 for display without touching the stored minor units", () => {
    const stored = 9900;
    const r = rateOn(FIXTURE, "USD", "2026-11-09");
    expect(fromEur(stored, r)).toBe(10890);
    expect(r.rate_date).toBe("2026-11-06"); // weekend: the last published rate, with its real date
    expect(stored).toBe(9900);
    expect(toEur(10890, "USD", r)).toBe(9900);
  });
  it("uses integer maths with half-away-from-zero rounding, never floats on money", () => {
    expect(scaled("1.0812")).toBe(1_081_200);
    expect(toEur(100, "USD", { rate: "1.0812" })).toBe(92);
    expect(toEur(-100, "USD", { rate: "1.0812" })).toBe(-92);
    expect(toEur(1234, "EUR", { rate: "9" })).toBe(1234);
  });
  it("never invents a rate: none known, or only an old one, is an explicit failure", () => {
    expect(() => rateOn([], "USD", "2026-11-09")).toThrow(NoRateError);
    expect(() => rateOn(FIXTURE, "USD", "2026-11-20")).toThrow(NoRateError);
    expect(() => rateOn(FIXTURE, "USD", "2026-11-05")).toThrow(NoRateError);
    expect(() => rateOn(FIXTURE, "GBP", "2026-11-06")).toThrow(NoRateError);
  });
  it("prefers an ECB rate over a manual or demo rate on the same date; latestRate ignores age", () => {
    const rates: FxRate[] = [...FIXTURE, { quote: "USD", rate: "1.0900", rate_date: "2026-11-06", source: "ecb" }, { quote: "USD", rate: "1.2", rate_date: "2026-11-06", source: "manual" }];
    expect(rateOn(rates, "USD", "2026-11-06").rate).toBe("1.0900");
    expect(latestRate(FIXTURE, "USD")?.rate).toBe("1.1000");
  });
  it("parses the ECB daily and history XML", () => {
    const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-06'><Cube currency='USD' rate='1.0812'/><Cube currency='JPY' rate='163.20'/></Cube><Cube time="2026-11-05"><Cube currency="USD" rate="1.0790"/></Cube></Cube></gesmes:Envelope>`;
    expect(parseEcbXml(xml, ["USD"])).toEqual([{ quote: "USD", rate: "1.0812", rate_date: "2026-11-06" }, { quote: "USD", rate: "1.0790", rate_date: "2026-11-05" }]);
    expect(parseEcbXml(xml)).toHaveLength(3);
  });
});
