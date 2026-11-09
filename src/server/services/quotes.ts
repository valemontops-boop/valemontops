/**
 * Quote engine (spec 5.9, D074): drafts, copy-on-write lines, approvals under the commercial policy, human-initiated
 * sending (proposal_sent logged once), acceptance (never cash), versions, PDF and Drive. Quotes add nothing to revenue,
 * cash or MRR: those come from Money (bank / Stripe) only.
 */
import { z } from "zod";
import { ConflictError, type DataRepository, type NewRow } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import { childId, newId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { addDays } from "@/domain/time";
import { defaultBilling } from "@/domain/price-book";
import {
  BILLINGS, FROZEN_STATUSES, TAX_BLOCK_MESSAGES, UNITS, approvalError, effectiveStatus, missingForPdf, policyCheck, quoteReference, quoteTotals, resolveTax,
  type LineInput, type QuoteTotals,
} from "@/domain/quotes";
import { ConsentRequiredError } from "@/data/google/ports";
import type { AppContext } from "../context";
import { RuleError } from "../errors";
import { logActivity } from "./activities";
import { settingValue } from "./common";
import { priceBook, readPolicy, todayParis, type PolicyView, type PriceItem } from "./commercial";
import { auditsFor } from "./audits";
import { renderQuotePdf } from "../pdf/quote-pdf";

type Quote = Row<"Quotes">;
type Line = Row<"QuoteLines">;

export const linesOf = (q: Pick<Quote, "id" | "lines_rev">, all: Line[]) => all.filter((l) => l.quote_id === q.id && l.lines_rev === q.lines_rev && !l.is_archived).sort((a, b) => a.position - b.position);

function totalsOf(q: Quote, lines: Line[]): QuoteTotals {
  return quoteTotals({ discount_bp: q.discount_bp, term_months: q.term_months, contingency_bp: q.contingency_bp }, lines as LineInput[], q.hour_cost_minor);
}

export interface QuoteView extends Quote {
  effective_status: ReturnType<typeof effectiveStatus>;
  lines: Line[];
  totals: QuoteTotals;
  tax: ReturnType<typeof resolveTax>;
  check: ReturnType<typeof policyCheck>;
  missing: string[];
}

function viewOf(q: Quote, allLines: Line[], pv: PolicyView, clientName: string, today: string): QuoteView {
  const lines = linesOf(q, allLines);
  const totals = totalsOf(q, lines);
  // Frozen quotes keep the tax rule they were approved with; drafts follow the current confirmed rules.
  const rules = q.status !== "draft" && q.tax_rule ? [q.tax_rule] : pv.policy.taxRules;
  const tax = resolveTax(rules, pv.legal.seller_country, q.client_country, totals);
  return { ...q, effective_status: effectiveStatus(q, today), lines, totals, tax, check: policyCheck(totals, pv.policy), missing: missingForPdf(pv.legal, q, clientName, lines) };
}

/** Everything the deal workspace needs for one opportunity, in one batched read. */
export async function dealWorkspace(repo: DataRepository, opportunityId: string) {
  const t = await repo.listMany(["Opportunities", "Accounts", "Contacts", "Quotes", "QuoteLines"]);
  const opp = t.Opportunities.rows.find((o) => o.id === opportunityId);
  if (!opp) throw new RuleError("Opportunity not found");
  const account = t.Accounts.rows.find((a) => a.id === opp.account_id) ?? null;
  const today = todayParis();
  const pv = await readPolicy(repo, today);
  const quotes = t.Quotes.rows.filter((q) => q.opportunity_id === opportunityId && !q.is_archived).sort((a, b) => b.quote_version - a.quote_version || b.created_at.localeCompare(a.created_at));
  return {
    opportunity: opp,
    account,
    contacts: t.Contacts.rows.filter((c) => c.account_id === opp.account_id && !c.is_archived),
    audits: await auditsFor(repo, opportunityId),
    quotes: quotes.map((q) => viewOf(q, t.QuoteLines.rows, pv, account?.name ?? "", today)),
    priceBook: await priceBook(repo, today),
    policy: pv.policy,
    legalMissing: pv.legal ? (["legal_name", "legal_form", "address", "seller_country", "company_id", "vat_number"] as const).filter((f) => !pv.legal[f].trim()) : [],
    sellerCountry: pv.legal.seller_country,
    paymentTerms: pv.paymentTerms,
    today,
  };
}

/* ---------- create / save ---------- */

const listPriceOf = (item: PriceItem | undefined, billing: "one_time" | "monthly") => (item ? (billing === "monthly" ? item.list_monthly_minor : item.list_one_time_minor) : null);

function lineFromItem(quoteId: string, rev: string, position: number, item: PriceItem, billing: "one_time" | "monthly", lang: "FR" | "ES", fallbackPrice: number | null): NewRow<"QuoteLines"> {
  const list = listPriceOf(item, billing);
  return {
    id: childId(quoteId, rev, String(position)), quote_id: quoteId, lines_rev: rev, position, price_book_item_id: item.id, item_key: item.item_key,
    label: lang === "FR" ? item.name_fr : item.name_es, description: "", billing, unit: billing === "monthly" ? "month" : item.unit === "month" ? "unit" : item.unit,
    quantity_x100: 100, unit_price_minor: list ?? fallbackPrice ?? 0, list_unit_price_minor: list, discount_bp: 0,
    est_hours_x100: billing === "monthly" ? item.monthly_hours_x100 : item.one_time_hours_x100, direct_cost_minor: billing === "monthly" ? item.monthly_cost_minor : item.one_time_cost_minor,
    pilot_assumption: item.pilot_assumption,
  };
}

export const createQuoteSchema = z.object({
  id: z.string().uuid(), // client-generated: a retried create is a no-op (D006)
  opportunity_id: z.string().uuid(),
  audit_session_id: z.union([z.literal(""), z.string().uuid()]).default(""),
});

/** New draft (version 1) prefilled from the deal's offer and, when there is one, the audit summary. */
export async function createQuote(repo: DataRepository, founder: FounderKey, input: z.infer<typeof createQuoteSchema>) {
  const existing = await repo.get("Quotes", input.id, { fresh: true });
  if (existing) return existing;
  const opp = await repo.get("Opportunities", input.opportunity_id);
  if (!opp) throw new RuleError("Opportunity not found");
  const acc = opp.account_id ? await repo.get("Accounts", opp.account_id) : null;
  const today = todayParis();
  const pv = await readPolicy(repo, today);
  const items = await priceBook(repo, today);
  const country = acc?.country ?? opp.market ?? "";
  const lang: "FR" | "ES" = country === "ES" ? "ES" : country === "FR" ? "FR" : founder === "pablo" ? "ES" : "FR";
  const rev = newId();
  const offerKey = opp.brand === "local" ? "local_essential" : opp.brand === "thirty" ? "thirty_report" : "consulting_mission";
  const item = items.find((i) => i.item_key === offerKey);
  const lines = item ? [lineFromItem(input.id, rev, 0, item, defaultBilling({ ...item, monthly_min_minor: item.list_monthly_minor, one_time_min_minor: item.list_one_time_minor }), lang, opp.value_minor)] : [];
  const audit = input.audit_session_id ? await repo.get("AuditSessions", input.audit_session_id) : null;
  const scope = audit?.summary ? [...audit.summary.needs, ...audit.summary.automation_opportunities].map((i) => `- ${i.text}`).join("\n") : "";
  if (lines.length) await repo.insert("QuoteLines", lines, { founder });
  const tax = resolveTax(pv.policy.taxRules, pv.legal.seller_country, country, { oneOffMinor: 0, mrrMinor: 0 });
  const [row] = await repo.insert("Quotes", [{
    id: input.id, quote_group_id: input.id, quote_version: 1, reference: quoteReference(input.id, 1), opportunity_id: opp.id, account_id: opp.account_id,
    audit_session_id: audit?.id ?? "", status: "draft", author: founder, currency: "EUR", language: lang, client_country: country,
    valid_until: addDays(today, pv.policy.validityDays), payment_terms: pv.paymentTerms[lang], term_months: null, discount_bp: 0,
    contingency_bp: pv.policy.contingencyPct * 100, hour_cost_minor: pv.policy.hourCostMinor, tax_rule: tax.ok ? tax.rule : null,
    approval_required: false, approvals: [], trade_recorded: "", scope, exclusions: "", milestones: [], risks: "", pilot_terms: "", notes: "",
    lines_rev: rev, sent_at: null, sent_by: null, decided_at: null, decided_by: null, decline_reason: "", superseded_by: "", pdf_drive_file_id: "",
  }], { founder });
  return row;
}

const lineInput = z.object({
  price_book_item_id: z.string().max(40).default(""),
  item_key: z.string().max(60).default(""),
  label: z.string().trim().min(1).max(300),
  description: z.string().trim().max(1_000).default(""),
  billing: z.enum(BILLINGS),
  unit: z.enum(UNITS),
  quantity_x100: z.number().int().min(1).max(10_000_000),
  unit_price_minor: z.number().int().min(0).max(100_000_000),
  discount_bp: z.number().int().min(0).max(10_000).default(0),
  est_hours_x100: z.number().int().min(0).max(1_000_000).default(0),
  direct_cost_minor: z.number().int().min(0).max(100_000_000).default(0),
});

export const saveQuoteSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  quote: z.object({
    language: z.enum(["FR", "ES"]),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payment_terms: z.string().trim().max(1_000),
    term_months: z.number().int().min(1).max(120).nullable(),
    discount_bp: z.number().int().min(0).max(10_000),
    contingency_bp: z.number().int().min(0).max(10_000),
    trade_recorded: z.string().trim().max(1_000),
    scope: z.string().trim().max(4_000),
    exclusions: z.string().trim().max(2_000),
    milestones: z.array(z.object({ title: z.string().trim().min(1).max(200), timing: z.string().trim().max(100), amount_pct: z.number().min(0).max(100) })).max(12),
    risks: z.string().trim().max(2_000),
    pilot_terms: z.string().trim().max(1_000),
    notes: z.string().trim().max(2_000),
  }),
  lines: z.array(lineInput).max(40),
});

