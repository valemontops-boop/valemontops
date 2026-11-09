/**
 * Quote engine (spec 5.9, D074). Pure functions only: totals, one-off vs MRR, first-year rule, delivery cost and
 * margin, commercial policy (discount bands, margin guardrail), tax rules by jurisdiction, references, required fields
 * and derived status. Money is integer cents (EUR); quantities and hours are × 100; rates are basis points.
 */

export const QUOTE_STATUSES = ["draft", "approved", "sent", "accepted", "declined"] as const;
export type StoredQuoteStatus = (typeof QUOTE_STATUSES)[number];
/** "expired" is never stored: it is derived at read time from the validity date (spec 4.6). */
export type QuoteStatus = StoredQuoteStatus | "expired";
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export const BILLINGS = ["one_time", "monthly"] as const;
export type Billing = (typeof BILLINGS)[number];
export const UNITS = ["unit", "project", "month", "hour", "day", "report", "location"] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABELS: Record<Unit, string> = { unit: "unit", project: "project", month: "month", hour: "hour", day: "day", report: "report", location: "location" };

export const PRICE_MODES = ["fixed", "range", "quote", "founder_entered"] as const;
export type PriceMode = (typeof PRICE_MODES)[number];
export const ITEM_KINDS = ["offer", "module", "addon", "report", "service"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Milestone {
  title: string;
  timing: string;
  amount_pct: number;
}

export interface LineInput {
  billing: Billing;
  quantity_x100: number;
  unit_price_minor: number;
  /** List price from the price book at the time the line was added (null = founder-entered, no list price). */
  list_unit_price_minor: number | null;
  discount_bp: number;
  /** Founder hours to deliver the line: total for a one-off line, per month for a monthly line. */
  est_hours_x100: number;
  /** Direct costs (contractors, tools, AI usage): total for a one-off line, per month for a monthly line. */
  direct_cost_minor: number;
}

export interface QuoteInput {
  discount_bp: number;
  term_months: number | null;
  contingency_bp: number;
}

export interface TaxRule {
  /** Company (seller) country. */
  seller: string;
  /** Client country. */
  client: string;
  label: string;
  rate_bp: number;
  /** Legal mention printed under the totals (e.g. reverse charge), founder-written. */
  mention: string;
}

export interface DiscountBand {
  max_pct: number;
  approval: "none" | "other_founder" | "forbidden";
}

export interface Policy {
  discountBands: DiscountBand[];
  marginGuardrailPct: number;
  taxRules: TaxRule[];
  hourCostMinor: number;
  validityDays: number;
  contingencyPct: number;
}

export const POLICY_SEED: Omit<Policy, "hourCostMinor"> = {
  discountBands: [
    { max_pct: 10, approval: "none" },
    { max_pct: 30, approval: "other_founder" },
    { max_pct: 100, approval: "forbidden" },
  ],
  marginGuardrailPct: 40,
  // Founder-confirmed domestic rates (D074): France 20 % TVA, Spain 21 % IVA. Cross-border pairs are never guessed.
  taxRules: [
    { seller: "FR", client: "FR", label: "TVA", rate_bp: 2000, mention: "" },
    { seller: "ES", client: "ES", label: "IVA", rate_bp: 2100, mention: "" },
  ],
  validityDays: 30,
  contingencyPct: 10,
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) : null);

export function lineGross(l: Pick<LineInput, "quantity_x100" | "unit_price_minor">): number {
  return Math.round((l.quantity_x100 * l.unit_price_minor) / 100);
}
export function lineNet(l: Pick<LineInput, "quantity_x100" | "unit_price_minor" | "discount_bp">): number {
  const g = lineGross(l);
  return g - Math.round((g * l.discount_bp) / 10_000);
}
export function lineCost(l: Pick<LineInput, "est_hours_x100" | "direct_cost_minor">, hourCostMinor: number): number {
  return Math.round((l.est_hours_x100 * hourCostMinor) / 100) + l.direct_cost_minor;
}

export interface QuoteTotals {
  /** One-off amount ex VAT (set-up fees, projects, reports). Never part of MRR. */
  oneOffMinor: number;
  /** Monthly recurring amount ex VAT. */
  mrrMinor: number;
  /** One-off + 12 × MRR, only when the contract term is explicitly 12 months or more; otherwise null (scenario 6). */
  firstYearMinor: number | null;
  oneOffListMinor: number;
  mrrListMinor: number;
  /** Effective discount against list prices (the larger of one-off and monthly), basis points. */
  discountBp: number;
  /** Estimated delivery cost: founder hours × hour cost + direct costs, plus contingency. */
  oneOffCostMinor: number;
  monthlyCostMinor: number;
  oneOffMarginMinor: number;
  monthlyMarginMinor: number;
  oneOffMarginBp: number | null;
  monthlyMarginBp: number | null;
}

