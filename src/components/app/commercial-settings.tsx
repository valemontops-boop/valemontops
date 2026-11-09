"use client";
/** Settings › Commercial (D074): legal details printed on quotes, commercial policy, taxes by jurisdiction, price book. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, Select, Skeleton, Textarea } from "@/components/ui/form";
import { api } from "@/lib/api";
import { formatEur } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/react";
import { LEGAL_FIELDS, LEGAL_FIELD_LABELS, PRICE_MODES, REQUIRED_LEGAL_FIELDS, UNITS, UNIT_LABELS, type DiscountBand, type LegalField, type TaxRule } from "@/domain/quotes";
import type { commercialOverview } from "@/server/services/commercial";

type Overview = Awaited<ReturnType<typeof commercialOverview>>;
type Item = Overview["priceBook"][number];
const eurIn = (minor: number | null) => (minor === null ? "" : String(minor / 100).replace(".", ","));
const toMinor = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(",", ".")) * 100));
const MODE_LABELS: Record<(typeof PRICE_MODES)[number], string> = { fixed: "Fixed price", range: "Price range", quote: "On quote", founder_entered: "Founder-entered" };
const APPROVAL_LABELS: Record<DiscountBand["approval"], string> = { none: "No approval", other_founder: "Other founder + trade", forbidden: "Not allowed" };

export function CommercialSettings() {
  const t = useT();
  const q = useQuery({ queryKey: ["commercial"], queryFn: () => api<Overview>("/api/commercial") });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-2">{t("Every change is a new version from its effective date; quotes already approved keep their figures.")}</p>
      <LegalPanel key={JSON.stringify(q.data.legal)} data={q.data} />
      <PolicyPanel key={JSON.stringify([q.data.policy, q.data.paymentTerms])} data={q.data} />
      <PriceBookPanel data={q.data} />
    </div>
  );
}

function useSavePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: { key: string; value: string; effective_from: string }[]) => {
      for (const c of changes) await api("/api/commercial/policy", { body: { id: crypto.randomUUID(), ...c } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commercial"] }); qc.invalidateQueries({ queryKey: ["deal"] }); },
  });
}

function LegalPanel({ data }: { data: Overview }) {
  const t = useT();
  const [v, setV] = React.useState<Record<LegalField, string>>(data.legal);
  const m = useSavePolicy();
  const changed = LEGAL_FIELDS.filter((f) => v[f] !== data.legal[f]);
  const missing = REQUIRED_LEGAL_FIELDS.filter((f) => !v[f].trim());
  return (
    <Panel>
      <PanelTitle>{t("Legal details on quotes")}</PanelTitle>
      <p className="mb-4 text-[13px] text-text-2">{t("Entered by a founder, never invented. A quote PDF is blocked while a required field is empty, and the field is named.")}</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(changed.map((f) => ({ key: f, value: v[f], effective_from: data.today })), { onSuccess: () => toast(t("Saved")) }); }}>
        {LEGAL_FIELDS.map((f) => (
          <Field key={f} label={`${t(LEGAL_FIELD_LABELS[f])}${REQUIRED_LEGAL_FIELDS.includes(f) ? " *" : ""}`} htmlFor={`legal-${f}`} className={f === "address" || f === "legal_mentions" ? "sm:col-span-2" : undefined}>
            {f === "seller_country" ? (
              <Select id={`legal-${f}`} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })}><option value="">—</option><option value="FR">{t("France")}</option><option value="ES">{t("Spain")}</option></Select>
            ) : f === "legal_mentions" || f === "address" ? (
              <Textarea id={`legal-${f}`} className="min-h-16" value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
            ) : <Input id={`legal-${f}`} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} />}
          </Field>
        ))}
        {missing.length ? <p className="text-[13px] text-bad sm:col-span-2">{t("Missing for quote PDFs: {fields}", { fields: missing.map((f) => t(LEGAL_FIELD_LABELS[f])).join(", ") })}</p> : null}
        {m.isError ? <div className="sm:col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate(changed.map((f) => ({ key: f, value: v[f], effective_from: data.today })))} /></div> : null}
        <Button type="submit" variant="dark" className="self-start" disabled={!changed.length || m.isPending}>{m.isPending ? t("Saving…") : t("Save legal details")}</Button>
      </form>
    </Panel>
  );
}

function PolicyPanel({ data }: { data: Overview }) {
  const t = useT();
  const p = data.policy;
  const [guard, setGuard] = React.useState(String(p.marginGuardrailPct));
  const [validity, setValidity] = React.useState(String(p.validityDays));
  const [cont, setCont] = React.useState(String(p.contingencyPct));
  const [bands, setBands] = React.useState<DiscountBand[]>(p.discountBands);
  const [taxes, setTaxes] = React.useState<TaxRule[]>(p.taxRules);
  const [terms, setTerms] = React.useState(data.paymentTerms);
  const [from, setFrom] = React.useState(data.today);
  const m = useSavePolicy();
  const changes = [
    ["margin_guardrail_pct", guard, String(p.marginGuardrailPct)],
    ["validity_days", validity, String(p.validityDays)],
    ["contingency_pct", cont, String(p.contingencyPct)],
    ["discount_bands", JSON.stringify(bands), JSON.stringify(p.discountBands)],
    ["tax_rules", JSON.stringify(taxes), JSON.stringify(p.taxRules)],
    ["payment_terms_FR", terms.FR, data.paymentTerms.FR],
    ["payment_terms_ES", terms.ES, data.paymentTerms.ES],
  ].filter(([, a, b]) => a !== b).map(([key, value]) => ({ key, value, effective_from: from }));
  return (
    <Panel>
      <PanelTitle>{t("Commercial policy and taxes")}</PanelTitle>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(changes, { onSuccess: () => toast(t("Saved")) }); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("Margin guardrail %")} htmlFor="pol-guard" hint={t("Below it, the other founder must approve.")}><Input id="pol-guard" inputMode="numeric" className="num" value={guard} onChange={(e) => setGuard(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label={t("Quote validity (days)")} htmlFor="pol-valid"><Input id="pol-valid" inputMode="numeric" className="num" value={validity} onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label={t("Default contingency on cost %")} htmlFor="pol-cont"><Input id="pol-cont" inputMode="numeric" className="num" value={cont} onChange={(e) => setCont(e.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-text-2">{t("Discount bands")}</legend>
          {bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
              <Input aria-label={t("Up to % (band {n})", { n: i + 1 })} inputMode="numeric" className="num" value={String(b.max_pct)} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, max_pct: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)))} />
              <Select aria-label={t("Approval (band {n})", { n: i + 1 })} value={b.approval} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, approval: e.target.value as DiscountBand["approval"] } : x)))}>
                {(Object.keys(APPROVAL_LABELS) as DiscountBand["approval"][]).map((a) => <option key={a} value={a}>{t(APPROVAL_LABELS[a])}</option>)}
              </Select>
              <Button type="button" size="icon" variant="ghost" aria-label={t("Remove band {n}", { n: i + 1 })} disabled={bands.length <= 1} onClick={() => setBands(bands.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="self-start" disabled={bands.length >= 6} onClick={() => setBands([...bands, { max_pct: 100, approval: "forbidden" }])}><Plus /> {t("Add a band")}</Button>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium text-text-2">{t("Tax rules (company country → client country)")}</legend>
          <p className="text-[12px] text-text-3">{t("Rates confirmed by the founders (France 20 %, Spain 21 %). A pair with no rule blocks the quote: cross-border VAT is never guessed.")}</p>
          {taxes.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-[12px] border border-hairline p-2 sm:grid-cols-[5rem_5rem_6rem_6rem_1fr_auto]">
              <Select aria-label={t("Company country (rule {n})", { n: i + 1 })} value={r.seller} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, seller: e.target.value } : x)))}><option value="FR">FR</option><option value="ES">ES</option></Select>
              <Input aria-label={t("Client country (rule {n})", { n: i + 1 })} maxLength={2} value={r.client} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, client: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") } : x)))} />
              <Input aria-label={t("Tax name (rule {n})", { n: i + 1 })} value={r.label} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label={t("Rate % (rule {n})", { n: i + 1 })} inputMode="decimal" className="num" value={String(r.rate_bp / 100).replace(".", ",")} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, rate_bp: Math.round(Number(e.target.value.replace(",", ".")) * 100) || 0 } : x)))} />
              <Input aria-label={t("Mention printed on the quote (rule {n})", { n: i + 1 })} placeholder={t("Mention printed on the quote")} value={r.mention} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, mention: e.target.value } : x)))} />
              <Button type="button" size="icon" variant="ghost" aria-label={t("Remove rule {n}", { n: i + 1 })} onClick={() => setTaxes(taxes.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setTaxes([...taxes, { seller: "FR", client: "", label: "", rate_bp: 0, mention: "" }])}><Plus /> {t("Add a rule")}</Button>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Default payment terms (French quotes)")} htmlFor="pol-pay-fr"><Textarea id="pol-pay-fr" value={terms.FR} onChange={(e) => setTerms({ ...terms, FR: e.target.value })} /></Field>
          <Field label={t("Default payment terms (Spanish quotes)")} htmlFor="pol-pay-es"><Textarea id="pol-pay-es" value={terms.ES} onChange={(e) => setTerms({ ...terms, ES: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("Effective from")} htmlFor="pol-from"><Input id="pol-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Button type="submit" variant="dark" disabled={!changes.length || m.isPending || taxes.some((r) => r.client.length !== 2 || !r.label.trim())}>{m.isPending ? t("Saving…") : t("Save the policy")}</Button>
        </div>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(changes)} /> : null}
      </form>
    </Panel>
  );
}

function PriceBookPanel({ data }: { data: Overview }) {
  const t = useT();
  const locale = useLocale();
  const [editing, setEditing] = React.useState<string | null>(null);
  return (
    <Panel>
      <PanelTitle>{t("Price book")}</PanelTitle>
      <p className="mb-3 text-[13px] text-text-2">{t("Pilot assumptions, not validated market prices. Consulting and Local follow the offer values in Settings › Workspace.")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3"><th className="py-2 font-medium">{t("Item")}</th><th className="font-medium">{t("Price")}</th><th className="text-right font-medium">{t("One-off")}</th><th className="text-right font-medium">{t("Monthly")}</th><th className="text-right font-medium">{t("Versions")}</th><th /></tr></thead>
          <tbody>
            {data.priceBook.map((i) => (
              <React.Fragment key={i.id}>
                <tr className="border-b border-hairline">
                  <td className="py-2 pr-2">{locale === "fr" ? i.name_fr : i.name_es}{i.pilot_assumption ? <span className="ml-2 text-[11px] text-text-3">{t("pilot assumption")}</span> : null}</td>
                  <td className="text-text-2">{t(MODE_LABELS[i.price_mode])}</td>
                  <td className="num text-right">{range(i.list_one_time_minor, i.price_mode === "range" ? i.one_time_max_minor : null)}</td>
                  <td className="num text-right">{range(i.list_monthly_minor, i.price_mode === "range" ? i.monthly_max_minor : null)}</td>
                  <td className="num text-right text-text-2">{i.versions}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(editing === i.id ? null : i.id)}>{editing === i.id ? t("Close") : t("Edit")}</Button></td>
                </tr>
                {editing === i.id ? <tr><td colSpan={6} className="py-3"><PriceItemForm item={i} today={data.today} onDone={() => setEditing(null)} /></td></tr> : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
const range = (a: number | null, b: number | null) => (a === null ? "—" : b !== null && b !== a ? `${formatEur(a)} – ${formatEur(b)}` : formatEur(a));

function PriceItemForm({ item, today, onDone }: { item: Item; today: string; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState({
    name_fr: item.name_fr, name_es: item.name_es, unit: item.unit, price_mode: item.price_mode, otMin: eurIn(item.one_time_min_minor), otMax: eurIn(item.one_time_max_minor), moMin: eurIn(item.monthly_min_minor), moMax: eurIn(item.monthly_max_minor),
    otH: String(item.one_time_hours_x100 / 100), moH: String(item.monthly_hours_x100 / 100), otC: eurIn(item.one_time_cost_minor), moC: eurIn(item.monthly_cost_minor), active: item.active, from: today, notes: item.notes, limits: item.limits,
  });
  const [id] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: () => api("/api/commercial/price-book", { body: {
      id, item_key: item.item_key, effective_from: v.from, active: v.active, brand: item.brand, kind: item.kind, name_fr: v.name_fr, name_es: v.name_es, unit: v.unit, price_mode: v.price_mode,
      one_time_min_minor: toMinor(v.otMin), one_time_max_minor: toMinor(v.otMax), monthly_min_minor: toMinor(v.moMin), monthly_max_minor: toMinor(v.moMax), price_setting_key: item.price_setting_key,
      one_time_hours_x100: Math.round(Number(v.otH.replace(",", ".")) * 100) || 0, monthly_hours_x100: Math.round(Number(v.moH.replace(",", ".")) * 100) || 0,
      one_time_cost_minor: toMinor(v.otC) ?? 0, monthly_cost_minor: toMinor(v.moC) ?? 0, pilot_assumption: item.pilot_assumption, limits: v.limits, notes: v.notes,
    } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commercial"] }); qc.invalidateQueries({ queryKey: ["deal"] }); toast(t("New price version saved")); onDone(); },
  });
  const f = (k: keyof typeof v, label: string) => <Field label={label} htmlFor={`pi-${k}`}><Input id={`pi-${k}`} inputMode="decimal" className="num" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <form className="grid gap-3 rounded-[12px] bg-subtle p-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label={t("Name (French)")} htmlFor="pi-fr" className="sm:col-span-2"><Input id="pi-fr" value={v.name_fr} onChange={(e) => setV({ ...v, name_fr: e.target.value })} /></Field>
      <Field label={t("Name (Spanish)")} htmlFor="pi-es" className="sm:col-span-2"><Input id="pi-es" value={v.name_es} onChange={(e) => setV({ ...v, name_es: e.target.value })} /></Field>
      <Field label={t("Price")} htmlFor="pi-mode"><Select id="pi-mode" value={v.price_mode} onChange={(e) => setV({ ...v, price_mode: e.target.value as Item["price_mode"] })}>{PRICE_MODES.map((p) => <option key={p} value={p}>{t(MODE_LABELS[p])}</option>)}</Select></Field>
      <Field label={t("Unit")} htmlFor="pi-unit"><Select id="pi-unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as Item["unit"] })}>{UNITS.map((u) => <option key={u} value={u}>{t(UNIT_LABELS[u])}</option>)}</Select></Field>
      {f("otMin", t("One-off min (€)"))}{f("otMax", t("One-off max (€)"))}{f("moMin", t("Monthly min (€)"))}{f("moMax", t("Monthly max (€)"))}
      {f("otH", t("Founder hours (one-off)"))}{f("moH", t("Founder hours / month"))}{f("otC", t("Direct costs (€)"))}{f("moC", t("Direct costs / month (€)"))}
      <Field label={t("Effective from")} htmlFor="pi-from"><Input id="pi-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />{t("Offered")}</label>
      {item.price_setting_key ? <p className="text-[12px] text-text-3 sm:col-span-4">{t("The default price comes from Settings › Workspace (offer value).")}</p> : null}
      {m.isError ? <div className="sm:col-span-4"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
      <Button type="submit" variant="dark" className="self-start" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save as a new version")}</Button>
    </form>
  );
}