/**
 * Saves a draft. Lines are written first under a new lines_rev, then the header (version-checked) points to them:
 * a conflict or a failure leaves the quote exactly as it was (the unused lines are ignored by every reader).
 */
export async function saveQuote(repo: DataRepository, founder: FounderKey, input: z.infer<typeof saveQuoteSchema>) {
  const cur = await repo.get("Quotes", input.id, { fresh: true });
  if (!cur) throw new RuleError("Quote not found");
  if (FROZEN_STATUSES.includes(effectiveStatus(cur, todayParis()))) throw new RuleError("This quote is no longer a draft: create a new version to change it.");
  if (cur.version !== input.expected_version) {
    // Same answer as the adapter's check, before writing any line.
    throw new ConflictError("Quotes", input.id, input.expected_version, cur as unknown as Record<string, unknown>);
  }
  const items = await priceBook(repo, todayParis());
  const byId = new Map(items.map((i) => [i.id, i]));
  const byKey = new Map(items.map((i) => [i.item_key, i]));
  const rev = newId();
  // List prices come from the price book on the server (never from the browser), so the policy check cannot be bypassed.
  const lines: NewRow<"QuoteLines">[] = input.lines.map((l, i) => {
    const item = byId.get(l.price_book_item_id) ?? (l.item_key ? byKey.get(l.item_key) : undefined);
    const { price_book_item_id: _p, item_key: _k, label, description, billing, unit, quantity_x100, unit_price_minor, discount_bp, est_hours_x100, direct_cost_minor } = l;
    void _p; void _k;
    return { id: childId(input.id, rev, String(i)), quote_id: input.id, lines_rev: rev, position: i, label, description, billing, unit, quantity_x100, unit_price_minor, discount_bp, est_hours_x100, direct_cost_minor, price_book_item_id: item?.id ?? "", item_key: item?.item_key ?? "", list_unit_price_minor: listPriceOf(item, l.billing), pilot_assumption: item?.pilot_assumption ?? false };
  });
  if (lines.length) await repo.insert("QuoteLines", lines, { founder });
  const totals = quoteTotals(input.quote, lines as LineInput[], cur.hour_cost_minor);
  const pv = await readPolicy(repo);
  return repo.update("Quotes", input.id, input.expected_version, { ...input.quote, lines_rev: rev, approval_required: policyCheck(totals, pv.policy).requiresOtherFounder }, { founder });
}

