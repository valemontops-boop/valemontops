/**
 * Commercial policy, legal details and price book (spec 2.5, 5.9; D074). Everything is versioned by effective date
 * and append-only: an edit appends a row, the latest effective_from (≤ the date asked, then created_at) wins.
 */
import { z } from "zod";
import type { DataRepository } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import { childId } from "@/lib/ids";
import { BRANDS, type FounderKey } from "@/domain/constants";
import { localDate } from "@/domain/time";
import { auditTemplateSeeds } from "@/domain/audit";
import { PRICE_BOOK_SEEDS } from "@/domain/price-book";
import { ITEM_KINDS, LEGAL_FIELDS, POLICY_SEED, PRICE_MODES, UNITS, latestByKey, type LegalField, type Policy, type TaxRule } from "@/domain/quotes";
import { RuleError } from "../errors";
import { numSetting, settingValue } from "./common";

const SEED_DATE = "2000-01-01";
export const todayParis = () => localDate(new Date(), "Europe/Paris");

/* ---------- policy keys and their validation ---------- */

const bandSchema = z.array(z.object({ max_pct: z.number().min(0).max(100), approval: z.enum(["none", "other_founder", "forbidden"]) })).min(1).max(6);
const taxSchema = z.array(z.object({
  seller: z.enum(["FR", "ES"]),
  client: z.string().trim().regex(/^[A-Z]{2}$/),
  label: z.string().trim().min(1).max(20),
  rate_bp: z.number().int().min(0).max(5_000),
  mention: z.string().trim().max(300).default(""),
})).max(20);

export const POLICY_KEYS = {
  discount_bands: (v: string) => bandSchema.parse(JSON.parse(v)),
  margin_guardrail_pct: (v: string) => z.coerce.number().int().min(0).max(100).parse(v),
  tax_rules: (v: string) => taxSchema.parse(JSON.parse(v)),
  validity_days: (v: string) => z.coerce.number().int().min(1).max(365).parse(v),
  contingency_pct: (v: string) => z.coerce.number().int().min(0).max(100).parse(v),
  payment_terms_FR: (v: string) => z.string().max(1_000).parse(v),
  payment_terms_ES: (v: string) => z.string().max(1_000).parse(v),
} as const;
export type PolicyKey = keyof typeof POLICY_KEYS;
const LEGAL_VALIDATORS: Record<LegalField, (v: string) => unknown> = {
  legal_name: (v) => z.string().max(200).parse(v),
  legal_form: (v) => z.string().max(80).parse(v),
  address: (v) => z.string().max(400).parse(v),
  seller_country: (v) => z.union([z.literal(""), z.enum(["FR", "ES"])]).parse(v),
  company_id: (v) => z.string().max(40).parse(v),
  vat_number: (v) => z.string().max(40).parse(v),
  share_capital: (v) => z.string().max(60).parse(v),
  registry: (v) => z.string().max(120).parse(v),
  iban: (v) => z.string().max(42).parse(v),
  legal_mentions: (v) => z.string().max(1_000).parse(v),
};

const POLICY_SEEDS: { key: PolicyKey; value: string }[] = [
  { key: "discount_bands", value: JSON.stringify(POLICY_SEED.discountBands) },
  { key: "margin_guardrail_pct", value: String(POLICY_SEED.marginGuardrailPct) },
  { key: "tax_rules", value: JSON.stringify(POLICY_SEED.taxRules) },
  { key: "validity_days", value: String(POLICY_SEED.validityDays) },
  { key: "contingency_pct", value: String(POLICY_SEED.contingencyPct) },
  { key: "payment_terms_FR", value: "50 % à la commande, 50 % à la livraison. Abonnement mensuel payable d'avance par virement ou prélèvement." },
  { key: "payment_terms_ES", value: "50 % al aceptar, 50 % a la entrega. Suscripción mensual pagadera por adelantado por transferencia o domiciliación." },
];

