import { describe, expect, it } from "vitest";
import {
  POLICY_SEED, approvalError, effectiveStatus, eur, latestByKey, missingForPdf, policyCheck, quoteReference, quoteTotals, resolveTax, type LineInput,
} from "./quotes";
import { auditSummary, auditTemplateSeeds } from "./audit";
import { PRICE_BOOK_SEEDS, defaultBilling } from "./price-book";

const line = (p: Partial<LineInput>): LineInput => ({ billing: "one_time", quantity_x100: 100, unit_price_minor: 0, list_unit_price_minor: null, discount_bp: 0, est_hours_x100: 0, direct_cost_minor: 0, ...p });
const local = [line({ billing: "one_time", unit_price_minor: 49_000 }), line({ billing: "monthly", unit_price_minor: 9_900 })];

describe("quote totals (scenario 6)", () => {
  it("separates one-off and MRR; first-year value 1,678 € only with a 12-month term", () => {
    const t = quoteTotals({ discount_bp: 0, term_months: 12, contingency_bp: 0 }, local, 3_000);
    expect(t.oneOffMinor).toBe(49_000);
    expect(t.mrrMinor).toBe(9_900);
    expect(t.firstYearMinor).toBe(167_800);
  });
  it("shows no first-year sum with no term or a shorter term", () => {
    expect(quoteTotals({ discount_bp: 0, term_months: null, contingency_bp: 0 }, local, 3_000).firstYearMinor).toBeNull();
    expect(quoteTotals({ discount_bp: 0, term_months: 6, contingency_bp: 0 }, local, 3_000).firstYearMinor).toBeNull();
    expect(quoteTotals({ discount_bp: 0, term_months: 24, contingency_bp: 0 }, local, 3_000).firstYearMinor).toBe(167_800);
  });
  it("never puts a set-up fee into MRR", () => {
    const t = quoteTotals({ discount_bp: 0, term_months: 12, contingency_bp: 0 }, [line({ billing: "one_time", unit_price_minor: 19_000 }), line({ billing: "monthly", unit_price_minor: 5_900 })], 3_000);
    expect(t.mrrMinor).toBe(5_900);
    expect(t.oneOffMinor).toBe(19_000);
  });
  it("applies quantity, line and quote discounts in cents", () => {
    const t = quoteTotals({ discount_bp: 1_000, term_months: null, contingency_bp: 0 }, [line({ quantity_x100: 250, unit_price_minor: 8_000, discount_bp: 500 })], 0);
    // 2.5 × 80 = 200 € − 5 % = 190 € − 10 % = 171 €
    expect(t.oneOffMinor).toBe(17_100);
  });
  it("computes delivery cost (hours × hour cost + direct costs + contingency) and gross margin", () => {
    const t = quoteTotals({ discount_bp: 0, term_months: null, contingency_bp: 1_000 }, [
      line({ unit_price_minor: 150_000, est_hours_x100: 2_000, direct_cost_minor: 10_000 }),
      line({ billing: "monthly", unit_price_minor: 10_000, direct_cost_minor: 3_700 }),
    ], 3_000);
    // one-off: 20 h × 30 € + 100 € = 700 € + 10 % = 770 €; margin 730 € / 1 500 € = 48.67 %
    expect(t.oneOffCostMinor).toBe(77_000);
    expect(t.oneOffMarginMinor).toBe(73_000);
    expect(t.oneOffMarginBp).toBe(4_867);
    expect(t.monthlyCostMinor).toBe(4_070);
    expect(t.monthlyMarginBp).toBe(5_930);
  });
  it("measures the discount against list prices (founder-entered lines never look discounted)", () => {
    const t = quoteTotals({ discount_bp: 0, term_months: null, contingency_bp: 0 }, [line({ billing: "monthly", unit_price_minor: 8_000, list_unit_price_minor: 10_000 }), line({ unit_price_minor: 50_000 })], 0);
    expect(t.discountBp).toBe(2_000);
  });
});