/* ---------- versions ---------- */

export const versionSchema = z.object({ id: z.string().uuid() });

/** Editing an approved, sent or decided quote makes a new draft version (deterministic id: a retry finds it). */
export async function newVersion(repo: DataRepository, founder: FounderKey, input: z.infer<typeof versionSchema>) {
  const cur = await repo.get("Quotes", input.id, { fresh: true });
  if (!cur) throw new RuleError("Quote not found");
  if (!FROZEN_STATUSES.includes(effectiveStatus(cur, todayParis()))) throw new RuleError("A draft is edited directly; no new version is needed.");
  const nextId = childId(cur.id, "next-version");
  let next = await repo.get("Quotes", nextId, { fresh: true });
  if (!next) {
    const rev = childId(nextId, "lines");
    const old = linesOf(cur, (await repo.list("QuoteLines", { fresh: true })).rows);
    const copies = old.map((l, i) => ({ ...strip(l), id: childId(nextId, rev, String(i)), quote_id: nextId, lines_rev: rev, position: i }));
    const have = new Set((await repo.list("QuoteLines")).rows.filter((l) => l.quote_id === nextId).map((l) => l.id));
    const missing = copies.filter((c) => !have.has(c.id));
    if (missing.length) await repo.insert("QuoteLines", missing, { founder });
    const v = cur.quote_version + 1;
    const pv = await readPolicy(repo);
    [next] = await repo.insert("Quotes", [{
      ...strip(cur), id: nextId, quote_version: v, reference: quoteReference(cur.quote_group_id, v), status: "draft", author: founder, lines_rev: rev,
      valid_until: addDays(todayParis(), pv.policy.validityDays), hour_cost_minor: pv.policy.hourCostMinor, approvals: [], approval_required: false,
      sent_at: null, sent_by: null, decided_at: null, decided_by: null, decline_reason: "", superseded_by: "", pdf_drive_file_id: "",
    }], { founder });
  }
  // Mark the old version (repairable pointer; a conflict here never loses the new version).
  const fresh = await repo.get("Quotes", cur.id, { fresh: true });
  if (fresh && !fresh.superseded_by) {
    try { await repo.update("Quotes", cur.id, fresh.version, { superseded_by: nextId }, { founder }); } catch { /* retried on the next new-version call */ }
  }
  return next;
}