export function quoteTotals(q: QuoteInput, lines: LineInput[], hourCostMinor: number): QuoteTotals {
  const sum = (b: Billing, f: (l: LineInput) => number) => lines.filter((l) => l.billing === b).reduce((s, l) => s + f(l), 0);
  const afterQuoteDiscount = (v: number) => v - Math.round((v * q.discount_bp) / 10_000);
  const oneOffMinor = afterQuoteDiscount(sum("one_time", lineNet));
  const mrrMinor = afterQuoteDiscount(sum("monthly", lineNet));
  // Lines without a list price (founder-entered) count at their own price, so they never look discounted.
  const listOf = (l: LineInput) => Math.round((l.quantity_x100 * (l.list_unit_price_minor ?? l.unit_price_minor)) / 100);
  const oneOffListMinor = sum("one_time", listOf);
  const mrrListMinor = sum("monthly", listOf);
  const disc = (list: number, net: number) => (list > 0 && net < list ? Math.round(((list - net) / list) * 10_000) : 0);
  const withContingency = (v: number) => v + Math.round((v * q.contingency_bp) / 10_000);
  const oneOffCostMinor = withContingency(sum("one_time", (l) => lineCost(l, hourCostMinor)));
  const monthlyCostMinor = withContingency(sum("monthly", (l) => lineCost(l, hourCostMinor)));
  const term = q.term_months ?? 0;
  return {
    oneOffMinor,
    mrrMinor,
    firstYearMinor: term >= 12 ? oneOffMinor + 12 * mrrMinor : null,
    oneOffListMinor,
    mrrListMinor,
    discountBp: Math.max(disc(oneOffListMinor, oneOffMinor), disc(mrrListMinor, mrrMinor)),
    oneOffCostMinor,
    monthlyCostMinor,
    oneOffMarginMinor: oneOffMinor - oneOffCostMinor,
    monthlyMarginMinor: mrrMinor - monthlyCostMinor,
    oneOffMarginBp: pct(oneOffMinor - oneOffCostMinor, oneOffMinor),
    monthlyMarginBp: pct(mrrMinor - monthlyCostMinor, mrrMinor),
  };
}

/* ---------- taxes ---------- */

export type TaxResolution =
  | { ok: true; rule: TaxRule; oneOffTaxMinor: number; mrrTaxMinor: number }
  | { ok: false; reason: "seller_country_missing" | "client_country_missing" | "no_rule" };

export const TAX_BLOCK_MESSAGES: Record<Exclude<TaxResolution, { ok: true }>["reason"], string> = {
  seller_country_missing: "Set the company's country in Settings › Commercial › Legal details first.",
  client_country_missing: "Set the client's country on the business first: VAT depends on it.",
  no_rule: "No confirmed tax rule for this company and client country. Cross-border VAT is never guessed: add the rule in Settings › Commercial › Taxes.",
};

/** The founder-confirmed rule for the company country → client country pair; no rule = blocked (never a guessed rate). */
export function resolveTax(rules: TaxRule[], sellerCountry: string, clientCountry: string, totals: Pick<QuoteTotals, "oneOffMinor" | "mrrMinor">): TaxResolution {
  if (!sellerCountry) return { ok: false, reason: "seller_country_missing" };
  if (!clientCountry) return { ok: false, reason: "client_country_missing" };
  const rule = rules.find((r) => r.seller === sellerCountry && r.client === clientCountry);
  if (!rule) return { ok: false, reason: "no_rule" };
  return { ok: true, rule, oneOffTaxMinor: Math.round((totals.oneOffMinor * rule.rate_bp) / 10_000), mrrTaxMinor: Math.round((totals.mrrMinor * rule.rate_bp) / 10_000) };
}

/* ---------- commercial policy ---------- */

export interface PolicyCheck {
  /** Approval must come from the founder who did not write the quote, with a recorded trade. */
  requiresOtherFounder: boolean;
  /** Beyond the last allowed band: cannot be approved at all. */
  forbidden: boolean;
  reasons: { key: string; vars: Record<string, string | number> }[];
}