/** Idempotent seeds (deterministic ids): price book, audit templates, policy. Legal details are never seeded in LIVE. */
export async function seedCommercial(repo: DataRepository) {
  const t = await repo.listMany(["PriceBookItems", "AuditTemplates", "CommercialPolicy"], { fresh: true });
  const actor = { founder: "system" };
  const added: Record<string, number> = {};
  const pb = PRICE_BOOK_SEEDS.map((s) => ({ id: childId("pricebook-seed", s.item_key), ...s, effective_from: SEED_DATE, active: true })).filter((r) => !t.PriceBookItems.rows.some((x) => x.id === r.id));
  if (pb.length) added.PriceBookItems = (await repo.insert("PriceBookItems", pb, actor)).length;
  const tpl = auditTemplateSeeds().map((s) => ({ id: childId("audit-template", s.template_key), ...s })).filter((r) => !t.AuditTemplates.rows.some((x) => x.id === r.id));
  if (tpl.length) added.AuditTemplates = (await repo.insert("AuditTemplates", tpl, actor)).length;
  const pol = POLICY_SEEDS.map((s) => ({ id: childId("policy-seed", s.key), ...s, effective_from: SEED_DATE, changed_by: "system", note: "seed" })).filter((r) => !t.CommercialPolicy.rows.some((x) => x.id === r.id));
  if (pol.length) added.CommercialPolicy = (await repo.insert("CommercialPolicy", pol, actor)).length;
  return added;
}

export interface PolicyView {
  policy: Policy;
  legal: Record<LegalField, string>;
  paymentTerms: { FR: string; ES: string };
}

export function policyFromRows(rows: Row<"CommercialPolicy">[], asOf: string, hourCostMinor: number, companyNameFallback: string): PolicyView {
  const cur = latestByKey(rows, (r) => r.key, asOf);
  const val = <T>(k: string, parse: (v: string) => T, fallback: T): T => {
    const r = cur.get(k);
    if (!r) return fallback;
    try { return parse(r.value); } catch { return fallback; }
  };
  const policy: Policy = {
    discountBands: val("discount_bands", POLICY_KEYS.discount_bands, POLICY_SEED.discountBands),
    marginGuardrailPct: val("margin_guardrail_pct", POLICY_KEYS.margin_guardrail_pct, POLICY_SEED.marginGuardrailPct),
    taxRules: val("tax_rules", POLICY_KEYS.tax_rules, POLICY_SEED.taxRules) as TaxRule[],
    validityDays: val("validity_days", POLICY_KEYS.validity_days, POLICY_SEED.validityDays),
    contingencyPct: val("contingency_pct", POLICY_KEYS.contingency_pct, POLICY_SEED.contingencyPct),
    hourCostMinor,
  };
  const legal = Object.fromEntries(LEGAL_FIELDS.map((f) => [f, cur.get(f)?.value ?? ""])) as Record<LegalField, string>;
  if (!legal.legal_name) legal.legal_name = companyNameFallback;
  return { policy, legal, paymentTerms: { FR: cur.get("payment_terms_FR")?.value ?? "", ES: cur.get("payment_terms_ES")?.value ?? "" } };
}

export async function readPolicy(repo: DataRepository, asOf = todayParis()): Promise<PolicyView> {
  const rows = (await repo.list("CommercialPolicy")).rows;
  const hour = Math.round((await numSetting(repo, "founder_hour_cost_eur", 30)) * 100);
  return policyFromRows(rows, asOf, hour, (await settingValue(repo, "company_name")) ?? "");
}

export const policyEditSchema = z.object({
  id: z.string().uuid(), // client-generated: a retried save appends nothing (D006)
  key: z.enum([...Object.keys(POLICY_KEYS), ...LEGAL_FIELDS] as unknown as [string, ...string[]]),
  value: z.string().trim().max(5_000),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(500).default(""),
});

export async function savePolicy(repo: DataRepository, founder: FounderKey, input: z.infer<typeof policyEditSchema>) {
  if (await repo.get("CommercialPolicy", input.id, { fresh: true })) return { duplicate: true };
  const validate = (POLICY_KEYS as Record<string, (v: string) => unknown>)[input.key] ?? LEGAL_VALIDATORS[input.key as LegalField];
  try {
    validate(input.value);
  } catch {
    throw new RuleError("This value is not valid for this setting.");
  }
  await repo.insert("CommercialPolicy", [{ id: input.id, key: input.key, value: input.value, effective_from: input.effective_from ?? todayParis(), changed_by: founder, note: input.note }], { founder });
  return { duplicate: false };
}

export async function policyHistory(repo: DataRepository) {
  return (await repo.list("CommercialPolicy")).rows.filter((r) => !r.is_archived).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at)).slice(0, 40);
}

/* ---------- price book ---------- */