function strip<R extends { created_at: string; updated_at: string; updated_by: string; version: number; is_archived: boolean; write_id: string }>(r: R) {
  const { created_at: _a, updated_at: _b, updated_by: _c, version: _d, is_archived: _e, write_id: _f, ...rest } = r;
  void _a; void _b; void _c; void _d; void _e; void _f;
  return rest;
}

/* ---------- workflow: approve, send, decide ---------- */

export const transitionSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int() });

export async function approveQuote(repo: DataRepository, founder: FounderKey, input: z.infer<typeof transitionSchema>) {
  const q = await repo.get("Quotes", input.id, { fresh: true });
  if (!q) throw new RuleError("Quote not found");
  if (q.status !== "draft") throw new RuleError("Only a draft can be approved.");
  const lines = linesOf(q, (await repo.list("QuoteLines", { fresh: true })).rows);
  if (!lines.length) throw new RuleError("Add at least one line before approval.");
  if (!q.valid_until || !q.payment_terms.trim()) throw new RuleError("Set the validity date and the payment terms before approval.");
  const pv = await readPolicy(repo);
  const totals = totalsOf(q, lines);
  const tax = resolveTax(pv.policy.taxRules, pv.legal.seller_country, q.client_country, totals);
  if (!tax.ok) throw new RuleError(TAX_BLOCK_MESSAGES[tax.reason]);
  const check = policyCheck(totals, pv.policy);
  const err = approvalError(check, q.author, founder, q.trade_recorded);
  if (err) throw new RuleError(err, check.reasons.map((r) => r.key));
  return repo.update("Quotes", q.id, input.expected_version, {
    status: "approved", tax_rule: tax.rule, approval_required: check.requiresOtherFounder,
    approvals: [...q.approvals, { founder, at: new Date().toISOString(), quote_version: q.quote_version, with_other_founder: founder !== q.author }],
  }, { founder });
}

