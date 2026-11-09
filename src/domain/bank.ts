/**
 * Bank movements (Wise) and how they are read (round 5). Rules from spec 6 Finance: founder contributions
 * and transfers between our own balances are NOT revenue and NOT expenses. Every automatic category can
 * be changed by a founder; credits that look like income are flagged "to review" until confirmed.
 */
export const BANK_CATEGORIES = [
  "revenue", "founder_contribution", "internal_transfer", "other_income",
  "software", "ads", "contractors", "telecom", "travel", "bank_fees", "taxes", "salaries", "other_expense",
] as const;
export type BankCategory = (typeof BANK_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<BankCategory, string> = {
  revenue: "Client revenue", founder_contribution: "Founder contribution", internal_transfer: "Transfer between our balances", other_income: "Other income",
  software: "Software & tools", ads: "Advertising", contractors: "Contractors", telecom: "Phone & internet", travel: "Travel", bank_fees: "Bank fees",
  taxes: "Taxes", salaries: "Salaries", other_expense: "Other expense",
};
export const NEUTRAL: readonly BankCategory[] = ["founder_contribution", "internal_transfer"];
export const isIncome = (c: BankCategory) => c === "revenue" || c === "other_income";

const RULES: [RegExp, BankCategory][] = [
  [/\b(google ads|meta ads|facebook|instagram ads|linkedin ads|tiktok ads|fb\.me)\b/i, "ads"],
  [/\b(google|workspace|gsuite|notion|openai|anthropic|claude|vercel|github|canva|figma|slack|zoom|adobe|aws|amazon web|ovh|o2switch|hostinger|ionos|calendly|webflow|framer|zapier|make\.com|airtable|hubspot|apollo|lemlist|phantombuster)\b/i, "software"],
  [/\b(orange|sfr|free mobile|bouygues|movistar|vodafone|digi|simyo|lowi|o2)\b/i, "telecom"],
  [/\b(sncf|renfe|uber|bolt|cabify|ryanair|vueling|easyjet|air france|iberia|airbnb|booking\.com|blablacar|ouigo|total ?energies|repsol|cepsa)\b/i, "travel"],
  [/\b(urssaf|dgfip|impots|aeat|hacienda|tgss|seguridad social)\b/i, "taxes"],
  [/\b(malt|upwork|fiverr|deel|freelance)\b/i, "contractors"],
];

/** Automatic category from Wise's transaction type, description and merchant. */
export function autoCategory(t: { direction: "credit" | "debit"; bank_type: string; description: string; counterparty: string; merchant_category: string }): BankCategory {
  const type = t.bank_type.toUpperCase();
  const text = `${t.description} ${t.counterparty} ${t.merchant_category}`;
  if (["CONVERSION", "INCOMING_CROSS_BALANCE", "OUTGOING_CROSS_BALANCE", "BALANCE_CASHBACK_TRANSFER"].includes(type) || /\b(converted|conversion|between your balances|jar)\b/i.test(text)) return "internal_transfer";
  if (t.direction === "credit") {
    // A Stripe payout landing in Wise is our own money moving, not new revenue (Stripe already counted the sale).
    if (/\bstripe\b/i.test(text)) return "internal_transfer";
    if (type === "MONEY_ADDED" || /\b(top[- ]?up|money added|apport|aportaci[oó]n|capital)\b/i.test(text)) return "founder_contribution";
    if (type === "BALANCE_INTEREST" || /\b(interest|cashback|refund|rembours|reembolso)\b/i.test(text)) return "other_income";
    return "revenue";
  }
  if (type === "ACCRUAL_CHARGE" || type === "FEE" || /\b(wise fee|fee for|frais|comisi[oó]n)\b/i.test(text)) return "bank_fees";
  for (const [re, c] of RULES) if (re.test(text)) return c;
  return "other_expense";
}

interface Tx { amount_minor: number; currency: string; category: BankCategory; date: string; direction: "credit" | "debit"; category_source: "auto" | "manual"; counterparty?: string; bank?: string; is_archived?: boolean }

/** Income, expenses and net per month (in one currency), excluding founder contributions and internal transfers. */
export function moneySummary(rows: Tx[], currency: string, today: string, months = 6) {
  const tx = rows.filter((r) => !r.is_archived && r.currency === currency);
  const monthKeys: string[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); monthKeys.push(d.toISOString().slice(0, 7)); }
  const byMonth = monthKeys.map((k) => {
    const mt = tx.filter((r) => r.date.startsWith(k));
    const income = mt.filter((r) => isIncome(r.category)).reduce((a, r) => a + r.amount_minor, 0);
    const expenses = -mt.filter((r) => !isIncome(r.category) && !NEUTRAL.includes(r.category) && r.direction === "debit").reduce((a, r) => a + r.amount_minor, 0);
    return { month: k, income, expenses, net: income - expenses };
  });
  const cur = today.slice(0, 7);
  const thisMonth = tx.filter((r) => r.date.startsWith(cur));
  const byCategory = new Map<BankCategory, number>();
  for (const r of thisMonth.filter((x) => x.direction === "debit" && !NEUTRAL.includes(x.category))) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) - r.amount_minor);
  const prevKey = monthKeys.at(-2) ?? "";
  const prevCat = new Map<BankCategory, number>();
  for (const r of tx.filter((x) => x.date.startsWith(prevKey) && x.direction === "debit" && !NEUTRAL.includes(x.category))) prevCat.set(r.category, (prevCat.get(r.category) ?? 0) - r.amount_minor);
  // Revenue concentration over the last 3 months (who pays us).
  const recent = tx.filter((r) => r.category === "revenue" && monthKeys.slice(-3).some((k) => r.date.startsWith(k)));
  const byClient = new Map<string, number>();
  for (const r of recent) byClient.set(r.counterparty || "?", (byClient.get(r.counterparty || "?") ?? 0) + r.amount_minor);
  const totalRev = [...byClient.values()].reduce((a, b) => a + b, 0);
  const top = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    months: byMonth,
    current: byMonth.at(-1)!,
    previousExpensesByCategory: [...prevCat.entries()].map(([category, amount]) => ({ category, amount })),
    topClientShare: top && totalRev > 0 && byClient.size >= 1 && recent.length >= 3 ? { name: top[0], share: top[1] / totalRev } : null,
    expensesByCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount })),
    contributions: thisMonth.filter((r) => r.category === "founder_contribution").reduce((a, r) => a + r.amount_minor, 0),
    // Stripe sales are revenue for sure; only bank credits auto-tagged as income need a founder's check.
    toReview: tx.filter((r) => r.bank !== "stripe" && r.category_source === "auto" && r.direction === "credit" && (r.category === "revenue" || r.category === "other_income")).length,
  };
}