export interface PriceItem extends Row<"PriceBookItems"> {
  /** List prices after linked settings are applied (cents). */
  list_one_time_minor: number | null;
  list_monthly_minor: number | null;
  versions: number;
}

/** Current price book at a date; setting-linked items take their price from SystemSettings (one source of truth). */
export function resolvePriceBook(rows: Row<"PriceBookItems">[], asOf: string, settings: Record<string, string>): PriceItem[] {
  const cur = latestByKey(rows, (r) => r.item_key, asOf);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.item_key, (counts.get(r.item_key) ?? 0) + 1);
  return [...cur.values()].filter((r) => r.active).map((r) => {
    const linked = r.price_setting_key && settings[r.price_setting_key] && Number.isFinite(Number(settings[r.price_setting_key])) ? Math.round(Number(settings[r.price_setting_key]) * 100) : null;
    const monthlyItem = r.unit === "month";
    const list_one_time_minor = linked !== null && !monthlyItem ? linked : r.price_mode === "quote" || r.price_mode === "founder_entered" ? null : r.one_time_min_minor;
    const list_monthly_minor = linked !== null && monthlyItem ? linked : r.price_mode === "quote" || r.price_mode === "founder_entered" ? null : r.monthly_min_minor;
    return { ...r, list_one_time_minor, list_monthly_minor, versions: counts.get(r.item_key) ?? 1 };
  }).sort((a, b) => order(a) - order(b) || a.item_key.localeCompare(b.item_key));
}
const order = (r: { brand: string | null; kind: string }) => ["consulting", "local", "thirty"].indexOf(r.brand ?? "consulting") * 10 + ["offer", "module", "service", "addon", "report"].indexOf(r.kind);

export async function priceBook(repo: DataRepository, asOf = todayParis()) {
  const rows = (await repo.list("PriceBookItems")).rows;
  const settings = Object.fromEntries((await repo.list("SystemSettings")).rows.map((s) => [s.key, s.value]));
  return resolvePriceBook(rows, asOf, settings);
}

const eurMinor = z.number().int().min(0).max(100_000_000).nullable();
export const priceItemSchema = z.object({
  id: z.string().uuid(),
  item_key: z.string().trim().regex(/^[a-z0-9_]{2,60}$/),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean().default(true),
  brand: z.enum(BRANDS).nullable().default(null),
  kind: z.enum(ITEM_KINDS),
  name_fr: z.string().trim().min(1).max(200),
  name_es: z.string().trim().min(1).max(200),
  unit: z.enum(UNITS),
  price_mode: z.enum(PRICE_MODES),
  one_time_min_minor: eurMinor.default(null),
  one_time_max_minor: eurMinor.default(null),
  monthly_min_minor: eurMinor.default(null),
  monthly_max_minor: eurMinor.default(null),
  price_setting_key: z.enum(["", "offer_consulting_value_eur", "offer_local_monthly_eur"]).default(""),
  one_time_hours_x100: z.number().int().min(0).max(100_000).default(0),
  monthly_hours_x100: z.number().int().min(0).max(100_000).default(0),
  one_time_cost_minor: z.number().int().min(0).max(100_000_000).default(0),
  monthly_cost_minor: z.number().int().min(0).max(100_000_000).default(0),
  pilot_assumption: z.boolean().default(true),
  limits: z.string().trim().max(1_000).default(""),
  notes: z.string().trim().max(1_000).default(""),
});

/** A price change is a new version (append-only): history stays, quotes keep the price they were made with. */
export async function savePriceItem(repo: DataRepository, founder: FounderKey, input: z.infer<typeof priceItemSchema>) {
  if (await repo.get("PriceBookItems", input.id, { fresh: true })) return { duplicate: true };
  for (const [a, b] of [[input.one_time_min_minor, input.one_time_max_minor], [input.monthly_min_minor, input.monthly_max_minor]] as const) {
    if (a !== null && b !== null && b < a) throw new RuleError("The maximum price must be at least the minimum.");
  }
  await repo.insert("PriceBookItems", [{ ...input }], { founder });
  return { duplicate: false };
}

/** Everything Settings › Commercial shows, in one read. */
export async function commercialOverview(repo: DataRepository) {
  const today = todayParis();
  const pv = await readPolicy(repo, today);
  return { ...pv, priceBook: await priceBook(repo, today), history: await policyHistory(repo), today };
}
