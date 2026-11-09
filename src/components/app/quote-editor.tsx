"use client";
/** Quote builder (Stage 2A, D074): lines from the price book, policy and taxes live, approval, versions, PDF, Drive. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FolderUp, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { ApiError, api } from "@/lib/api";
import { cn, formatEur } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/react";
import type { T } from "@/i18n";
import { FOUNDER_NAMES, type FounderKey } from "@/domain/constants";
import {
  BILLINGS, FROZEN_STATUSES, LEGAL_FIELD_LABELS, QUOTE_FIELD_LABELS, QUOTE_STATUS_LABELS, TAX_BLOCK_MESSAGES, UNITS, UNIT_LABELS, policyCheck, quoteTotals, resolveTax,
  type Billing, type LineInput, type Unit,
} from "@/domain/quotes";
import { defaultBilling } from "@/domain/price-book";
import { useMe } from "./providers";
import type { Workspace } from "./deal-view";

type QuoteV = Workspace["quotes"][number];
type Item = Workspace["priceBook"][number];

const num = (s: string) => { const n = Number(String(s).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const x100 = (s: string) => Math.round(num(s) * 100);
const show = (minor: number | null, digits = 2) => (minor === null ? "" : String(Math.round(minor) / 10 ** digits).replace(".", ","));
const pctOf = (bp: number | null) => (bp === null ? "—" : `${(bp / 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);

interface DraftLine { key: string; price_book_item_id: string; item_key: string; label: string; description: string; billing: Billing; unit: Unit; qty: string; price: string; disc: string; hours: string; cost: string; list: number | null; founderEntered: boolean }
interface Draft { language: "FR" | "ES"; valid_until: string; payment_terms: string; term: string; discount: string; contingency: string; trade_recorded: string; scope: string; exclusions: string; milestones: { title: string; timing: string; pct: string }[]; risks: string; pilot_terms: string; notes: string }

function draftOf(q: QuoteV, items: Item[]): { head: Draft; lines: DraftLine[] } {
  return {
    head: {
      language: q.language, valid_until: q.valid_until ?? "", payment_terms: q.payment_terms, term: q.term_months ? String(q.term_months) : "", discount: show(q.discount_bp), contingency: show(q.contingency_bp),
      trade_recorded: q.trade_recorded, scope: q.scope, exclusions: q.exclusions, milestones: q.milestones.map((m) => ({ title: m.title, timing: m.timing, pct: String(m.amount_pct) })), risks: q.risks, pilot_terms: q.pilot_terms, notes: q.notes,
    },
    lines: q.lines.map((l) => ({
      key: l.id, price_book_item_id: l.price_book_item_id, item_key: l.item_key, label: l.label, description: l.description, billing: l.billing, unit: l.unit,
      qty: show(l.quantity_x100), price: show(l.unit_price_minor), disc: show(l.discount_bp), hours: show(l.est_hours_x100), cost: show(l.direct_cost_minor), list: l.list_unit_price_minor,
      founderEntered: items.find((i) => i.id === l.price_book_item_id)?.price_mode === "founder_entered",
    })),
  };
}
const toLine = (l: DraftLine): LineInput => ({ billing: l.billing, quantity_x100: x100(l.qty), unit_price_minor: x100(l.price), list_unit_price_minor: l.list, discount_bp: x100(l.disc), est_hours_x100: x100(l.hours), direct_cost_minor: x100(l.cost) });

export function QuoteWorkspace({ ws }: { ws: Workspace }) {
  const t = useT();
  const qc = useQueryClient();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [id] = React.useState(() => crypto.randomUUID());
  const create = useMutation({
    mutationFn: () => api<{ id: string }>("/api/quotes", { body: { id, opportunity_id: ws.opportunity.id, audit_session_id: ws.audits[0]?.id ?? "" } }),
    onSuccess: (q) => { setSelected(q.id); qc.invalidateQueries({ queryKey: ["deal"] }); },
  });
  const q = ws.quotes.find((x) => x.id === selected) ?? ws.quotes[0];
  if (!q)
    return (
      <EmptyState title={t("No quote yet for this deal.")} action={<Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}><Plus /> {create.isPending ? t("Saving…") : ws.audits[0] ? t("Create the quote from the audit") : t("Create a quote")}</Button>}>
        {t("Lines start from the price book; nothing is sent to the client by the app.")}
        {create.isError ? <ErrorState error={create.error} onRetry={() => create.mutate()} /> : null}
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      {ws.quotes.length > 1 ? (
        <div role="radiogroup" aria-label={t("Versions")} className="flex flex-wrap gap-1.5">
          {ws.quotes.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={v.id === q.id} onClick={() => setSelected(v.id)} className={cn("h-8 rounded-full border px-3 text-[13px]", v.id === q.id ? "border-ink bg-ink text-panel" : "border-hairline text-text-2 hover:bg-subtle")}>
              {`v${v.quote_version} · ${t(QUOTE_STATUS_LABELS[v.effective_status])}`}
            </button>
          ))}
        </div>
      ) : null}
      <QuoteEditor key={q.id + q.version} q={q} ws={ws} onVersion={setSelected} />
    </div>
  );
}

function QuoteEditor({ q, ws, onVersion }: { q: QuoteV; ws: Workspace; onVersion: (id: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const me = useMe();
  const qc = useQueryClient();
  const initial = React.useMemo(() => draftOf(q, ws.priceBook), [q, ws.priceBook]);
  const [head, setHead] = React.useState(initial.head);
  const [lines, setLines] = React.useState(initial.lines);
  const frozen = FROZEN_STATUSES.includes(q.effective_status);
  const dirty = !frozen && JSON.stringify({ head, lines }) !== JSON.stringify(initial);
  const refresh = () => qc.invalidateQueries({ queryKey: ["deal"] });

  // Live figures from the draft (the server recomputes the same pure functions on save and approval).
  const qi = { discount_bp: x100(head.discount), term_months: head.term ? Math.round(num(head.term)) : null, contingency_bp: x100(head.contingency) };
  const totals = quoteTotals(qi, lines.map(toLine), q.hour_cost_minor);
  const tax = resolveTax(frozen && q.tax_rule ? [q.tax_rule] : ws.policy.taxRules, ws.sellerCountry, q.client_country, totals);
  const check = policyCheck(totals, ws.policy);
  const author = q.author as FounderKey;
  const other: FounderKey = author === "theo" ? "pablo" : "theo";

  const save = useMutation({
    mutationFn: () => api("/api/quotes", { method: "PATCH", body: {
      id: q.id, expected_version: q.version,
      quote: { language: head.language, valid_until: head.valid_until, payment_terms: head.payment_terms, term_months: qi.term_months, discount_bp: qi.discount_bp, contingency_bp: qi.contingency_bp, trade_recorded: head.trade_recorded, scope: head.scope, exclusions: head.exclusions, milestones: head.milestones.filter((m) => m.title.trim()).map((m) => ({ title: m.title, timing: m.timing, amount_pct: num(m.pct) })), risks: head.risks, pilot_terms: head.pilot_terms, notes: head.notes },
      lines: lines.map((l) => ({ price_book_item_id: l.price_book_item_id, item_key: l.item_key, label: l.label.trim() || "—", description: l.description, billing: l.billing, unit: l.unit, quantity_x100: Math.max(1, x100(l.qty)), unit_price_minor: x100(l.price), discount_bp: x100(l.disc), est_hours_x100: x100(l.hours), direct_cost_minor: x100(l.cost) })),
    } }),
    onSuccess: () => { refresh(); toast(t("Saved")); },
  });
  const step = (path: string, extra: Record<string, unknown> = {}) => api(path, { body: { id: q.id, expected_version: q.version, ...extra } });
  const approve = useMutation({ mutationFn: () => step("/api/quotes/approve"), onSuccess: () => { refresh(); toast(t("Quote approved")); } });
  const sent = useMutation({ mutationFn: () => step("/api/quotes/sent"), onSuccess: () => { refresh(); toast(t("Marked as sent. Proposal sent counted once.")); } });
  const decide = useMutation({ mutationFn: (v: { decision: "accepted" | "declined"; reason?: string }) => step("/api/quotes/decision", v), onSuccess: () => { refresh(); toast(t("Saved")); } });
  const version = useMutation({ mutationFn: () => api<{ id: string }>("/api/quotes/version", { body: { id: q.id } }), onSuccess: (n) => { refresh(); onVersion(n.id); toast(t("New version created: edit it, then approve it again.")); } });
  const drive = useMutation({ mutationFn: () => api<{ url?: string; duplicate: boolean }>("/api/quotes/drive", { body: { id: q.id } }), onSuccess: (r) => { refresh(); toast(r.duplicate ? t("Already in Drive") : t("Saved in Google Drive")); } });
  const won = useMutation({
    mutationFn: () => api("/api/crm/opportunities", { method: "PATCH", body: { id: ws.opportunity.id, expected_version: ws.opportunity.version, patch: { stage: "won" }, stage_reason: t("Quote accepted") } }),
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["crm"] }); toast(t("Deal marked won")); },
  });
  const [pdf, setPdf] = React.useState<{ url: string; name: string; blob: Blob } | null>(null);
  const [pdfErr, setPdfErr] = React.useState<ApiError | null>(null);
  const [pdfBusy, setPdfBusy] = React.useState(false);
  const getPdf = async (download: boolean) => {
    setPdfBusy(true);
    setPdfErr(null);
    try {
      const res = await fetch(`/api/quotes/pdf?id=${q.id}&download=${download ? 1 : 0}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${q.reference}.pdf`;
      if (download) await saveBlob(name, blob, t);
      else setPdf({ url: URL.createObjectURL(blob), name, blob });
    } catch (e) {
      if (e instanceof ApiError) setPdfErr(e);
      else toast.error(t("The PDF could not be generated. Retry."));
    } finally {
      setPdfBusy(false);
    }
  };

  const items = ws.priceBook;
  const nameOf = (i: Item) => (locale === "fr" ? i.name_fr : i.name_es);
  const [pick, setPick] = React.useState("");
  const addItem = () => {
    const i = items.find((x) => x.id === pick);
    if (!i) return;
    const label = head.language === "FR" ? i.name_fr : i.name_es;
    const mk = (billing: Billing): DraftLine => ({
      key: crypto.randomUUID(), price_book_item_id: i.id, item_key: i.item_key, label: billing === "one_time" && (i.list_monthly_minor ?? 0) > 0 ? `${label} · ${head.language === "FR" ? "mise en place" : "puesta en marcha"}` : label,
      description: "", billing, unit: billing === "monthly" ? "month" : i.unit === "month" ? "unit" : i.unit, qty: "1",
      price: show(billing === "monthly" ? i.list_monthly_minor : i.list_one_time_minor) || "0", disc: "0",
      hours: show(billing === "monthly" ? i.monthly_hours_x100 : i.one_time_hours_x100) || "0", cost: show(billing === "monthly" ? i.monthly_cost_minor : i.one_time_cost_minor) || "0",
      list: billing === "monthly" ? i.list_monthly_minor : i.list_one_time_minor, founderEntered: i.price_mode === "founder_entered",
    });
    // A set-up fee and a monthly price are two lines: a set-up fee never goes into MRR.
    const both = (i.list_one_time_minor ?? 0) > 0 && (i.list_monthly_minor ?? 0) > 0;
    setLines((ls) => [...ls, ...(both ? [mk("one_time"), mk("monthly")] : [mk(defaultBilling({ unit: i.unit, monthly_min_minor: i.list_monthly_minor, one_time_min_minor: i.list_one_time_minor }))])]);
    setPick("");
  };
  const setLine = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const h = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setHead({ ...head, [k]: e.target.value });

  const errorOf = (m: { error: unknown }) => (m.error instanceof ApiError ? m.error : null);
  const anyErr = [save, approve, sent, decide, version, drive, won].map(errorOf).find(Boolean) ?? null;
  const consent = anyErr?.body.error === "consent_required";
  const accepted = q.effective_status === "accepted";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel>
          <PanelTitle action={<span className={cn("rounded-full px-3 py-1 text-[12px] font-medium", q.effective_status === "expired" || q.effective_status === "declined" ? "bg-[#fbeceb] text-bad" : accepted ? "bg-[#e6f2ec] text-good" : "bg-subtle text-text-2")}>{t(QUOTE_STATUS_LABELS[q.effective_status])}</span>}>
            {q.reference}
          </PanelTitle>
          {frozen ? <p className="mb-3 text-[13px] text-text-2">{t("This version is frozen. To change it, create a new version.")}</p> : null}
          <h3 className="mb-2 text-sm font-semibold">{t("Lines")}</h3>
          <ul className="flex flex-col gap-3">
            {lines.map((l, idx) => (
              <li key={l.key} className="rounded-[12px] border border-hairline p-3">
                <div className="flex flex-wrap gap-2">
                  <Input aria-label={t("Line {n}", { n: idx + 1 })} disabled={frozen} className="min-w-48 flex-1" value={l.label} onChange={(e) => setLine(l.key, { label: e.target.value })} />
                  <Select aria-label={t("Billing")} disabled={frozen} className="w-36" value={l.billing} onChange={(e) => setLine(l.key, { billing: e.target.value as Billing, unit: e.target.value === "monthly" ? "month" : l.unit === "month" ? "unit" : l.unit })}>
                    {BILLINGS.map((b) => <option key={b} value={b}>{t(b === "monthly" ? "Monthly" : "One-off")}</option>)}
                  </Select>
                  {!frozen ? <Button type="button" size="icon" variant="ghost" aria-label={t("Remove line {n}", { n: idx + 1 })} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button> : null}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <Field label={t("Quantity")} htmlFor={`qty-${l.key}`}><Input id={`qty-${l.key}`} disabled={frozen} inputMode="decimal" className="num h-9" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></Field>
                  <Field label={t("Unit")} htmlFor={`unit-${l.key}`}><Select id={`unit-${l.key}`} disabled={frozen || l.billing === "monthly"} className="h-9" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value as Unit })}>{UNITS.map((u) => <option key={u} value={u}>{t(UNIT_LABELS[u])}</option>)}</Select></Field>
                  <Field label={t("Unit price (€ ex VAT)")} htmlFor={`price-${l.key}`}><Input id={`price-${l.key}`} disabled={frozen} inputMode="decimal" className="num h-9" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} /></Field>
                  <Field label={t("Discount %")} htmlFor={`disc-${l.key}`}><Input id={`disc-${l.key}`} disabled={frozen} inputMode="decimal" className="num h-9" value={l.disc} onChange={(e) => setLine(l.key, { disc: e.target.value })} /></Field>
                  <Field label={l.billing === "monthly" ? t("Founder hours / month") : t("Founder hours")} htmlFor={`hrs-${l.key}`}><Input id={`hrs-${l.key}`} disabled={frozen} inputMode="decimal" className="num h-9" value={l.hours} onChange={(e) => setLine(l.key, { hours: e.target.value })} /></Field>
                  <Field label={l.billing === "monthly" ? t("Direct costs / month (€)") : t("Direct costs (€)")} htmlFor={`cost-${l.key}`}><Input id={`cost-${l.key}`} disabled={frozen} inputMode="decimal" className="num h-9" value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} /></Field>
                </div>
                {l.list !== null && x100(l.price) < l.list ? <p className="mt-1 text-[12px] text-text-2">{t("List price {price}: the difference counts as a discount.", { price: formatEur(l.list) })}</p> : null}
                {l.founderEntered && x100(l.price) === 0 ? <p className="mt-1 text-[12px] text-bad">{t("Founder-entered price: enter the price.")}</p> : null}
              </li>
            ))}
          </ul>
          {!frozen ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label={t("Add from the price book")} htmlFor="pb-pick" className="min-w-64 flex-1">
                <Select id="pb-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">—</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${nameOf(i)} · ${priceHint(i, t)}`}</option>)}
                </Select>
              </Field>
              <Button type="button" variant="outline" disabled={!pick} onClick={addItem}><Plus /> {t("Add")}</Button>
              <Button type="button" variant="ghost" onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), price_book_item_id: "", item_key: "", label: "", description: "", billing: "one_time", unit: "unit", qty: "1", price: "0", disc: "0", hours: "0", cost: "0", list: null, founderEntered: false }])}>{t("Free line")}</Button>
            </div>
          ) : null}
          <p className="mt-2 text-[12px] text-text-3">{t("Price book prices are pilot assumptions, editable in Settings › Commercial.")}</p>
        </Panel>

        <Panel>
          <PanelTitle>{t("Terms")}</PanelTitle>
          <fieldset disabled={frozen} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Valid until")} htmlFor="q-valid"><Input id="q-valid" type="date" value={head.valid_until} onChange={h("valid_until")} /></Field>
            <Field label={t("Contract term (months)")} htmlFor="q-term" hint={t("First-year value only appears with a term of 12 months or more.")}><Input id="q-term" inputMode="numeric" className="num" value={head.term} onChange={(e) => setHead({ ...head, term: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label={t("Quote discount %")} htmlFor="q-disc"><Input id="q-disc" inputMode="decimal" className="num" value={head.discount} onChange={h("discount")} /></Field>
            <Field label={t("Contingency on cost %")} htmlFor="q-cont"><Input id="q-cont" inputMode="decimal" className="num" value={head.contingency} onChange={h("contingency")} /></Field>
            <Field label={t("Document language")} htmlFor="q-lang"><Select id="q-lang" value={head.language} onChange={h("language")}><option value="FR">{t("French")}</option><option value="ES">{t("Spanish")}</option></Select></Field>
            <Field label={t("Payment terms")} htmlFor="q-pay" className="sm:col-span-2"><Textarea id="q-pay" value={head.payment_terms} onChange={h("payment_terms")} /></Field>
            <Field label={t("Scope")} htmlFor="q-scope" className="sm:col-span-2" hint={t("What is included. Lines coming from the audit are drafts: reread them.")}><Textarea id="q-scope" className="min-h-28" value={head.scope} onChange={h("scope")} /></Field>
            <Field label={t("Exclusions")} htmlFor="q-excl" className="sm:col-span-2"><Textarea id="q-excl" value={head.exclusions} onChange={h("exclusions")} /></Field>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-[13px] font-medium text-text-2">{t("Milestones")}</span>
              {head.milestones.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_8rem_5rem_auto] gap-2">
                  <Input aria-label={t("Milestone {n}", { n: i + 1 })} value={m.title} onChange={(e) => setHead({ ...head, milestones: head.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <Input aria-label={t("When")} placeholder={t("e.g. week 2")} value={m.timing} onChange={(e) => setHead({ ...head, milestones: head.milestones.map((x, j) => (j === i ? { ...x, timing: e.target.value } : x)) })} />
                  <Input aria-label={t("% of the one-off amount")} inputMode="decimal" className="num" value={m.pct} onChange={(e) => setHead({ ...head, milestones: head.milestones.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)) })} />
                  <Button type="button" size="icon" variant="ghost" aria-label={t("Remove milestone {n}", { n: i + 1 })} onClick={() => setHead({ ...head, milestones: head.milestones.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              {head.milestones.length < 12 ? <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setHead({ ...head, milestones: [...head.milestones, { title: "", timing: "", pct: "0" }] })}><Plus /> {t("Add a milestone")}</Button> : null}
            </div>
            <Field label={t("Assumptions and risks")} htmlFor="q-risks" className="sm:col-span-2"><Textarea id="q-risks" value={head.risks} onChange={h("risks")} /></Field>
            <Field label={t("Pilot terms (duration, price, success criteria, conversion)")} htmlFor="q-pilot" className="sm:col-span-2"><Textarea id="q-pilot" value={head.pilot_terms} onChange={h("pilot_terms")} /></Field>
            <Field label={t("Internal notes (not printed)")} htmlFor="q-notes" className="sm:col-span-2"><Textarea id="q-notes" value={head.notes} onChange={h("notes")} /></Field>
          </fieldset>
        </Panel>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <Panel aria-label={t("Totals")}>
          <PanelTitle>{t("Totals")}</PanelTitle>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
            <dt className="text-text-2">{t("One-off (ex VAT)")}</dt><dd className="num text-right text-lg font-semibold">{formatEur(totals.oneOffMinor)}</dd>
            <dt className="text-text-2">{t("MRR (ex VAT)")}</dt><dd className="num text-right text-lg font-semibold">{formatEur(totals.mrrMinor)}<span className="text-[13px] font-normal text-text-2"> {t("/ month")}</span></dd>
            <dt className="text-text-2">{t("First-year contract value (ex VAT)")}</dt>
            <dd className="num text-right text-lg font-semibold">{totals.firstYearMinor === null ? <span className="text-[13px] font-normal text-text-3">{t("needs a term ≥ 12 months")}</span> : formatEur(totals.firstYearMinor)}</dd>
            {tax.ok ? (
              <>
                <dt className="text-text-2">{t("{label} {rate} %", { label: tax.rule.label, rate: tax.rule.rate_bp / 100 })}</dt>
                <dd className="num text-right text-text-2">{formatEur(tax.oneOffTaxMinor)}{totals.mrrMinor ? ` + ${formatEur(tax.mrrTaxMinor)} ${t("/ month")}` : ""}</dd>
              </>
            ) : null}
          </dl>
          {!tax.ok ? <p role="alert" className="mt-3 rounded-[12px] bg-[#fbeceb] p-3 text-[13px] text-bad">{t(TAX_BLOCK_MESSAGES[tax.reason])}</p> : null}
          <div className="mt-4 border-t border-hairline pt-3">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-text-2">{t("Estimated delivery cost")}</dt><dd className="num text-right">{formatEur(totals.oneOffCostMinor)}{totals.mrrMinor ? ` + ${formatEur(totals.monthlyCostMinor)} ${t("/ month")}` : ""}</dd>
              <dt className="text-text-2">{t("Gross margin")}</dt><dd className={cn("num text-right font-medium", check.reasons.some((r) => r.key.includes("guardrail")) && "text-bad")}>{[totals.oneOffMinor ? pctOf(totals.oneOffMarginBp) : null, totals.mrrMinor ? `${pctOf(totals.monthlyMarginBp)} ${t("/ month")}` : null].filter(Boolean).join(" · ") || "—"}</dd>
            </dl>
            <p className="mt-2 text-[12px] text-text-3">{t("Founder hours × {cost} €/h + direct costs + contingency. A quote adds nothing to revenue, cash or MRR.", { cost: q.hour_cost_minor / 100 })}</p>
          </div>
        </Panel>

        <Panel aria-label={t("Approval")}>
          <PanelTitle>{t("Approval")}</PanelTitle>
          {check.reasons.length ? (
            <ul className="mb-3 flex flex-col gap-1 text-[13px] text-bad">{check.reasons.map((r) => <li key={r.key}>{t(r.key, r.vars)}</li>)}</ul>
          ) : <p className="mb-3 text-[13px] text-text-2">{t("Within the commercial policy: either founder can approve.")}</p>}
          {check.requiresOtherFounder && !check.forbidden ? (
            <>
              <p className="mb-2 text-[13px]">{t("Approval by {name} required, with the trade recorded.", { name: FOUNDER_NAMES[other] })}</p>
              <Field label={t("What we got in exchange (trade)")} htmlFor="q-trade"><Textarea id="q-trade" disabled={frozen} value={head.trade_recorded} onChange={h("trade_recorded")} placeholder={t("e.g. 12-month commitment, case study, payment upfront")} /></Field>
            </>
          ) : null}
          {q.approvals.length ? <p className="mt-2 text-[13px] text-good">{q.approvals.map((a) => t("Approved by {name}", { name: FOUNDER_NAMES[a.founder as FounderKey] ?? a.founder })).join(" · ")}</p> : null}
        </Panel>

        <Panel aria-label={t("Actions")}>
          <div className="flex flex-col gap-2">
            {q.status === "draft" ? (
              <>
                <Button variant="dark" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t("Saving…") : t("Save the draft")}</Button>
                <Button variant="primary" disabled={dirty || approve.isPending || !tax.ok || check.forbidden || (check.requiresOtherFounder && me.founder === author)} onClick={() => approve.mutate()}>{approve.isPending ? t("Saving…") : t("Approve")}</Button>
                {dirty ? <p className="text-[12px] text-text-3">{t("Save the draft before approving.")}</p> : check.requiresOtherFounder && me.founder === author ? <p className="text-[12px] text-text-3">{t("{name} must approve this quote.", { name: FOUNDER_NAMES[other] })}</p> : null}
              </>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={pdfBusy} onClick={() => getPdf(false)}><Eye /> {t("Preview PDF")}</Button>
              <Button variant={q.status === "approved" ? "primary" : "outline"} size="sm" disabled={pdfBusy} onClick={() => getPdf(true)}><Download /> {t("Download PDF")}</Button>
              {q.status !== "draft" ? <Button variant="outline" size="sm" disabled={drive.isPending} onClick={() => drive.mutate()}><FolderUp /> {q.pdf_drive_file_id ? t("In Drive") : t("Save to Drive")}</Button> : null}
            </div>
            {q.effective_status === "approved" ? (
              <>
                <Button variant="dark" disabled={sent.isPending} onClick={() => sent.mutate()}>{t("I sent it to the client")}</Button>
                <p className="text-[12px] text-text-3">{t("Download the PDF and send it from your own email. Valemont OS never emails a client.")}</p>
              </>
            ) : null}
            {q.effective_status === "sent" || q.effective_status === "approved" ? <DecideButtons onDecide={(d) => decide.mutate(d)} busy={decide.isPending} /> : null}
            {q.effective_status === "expired" ? <Button variant="ghost" size="sm" onClick={() => decide.mutate({ decision: "declined", reason: "expired" })}>{t("Mark as declined")}</Button> : null}
            {accepted ? (
              ws.opportunity.stage === "won" ? <p className="text-[13px] text-good">{t("Deal won. No cash is booked from a quote: payments come from Money.")}</p> : (
                <>
                  <Button variant="primary" disabled={won.isPending} onClick={() => won.mutate()}>{t("Mark the deal won")}</Button>
                  <p className="text-[12px] text-text-3">{t("Accepted is not paid: no cash or revenue is recorded.")}</p>
                </>
              )
            ) : null}
            {frozen && !q.superseded_by ? <Button variant="ghost" size="sm" disabled={version.isPending} onClick={() => version.mutate()}>{t("Edit (new version)")}</Button> : null}
            {q.superseded_by ? <p className="text-[12px] text-text-3">{t("Replaced by a newer version.")}</p> : null}
          </div>
          {pdfErr ? <MissingFields err={pdfErr} /> : null}
          {consent ? <p className="mt-3 text-sm">{t("Google needs your permission first.")} <a className="font-medium underline" href={`/api/auth/google/drive?back=/crm`}>{t("Allow Drive access")}</a></p> : anyErr ? <ApiProblem err={anyErr} onReload={refresh} /> : null}
        </Panel>
      </div>
      <Modal open={Boolean(pdf)} onOpenChange={(o) => { if (!o && pdf) { URL.revokeObjectURL(pdf.url); setPdf(null); } }} title={pdf?.name ?? ""} wide>
        {pdf ? (
          <div className="flex flex-col gap-3">
            <iframe title={pdf.name} src={pdf.url} className="h-[70vh] w-full rounded-[12px] border border-hairline bg-panel" />
            <Button variant="outline" className="self-start" onClick={() => saveBlob(pdf.name, pdf.blob, t)}><Download /> {t("Download PDF")}</Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function DecideButtons({ onDecide, busy }: { onDecide: (d: { decision: "accepted" | "declined"; reason?: string }) => void; busy: boolean }) {
  const t = useT();
  const [declining, setDeclining] = React.useState(false);
  const [reason, setReason] = React.useState("");
  if (declining)
    return (
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); onDecide({ decision: "declined", reason }); }}>
        <Field label={t("Why did they decline?")} htmlFor="q-decline"><Input id="q-decline" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex gap-2"><Button type="submit" size="sm" variant="danger" disabled={busy}>{t("Mark as declined")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)}>{t("Cancel")}</Button></div>
      </form>
    );
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => onDecide({ decision: "accepted" })}>{t("Client accepted")}</Button>
      <Button size="sm" variant="ghost" className="flex-1" disabled={busy} onClick={() => setDeclining(true)}>{t("Client declined")}</Button>
    </div>
  );
}

function MissingFields({ err }: { err: ApiError }) {
  const t = useT();
  const labels: Record<string, string> = { ...LEGAL_FIELD_LABELS, ...QUOTE_FIELD_LABELS };
  if (!err.body.details?.length) return <div className="mt-3"><ErrorState error={err} /></div>;
  return (
    <div role="alert" className="mt-3 rounded-[12px] bg-[#fbeceb] p-3 text-[13px] text-bad">
      <p className="font-medium">{t("Required information is missing: the PDF is not generated.")}</p>
      <ul className="mt-1 list-disc pl-5">{err.body.details.map((d) => <li key={d}>{t(labels[d] ?? d)}</li>)}</ul>
      <p className="mt-1 text-text-2">{t("Legal details and taxes: Settings › Commercial. Client country: the business in the CRM.")}</p>
    </div>
  );
}

function ApiProblem({ err, onReload }: { err: ApiError; onReload: () => void }) {
  const t = useT();
  if (err.isConflict) return <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-bad">{t("Someone else changed this record. Review both versions.")} <Button size="sm" variant="outline" onClick={onReload}>{t("Reload")}</Button></p>;
  return (
    <div role="alert" className="mt-3 text-[13px] text-bad">
      <p>{t(err.message)}</p>
      {err.body.details?.length ? <ul className="list-disc pl-5">{err.body.details.map((d) => <li key={d}>{t(d)}</li>)}</ul> : null}
    </div>
  );
}

function priceHint(i: Item, t: T): string {
  const parts: string[] = [];
  if (i.price_mode === "quote") return t("on quote");
  if (i.list_one_time_minor) parts.push(formatEur(i.list_one_time_minor));
  if (i.list_monthly_minor) parts.push(`${formatEur(i.list_monthly_minor)} ${t("/ month")}`);
  if (!parts.length) return i.price_mode === "founder_entered" ? t("price to enter") : formatEur(0);
  return parts.join(" + ");
}

/** Same download path as Export for AI: the preview viewer's downloads capability, else a plain link. */
export async function saveBlob(name: string, blob: Blob, t: T) {
  const host = (window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (f: { filename: string; data: Blob }) => Promise<unknown> } | null> } }).claude;
  const saver = host?.use ? await host.use("downloads").catch(() => null) : null;
  if (saver) {
    try { await saver.save({ filename: name, data: blob }); toast.success(`${t("File downloaded")}: ${name}`); }
    catch (err) { if ((err as { code?: string }).code !== "declined") toast.error(t("The PDF could not be generated. Retry.")); }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast.success(`${t("File downloaded")}: ${name}`);
}