/** Wise CSV statement export → rows. Columns are matched by name ("TransferWise ID" / "ID", "Date", "Amount", …). */
export function parseWiseCsv(rows: Record<string, string>[]) {
  const pick = (r: Record<string, string>, ...names: string[]) => {
    for (const n of names) { const k = Object.keys(r).find((x) => x.trim().toLowerCase() === n.toLowerCase()); if (k && r[k] !== undefined && r[k] !== "") return r[k].trim(); }
    return "";
  };
  const out: { source_id: string; currency: string; amount_minor: number; fee_minor: number | null; date: string; description: string; counterparty: string; bank_type: string; merchant_category: string; running_balance_minor: number | null }[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const id = pick(r, "TransferWise ID", "ID", "Transaction ID");
    const amount = Number(pick(r, "Amount").replace(/\s/g, "").replace(",", "."));
    const raw = pick(r, "Date", "Created on", "Date Time");
    const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(raw) ?? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
    const date = m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
    if (!id || !Number.isFinite(amount) || !date) { errors.push(`Row ${i + 2}: missing ID, date or amount`); return; }
    const fee = Number(pick(r, "Total fees").replace(",", "."));
    const bal = Number(pick(r, "Running Balance").replace(",", "."));
    out.push({
      source_id: id, currency: pick(r, "Currency").toUpperCase(), amount_minor: Math.round(amount * 100), fee_minor: Number.isFinite(fee) && pick(r, "Total fees") ? Math.round(fee * 100) : null,
      date, description: pick(r, "Description"), counterparty: pick(r, "Payer Name", "Payee Name", "Merchant"), bank_type: pick(r, "Transaction Details Type", "Type"),
      merchant_category: pick(r, "Card Last Four Digits") ? pick(r, "Merchant") : "", running_balance_minor: Number.isFinite(bal) && pick(r, "Running Balance") ? Math.round(bal * 100) : null,
    });
  });
  return { rows: out, errors };
}

/** Stripe balance transaction → category (sales are revenue; payouts to the bank are internal; fees are bank fees). */
export function stripeCategory(type: string, amount: number): BankCategory {
  if (["charge", "payment", "refund", "payment_refund", "payment_failure_refund"].includes(type)) return "revenue";
  if (["payout", "payout_cancel", "payout_failure", "transfer", "topup"].includes(type)) return "internal_transfer";
  if (["stripe_fee", "application_fee", "tax_fee"].includes(type) || type.endsWith("_fee")) return "bank_fees";
  return amount >= 0 ? "other_income" : "other_expense";
}