/**
 * The founder sent the PDF themselves (download, then their own email). Logs one proposal_sent activity per quote
 * (idempotency key from the quote group: retries and later versions never count twice).
 */
export async function markSent(repo: DataRepository, founder: FounderKey, input: z.infer<typeof transitionSchema>) {
  const q = await repo.get("Quotes", input.id, { fresh: true });
  if (!q) throw new RuleError("Quote not found");
  const status = effectiveStatus(q, todayParis());
  if (status === "expired") throw new RuleError("This quote has expired: create a new version.");
  if (status !== "approved" && status !== "sent") throw new RuleError("Approve the quote before sending it.");
  const updated = status === "sent" ? q : await repo.update("Quotes", q.id, input.expected_version, { status: "sent", sent_at: new Date().toISOString(), sent_by: founder }, { founder });
  const logged = await logActivity(repo, founder, {
    idempotency_key: childId("proposal-sent", q.quote_group_id), activity_type: "proposal_sent", channel: null, account_id: q.account_id, contact_id: "",
    opportunity_id: q.opportunity_id, fast_contact: null, brand: null, outcome: null, objection: null, objections: [], replies: [], offers_pitched: [], duration_sec: null,
    objection_note: "", met_person: "", notes: q.reference, next_action: "", next_action_due: "", call_session_id: "", list_id: "", phone_dialled: "", market: null,
  });
  return { quote: updated, activity_duplicate: logged.duplicate };
}

export const decideSchema = transitionSchema.extend({ decision: z.enum(["accepted", "declined"]), reason: z.string().trim().max(500).default("") });

/** Client's answer, recorded by a founder. Acceptance books no cash and no revenue; winning the deal is a separate click. */
export async function decideQuote(repo: DataRepository, founder: FounderKey, input: z.infer<typeof decideSchema>) {
  const q = await repo.get("Quotes", input.id, { fresh: true });
  if (!q) throw new RuleError("Quote not found");
  const status = effectiveStatus(q, todayParis());
  if (status === "expired" && input.decision === "accepted") throw new RuleError("This quote has expired: create a new version.");
  if (!["approved", "sent", "expired"].includes(status)) throw new RuleError("Only an approved or sent quote can be accepted or declined.");
  return repo.update("Quotes", q.id, input.expected_version, { status: input.decision, decided_at: new Date().toISOString(), decided_by: founder, decline_reason: input.decision === "declined" ? input.reason : "" }, { founder });
}

/* ---------- PDF and Drive ---------- */

export class MissingFieldsError extends RuleError {}

export async function quotePdf(repo: DataRepository, id: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const q = await repo.get("Quotes", id);
  if (!q) throw new RuleError("Quote not found");
  const t = await repo.listMany(["QuoteLines", "Accounts", "Contacts", "Opportunities"]);
  const acc = t.Accounts.rows.find((a) => a.id === q.account_id) ?? null;
  const lines = linesOf(q, t.QuoteLines.rows);
  const pv = await readPolicy(repo);
  const totals = totalsOf(q, lines);
  const missing = missingForPdf(pv.legal, q, acc?.name ?? "", lines);
  const rules = q.status !== "draft" && q.tax_rule ? [q.tax_rule] : pv.policy.taxRules;
  const tax = resolveTax(rules, pv.legal.seller_country, q.client_country, totals);
  if (!tax.ok) missing.push("tax");
  if (missing.length) throw new MissingFieldsError("Required information is missing: the PDF is not generated.", missing);
  const opp = t.Opportunities.rows.find((o) => o.id === q.opportunity_id);
  const contact = t.Contacts.rows.find((c) => c.id === opp?.primary_contact_id) ?? t.Contacts.rows.find((c) => c.account_id === q.account_id && !c.is_archived) ?? null;
  const bytes = await renderQuotePdf({
    quote: q, lines, totals, tax: tax.ok ? tax : null, legal: pv.legal,
    client: { name: acc?.name ?? "", city: acc?.city ?? "", country: q.client_country, contact: contact?.full_name ?? "", email: contact?.email || acc?.email || "" },
    today: todayParis(),
  });
  return { bytes, filename: `${q.reference}.pdf` };
}