describe("commercial policy", () => {
  const base = { discount_bp: 0, term_months: null, contingency_bp: 0 };
  it("lets anyone approve inside the policy", () => {
    const c = policyCheck(quoteTotals(base, [line({ unit_price_minor: 100_000 })], 0), POLICY_SEED);
    expect(c).toMatchObject({ requiresOtherFounder: false, forbidden: false });
    expect(approvalError(c, "theo", "theo", "")).toBeNull();
  });
  it("a discount beyond the free band needs the other founder and a recorded trade", () => {
    const c = policyCheck(quoteTotals(base, [line({ unit_price_minor: 8_000, list_unit_price_minor: 10_000 })], 0), POLICY_SEED);
    expect(c.requiresOtherFounder).toBe(true);
    expect(approvalError(c, "theo", "theo", "12-month term")).toMatch(/other founder/);
    expect(approvalError(c, "theo", "pablo", "")).toMatch(/trade/);
    expect(approvalError(c, "theo", "pablo", "12-month commitment and a case study")).toBeNull();
  });
  it("a discount beyond the last band is forbidden", () => {
    const c = policyCheck(quoteTotals(base, [line({ unit_price_minor: 5_000, list_unit_price_minor: 10_000 })], 0), POLICY_SEED);
    expect(c.forbidden).toBe(true);
    expect(approvalError(c, "theo", "pablo", "anything")).toMatch(/cannot be approved/);
  });
  it("a margin below the guardrail needs the other founder", () => {
    const c = policyCheck(quoteTotals(base, [line({ unit_price_minor: 50_000, est_hours_x100: 1_500 })], 3_000), POLICY_SEED);
    // 15 h × 30 € = 450 € cost on 500 €: 10 % margin < 40 %
    expect(c.requiresOtherFounder).toBe(true);
    expect(c.reasons[0].key).toMatch(/guardrail/);
  });
});

describe("taxes by jurisdiction", () => {
  const totals = { oneOffMinor: 49_000, mrrMinor: 9_900 };
  it("applies the confirmed domestic rate", () => {
    const fr = resolveTax(POLICY_SEED.taxRules, "FR", "FR", totals);
    expect(fr).toMatchObject({ ok: true, oneOffTaxMinor: 9_800, mrrTaxMinor: 1_980 });
    const es = resolveTax(POLICY_SEED.taxRules, "ES", "ES", totals);
    expect(es).toMatchObject({ ok: true, oneOffTaxMinor: 10_290, mrrTaxMinor: 2_079 });
  });
  it("blocks cross-border VAT instead of guessing", () => {
    expect(resolveTax(POLICY_SEED.taxRules, "FR", "ES", totals)).toEqual({ ok: false, reason: "no_rule" });
    expect(resolveTax(POLICY_SEED.taxRules, "", "FR", totals)).toEqual({ ok: false, reason: "seller_country_missing" });
    expect(resolveTax(POLICY_SEED.taxRules, "FR", "", totals)).toEqual({ ok: false, reason: "client_country_missing" });
  });
});