export function policyCheck(totals: QuoteTotals, policy: Pick<Policy, "discountBands" | "marginGuardrailPct">): PolicyCheck {
  const reasons: PolicyCheck["reasons"] = [];
  const discPct = totals.discountBp / 100;
  const bands = [...policy.discountBands].sort((a, b) => a.max_pct - b.max_pct);
  const band = bands.find((b) => discPct <= b.max_pct) ?? { max_pct: 100, approval: "forbidden" as const };
  const freeMax = bands.filter((b) => b.approval === "none").reduce((m, b) => Math.max(m, b.max_pct), 0);
  let requiresOtherFounder = false;
  let forbidden = false;
  if (totals.discountBp > 0 && band.approval === "other_founder") {
    requiresOtherFounder = true;
    reasons.push({ key: "Discount of {pct} % is above the {max} % allowed without approval.", vars: { pct: round1(discPct), max: freeMax } });
  }
  if (totals.discountBp > 0 && band.approval === "forbidden") {
    forbidden = true;
    reasons.push({ key: "Discount of {pct} % is beyond the commercial policy: it cannot be approved.", vars: { pct: round1(discPct) } });
  }
  const guard = policy.marginGuardrailPct * 100;
  for (const [bp, key] of [
    [totals.oneOffMarginBp, "One-off gross margin {pct} % is below the {min} % guardrail."],
    [totals.monthlyMarginBp, "Monthly gross margin {pct} % is below the {min} % guardrail."],
  ] as const) {
    if (bp !== null && bp < guard) {
      requiresOtherFounder = true;
      reasons.push({ key, vars: { pct: round1(bp / 100), min: policy.marginGuardrailPct } });
    }
  }
  return { requiresOtherFounder, forbidden, reasons };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface Approval {
  founder: string;
  at: string;
  quote_version: number;
  with_other_founder: boolean;
}

/** Who may approve: anyone when the policy is respected; only the other founder (with a trade) when it is not. */
export function approvalError(check: PolicyCheck, author: string, approver: string, trade: string): string | null {
  if (check.forbidden) return "This discount is beyond the commercial policy: it cannot be approved. Lower it.";
  if (!check.requiresOtherFounder) return null;
  if (approver === author) return "Outside the commercial policy: the other founder must approve this quote.";
  if (!trade.trim()) return "Outside the commercial policy: record what we got in exchange (the trade) before approval.";
  return null;
}

/* ---------- references, status, required fields ---------- */

/** Human-readable reference derived from the quote's UUID (never a sequential legal number, spec 3.8). */
export function quoteReference(groupId: string, quoteVersion: number): string {
  return `VAL-${groupId.replace(/-/g, "").slice(0, 8).toUpperCase()}-V${quoteVersion}`;
}

/** Approved or sent quotes whose validity date has passed read as expired (computed on read, spec 4.6). */
export function effectiveStatus(q: { status: StoredQuoteStatus; valid_until: string | null }, today: string): QuoteStatus {
  if ((q.status === "approved" || q.status === "sent") && q.valid_until && q.valid_until < today) return "expired";
  return q.status;
}

/** Statuses in which editing makes a new version instead of changing the quote in place. */
export const FROZEN_STATUSES: readonly QuoteStatus[] = ["approved", "sent", "accepted", "declined", "expired"];

export const LEGAL_FIELDS = ["legal_name", "legal_form", "address", "seller_country", "company_id", "vat_number", "share_capital", "registry", "iban", "legal_mentions"] as const;
export type LegalField = (typeof LEGAL_FIELDS)[number];
/** Required on every quote PDF; generation is blocked and the missing field named (never a placeholder). */
export const REQUIRED_LEGAL_FIELDS: readonly LegalField[] = ["legal_name", "legal_form", "address", "seller_country", "company_id", "vat_number"];
export const LEGAL_FIELD_LABELS: Record<LegalField, string> = {
  legal_name: "Company legal name",
  legal_form: "Legal form",
  address: "Registered address",
  seller_country: "Company country",
  company_id: "Company number (SIREN / NIF)",
  vat_number: "VAT number",
  share_capital: "Share capital",
  registry: "Trade register (RCS / Registro Mercantil)",
  iban: "IBAN",
  legal_mentions: "Legal mentions",
};

export const QUOTE_FIELD_LABELS = {
  client_name: "Client name",
  client_country: "Client country",
  valid_until: "Valid until",
  payment_terms: "Payment terms",
  lines: "At least one priced line",
  tax: "Tax rule",
} as const;
export type QuoteField = keyof typeof QUOTE_FIELD_LABELS;

export function missingForPdf(
  legal: Partial<Record<LegalField, string>>,
  q: { valid_until: string | null; payment_terms: string; client_country: string },
  clientName: string,
  lines: { unit_price_minor: number; quantity_x100: number }[],
): (LegalField | QuoteField)[] {
  const out: (LegalField | QuoteField)[] = REQUIRED_LEGAL_FIELDS.filter((f) => !(legal[f] ?? "").trim());
  if (!clientName.trim()) out.push("client_name");
  if (!q.client_country) out.push("client_country");
  if (!q.valid_until) out.push("valid_until");
  if (!q.payment_terms.trim()) out.push("payment_terms");
  if (!lines.length || lines.some((l) => l.quantity_x100 <= 0)) out.push("lines");
  return out;
}

/** Latest row per key at a date (versioned by effective_from, then created_at). */
export function latestByKey<R extends { effective_from: string; created_at: string; is_archived: boolean }>(rows: R[], keyOf: (r: R) => string, asOf: string): Map<string, R> {
  const out = new Map<string, R>();
  for (const r of rows) {
    if (r.is_archived || r.effective_from > asOf) continue;
    const k = keyOf(r);
    const cur = out.get(k);
    if (!cur || r.effective_from > cur.effective_from || (r.effective_from === cur.effective_from && r.created_at > cur.created_at)) out.set(k, r);
  }
  return out;
}

/** Euro amount for printed documents: "1 678,00 €" (FR) / "1.678,00 €" (ES); plain spaces only (PDF fonts). */
export function eur(minor: number, lang: "FR" | "ES"): string {
  const s = new Intl.NumberFormat(lang === "FR" ? "fr-FR" : "es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(minor / 100);
  return s.replace(/[  ]/g, " ");
}