export const driveSchema = z.object({ id: z.string().uuid() });

/** Saves the PDF with the founder's own drive.file grant (never the service account), into the client's folder when linked. */
export async function saveQuoteToDrive(ctx: AppContext, founder: FounderKey, grant: string | null, input: z.infer<typeof driveSchema>) {
  const uploader = ctx.uploaderFor(founder, grant);
  if (!uploader) throw new ConsentRequiredError("https://www.googleapis.com/auth/drive.file", "/api/auth/google/drive");
  const q = await ctx.repo.get("Quotes", input.id, { fresh: true });
  if (!q) throw new RuleError("Quote not found");
  if (q.status === "draft") throw new RuleError("Approve the quote before saving it to Drive.");
  if (q.pdf_drive_file_id) return { file_id: q.pdf_drive_file_id, duplicate: true };
  const { bytes, filename } = await quotePdf(ctx.repo, q.id);
  const links = (await ctx.repo.list("FilesIndex")).rows;
  const clientFolder = links.find((l) => !l.is_archived && l.record_type === "account" && l.record_id === q.account_id && l.mime_type === "application/vnd.google-apps.folder");
  const parent = clientFolder?.file_id ?? (await settingValue(ctx.repo, "drive_folder_id"));
  const f = await uploader.upload(filename, "application/pdf", bytes, parent);
  await ctx.repo.insert("FilesIndex", [{ id: childId("filelink", f.id, "opportunity", q.opportunity_id), file_id: f.id, name: f.name, mime_type: f.mimeType, url: f.webViewLink, record_type: "opportunity", record_id: q.opportunity_id, linked_by: founder }], { founder });
  const fresh = await ctx.repo.get("Quotes", q.id, { fresh: true });
  if (fresh) await ctx.repo.update("Quotes", q.id, fresh.version, { pdf_drive_file_id: f.id }, { founder });
  return { file_id: f.id, url: f.webViewLink, duplicate: false };
}

/* ---------- for Stage 2B (won → client & project) ---------- */

export interface QuoteForProject {
  quote: Quote;
  lines: Line[];
  totals: QuoteTotals;
  oneOffMinor: number;
  mrrMinor: number;
  termMonths: number | null;
  estimatedDeliveryCost: { oneOffMinor: number; monthlyMinor: number; founderHours: number };
  services: { label: string; qty: number; unit_minor: number; kind: "one_off" | "monthly" }[];
}

/**
 * Pure: the quote a project should inherit for an opportunity: the latest accepted version, else the latest approved
 * or sent one that has not expired. Superseded versions are ignored. Null when there is none.
 */
export function pickQuoteForOpportunity(quotes: Quote[], allLines: Line[], opportunityId: string, today: string): QuoteForProject | null {
  const mine = quotes.filter((q) => q.opportunity_id === opportunityId && !q.is_archived).sort((a, b) => b.quote_version - a.quote_version || b.created_at.localeCompare(a.created_at));
  const q = mine.find((x) => x.status === "accepted") ?? mine.find((x) => !x.superseded_by && ["approved", "sent"].includes(effectiveStatus(x, today)));
  if (!q) return null;
  const lines = linesOf(q, allLines);
  const totals = totalsOf(q, lines);
  return {
    quote: q, lines, totals, oneOffMinor: totals.oneOffMinor, mrrMinor: totals.mrrMinor, termMonths: q.term_months,
    estimatedDeliveryCost: { oneOffMinor: totals.oneOffCostMinor, monthlyMinor: totals.monthlyCostMinor, founderHours: Math.round(lines.reduce((s, l) => s + l.est_hours_x100, 0) / 100) },
    services: lines.map((l) => ({ label: l.label, qty: l.quantity_x100 / 100, unit_minor: l.unit_price_minor - Math.round((l.unit_price_minor * l.discount_bp) / 10_000), kind: l.billing === "monthly" ? "monthly" as const : "one_off" as const })),
  };
}

export async function quoteForOpportunity(repo: DataRepository, opportunityId: string): Promise<QuoteForProject | null> {
  const t = await repo.listMany(["Quotes", "QuoteLines"]);
  return pickQuoteForOpportunity(t.Quotes.rows, t.QuoteLines.rows, opportunityId, todayParis());
}