describe("references, status, required fields", () => {
  it("derives a human-readable reference from the UUID, never a sequence", () => {
    expect(quoteReference("3f2a9c1b-0000-4000-8000-000000000000", 2)).toBe("VAL-3F2A9C1B-V2");
  });
  it("derives expiry at read time", () => {
    expect(effectiveStatus({ status: "sent", valid_until: "2026-11-01" }, "2026-11-09")).toBe("expired");
    expect(effectiveStatus({ status: "approved", valid_until: "2026-11-09" }, "2026-11-09")).toBe("approved");
    expect(effectiveStatus({ status: "accepted", valid_until: "2026-11-01" }, "2026-11-09")).toBe("accepted");
    expect(effectiveStatus({ status: "draft", valid_until: "2026-11-01" }, "2026-11-09")).toBe("draft");
  });
  it("names each missing required field and never fills a placeholder", () => {
    const m = missingForPdf({ legal_name: "Valemont SAS", legal_form: "", address: "x", seller_country: "FR", company_id: "", vat_number: "v" }, { valid_until: null, payment_terms: "", client_country: "FR" }, "Client", []);
    expect(m).toEqual(["legal_form", "company_id", "valid_until", "payment_terms", "lines"]);
    expect(missingForPdf({ legal_name: "a", legal_form: "b", address: "c", seller_country: "FR", company_id: "d", vat_number: "e" }, { valid_until: "2026-12-01", payment_terms: "30 j", client_country: "FR" }, "Client", [{ unit_price_minor: 1, quantity_x100: 100 }])).toEqual([]);
  });
  it("formats euros per document language without unprintable spaces", () => {
    expect(eur(167_800, "FR")).toBe("1 678,00 €");
    expect(eur(9_900, "ES")).toBe("99,00 €");
  });
  it("versions by effective date: the latest row up to the date wins", () => {
    const rows = [
      { k: "a", effective_from: "2000-01-01", created_at: "2026-01-01T00:00:00Z", is_archived: false, v: 1 },
      { k: "a", effective_from: "2026-11-01", created_at: "2026-10-01T00:00:00Z", is_archived: false, v: 2 },
      { k: "a", effective_from: "2026-12-01", created_at: "2026-10-02T00:00:00Z", is_archived: false, v: 3 },
    ];
    expect(latestByKey(rows, (r) => r.k, "2026-11-09").get("a")?.v).toBe(2);
    expect(latestByKey(rows, (r) => r.k, "2026-12-01").get("a")?.v).toBe(3);
  });
});

describe("price book seeds (founder decisions D073/D074)", () => {
  it("Local Essential: no set-up fee, 100 €/month, linked to the Local price setting", () => {
    const l = PRICE_BOOK_SEEDS.find((s) => s.item_key === "local_essential")!;
    expect([l.one_time_min_minor, l.monthly_min_minor, l.price_setting_key]).toEqual([0, 10_000, "offer_local_monthly_eur"]);
    expect(defaultBilling(l)).toBe("monthly");
  });
  it("Consulting is founder-entered (default from the Consulting value setting); 30/30 is a 39 € one-time product", () => {
    const c = PRICE_BOOK_SEEDS.find((s) => s.item_key === "consulting_mission")!;
    expect([c.price_mode, c.price_setting_key]).toEqual(["founder_entered", "offer_consulting_value_eur"]);
    const t = PRICE_BOOK_SEEDS.find((s) => s.item_key === "thirty_report")!;
    expect([t.one_time_min_minor, t.monthly_min_minor, defaultBilling(t)]).toEqual([3_900, 0, "one_time"]);
    expect(PRICE_BOOK_SEEDS.every((s) => s.pilot_assumption)).toBe(true);
  });
});

describe("audit templates and summary", () => {
  it("seeds building trades, garages and generic templates in FR and ES with 10–20 questions", () => {
    const seeds = auditTemplateSeeds();
    expect(seeds).toHaveLength(12);
    for (const s of seeds) {
      expect(s.questions.length).toBeGreaterThanOrEqual(10);
      expect(s.questions.length).toBeLessThanOrEqual(20);
    }
    expect(seeds.map((s) => s.sector)).toEqual(expect.arrayContaining(["building_trades", "garage", "generic"]));
  });
  it("builds a deterministic summary: facts are answers, rules give drafts, unanswered become open questions", () => {
    const tpl = auditTemplateSeeds().find((s) => s.template_key === "garage.simple.FR")!;
    const s = auditSummary(tpl.questions, { missed_calls: "12", response_time: "Plus de 2 jours", privacy: "yes", g_booking: "Téléphone uniquement" }, "FR");
    expect(s.facts.length).toBe(4);
    expect(s.facts.every((f) => !f.draft)).toBe(true);
    expect(s.observed_problems.map((p) => p.text)).toContain("12 appels manqués par semaine, donc des demandes perdues.");
    expect(s.automation_opportunities.every((a) => a.draft)).toBe(true);
    expect(s.risk_flags.some((r) => r.text.startsWith("Données sensibles"))).toBe(true);
    expect(s.open_questions.length).toBe(tpl.questions.length - 4);
    expect(auditSummary(tpl.questions, { missed_calls: "12" }, "FR")).toEqual(auditSummary(tpl.questions, { missed_calls: "12" }, "FR"));
  });
});
