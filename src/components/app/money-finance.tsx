"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Panel, PanelTitle, SegmentedSwitch, Select } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import { BANK_CATEGORIES, CATEGORY_LABELS, type BankCategory } from "@/domain/bank";
import { COST_CENTERS, COST_CENTER_LABELS, COST_CLASSES, COST_CLASS_LABELS, type CostCenter } from "@/domain/finance-constants";
import { useDateTag, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";
import type { Fin, FinItemView } from "./money-view";
import { ManualRateForm, RateInUse, UsdAmount, useRateLabel } from "./usd-line";

/** Display currency (spec 3.12): a reporting conversion at the latest rate, never a restatement of stored amounts. */
export type Fmt = (eurMinor: number | null | undefined) => string;
export const FmtContext = React.createContext<Fmt>((m) => formatMoney(m));
export const useFmt = () => React.useContext(FmtContext);

type PnlMonth = Fin["pnl"][number];
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);
/** "12,50" / "12.50" / "1 234,5" → 1250 cents; null when not a positive amount. */
export function parseAmount(s: string): number | null {
  const v = s.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}
const useInvalidate = () => { const qc = useQueryClient(); return () => { qc.invalidateQueries({ queryKey: ["finance"] }); qc.invalidateQueries({ queryKey: ["money"] }); }; };
function useOnError() {
  const t = useT();
  const inv = useInvalidate();
  return (e: unknown) => {
    if (e instanceof ApiError && e.isConflict) { toast(t("Someone else changed this record. Review both versions.")); inv(); return; }
    toast((e as Error).message);
  };
}

/* ---------------- P&L ---------------- */
type Line = { key: string; label: string; value: (m: PnlMonth) => number | null; strong?: boolean; pct?: boolean; drill?: string[]; muted?: boolean };

export function PnlTab({ fin }: { fin: Fin }) {
  const t = useT();
  const dt = useDateTag();
  const fmt = useFmt();
  const [span, setSpan] = React.useState<"6" | "12" | "ytd">("6");
  const [cell, setCell] = React.useState<{ month: string | null; lines: string[]; label: string } | null>(null);
  const year = fin.today.slice(0, 4);
  const months = span === "ytd" ? fin.pnl.filter((m) => m.month.startsWith(year)) : fin.pnl.slice(-Number(span));
  const total = sum(months);
  const opexCats = [...new Set(months.flatMap((m) => Object.keys(m.opex_by_category)))].sort((a, b) => (total.opex_by_category[b] ?? 0) - (total.opex_by_category[a] ?? 0));
  const ebitdaLabel = months.some((m) => m.provisional) ? t("Provisional EBITDA (invoice-based estimate)") : t("Estimated EBITDA");
  const lines: (Line | { heading: string })[] = [
    { heading: t("Recognized revenue, ex VAT") },
    ...COST_CENTERS.filter((c) => c !== "shared" || months.some((m) => m.revenue.shared)).map((c): Line => ({ key: `rev:${c}`, label: t(c === "shared" ? "Not allocated" : COST_CENTER_LABELS[c]), value: (m) => m.revenue[c], drill: [`rev:${c}`] })),
    { key: "rev", label: t("Recognized revenue"), value: (m) => m.revenue.total, strong: true, drill: COST_CENTERS.map((c) => `rev:${c}`) },
    { key: "direct", label: t("Direct costs"), value: (m) => m.direct, drill: ["direct"] },
    { key: "gp", label: t("Gross profit"), value: (m) => m.gross_profit, strong: true },
    { key: "gm", label: t("Gross margin (%)"), value: (m) => m.gross_margin, pct: true, muted: true },
    { heading: t("Operating expenses") },
    ...opexCats.map((c): Line => ({ key: `opex:${c}`, label: t(CATEGORY_LABELS[c as BankCategory] ?? c), value: (m) => m.opex_by_category[c] ?? 0, drill: [`opex:${c}`] })),
    { key: "opex", label: t("Operating expenses"), value: (m) => m.opex, strong: true, drill: opexCats.map((c) => `opex:${c}`) },
    { key: "ebitda", label: ebitdaLabel, value: (m) => m.ebitda, strong: true },
    { heading: t("Cash, VAT included (not revenue)") },
    { key: "cash_in", label: t("Cash received"), value: (m) => m.cash_in, drill: ["cash_in"] },
    { key: "cash_out", label: t("Cash paid"), value: (m) => m.cash_out, drill: ["cash_out"] },
    { key: "vat_in", label: t("VAT collected"), value: (m) => m.vat_in, drill: ["vat_in"], muted: true },
    { key: "vat_out", label: t("VAT paid on expenses"), value: (m) => m.vat_out, drill: ["vat_out"], muted: true },
    { key: "excluded", label: t("Outside EBITDA (taxes, VAT, interest)"), value: (m) => m.excluded, drill: ["excluded"], muted: true },
    { key: "neutral", label: t("Contributions, transfers, loans"), value: (m) => m.neutral, drill: ["neutral"], muted: true },
  ];
  const label = new Intl.DateTimeFormat(dt, { month: "short", year: "2-digit" });
  const show = (l: Line, m: PnlMonth) => { const v = l.value(m); return l.pct ? (v === null ? "—" : `${Math.round(v * 1000) / 10} %`) : v ? fmt(v) : "—"; };
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <Panel className="min-w-0 flex-1">
        <PanelTitle action={<SegmentedSwitch size="sm" label={t("Period")} value={span} onChange={setSpan} options={[{ value: "6", label: t("6 months") }, { value: "12", label: t("12 months") }, { value: "ytd", label: t("Year to date") }]} />}>{t("Managerial P&L by month")}</PanelTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-text-3">
                <th className="py-2 pr-3 font-medium">{t("Line")}</th>
                {months.map((m) => <th key={m.month} className="num px-2 py-2 text-right font-medium">{label.format(new Date(`${m.month}-15T12:00:00Z`))}{m.provisional ? <span title={t("provisional")}> *</span> : null}</th>)}
                <th className="num py-2 pl-2 text-right font-medium">{t("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => "heading" in l ? (
                <tr key={`h${i}`}><td colSpan={months.length + 2} className="pb-1 pt-4 text-[12px] font-semibold text-text-2">{l.heading}</td></tr>
              ) : (
                <tr key={l.key} className={cn("border-t border-hairline", l.strong && "font-semibold", l.muted && "text-text-2")}>
                  <td className="py-1.5 pr-3">{l.label}</td>
                  {[...months, total].map((m, j) => {
                    const isTotal = j === months.length;
                    const v = l.value(m);
                    const neg = !l.pct && typeof v === "number" && v < 0;
                    return (
                      <td key={j} className={cn("num px-2 py-1.5 text-right", isTotal && "pl-2", neg && "text-bad")}>
                        {l.drill && v ? (
                          <button type="button" className="rounded px-1 hover:bg-subtle" onClick={() => setCell({ month: isTotal ? null : m.month, lines: l.drill!, label: `${l.label} · ${isTotal ? t("Total") : label.format(new Date(`${m.month}-15T12:00:00Z`))}` })}>{show(l, m)}</button>
                        ) : show(l, m)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-text-3">{t("Management accounting, not statutory accounts or certified invoicing. Revenue is recognized over the service period (or the contract schedule); cash is what was actually received or paid. Estimated EBITDA = recognized revenue − direct costs − operating expenses (no interest, taxes, depreciation). * Provisional: part of the revenue is recognized on the payment date. Quotes and the weighted pipeline are never revenue.")}</p>
      </Panel>
      {cell ? <DrillPanel fin={fin} months={months.map((m) => m.month)} {...cell} onClose={() => setCell(null)} /> : null}
    </div>
  );
}
function sum(ms: PnlMonth[]): PnlMonth {
  const t: PnlMonth = { month: "total", revenue: { consulting: 0, local: 0, thirty: 0, shared: 0, total: 0 }, direct: 0, gross_profit: 0, gross_margin: null, opex: 0, opex_by_category: {}, ebitda: 0, provisional: false, cash_in: 0, cash_out: 0, vat_in: 0, vat_out: 0, excluded: 0, neutral: 0 };
  for (const m of ms) {
    for (const c of COST_CENTERS) t.revenue[c] += m.revenue[c];
    t.revenue.total += m.revenue.total; t.direct += m.direct; t.opex += m.opex; t.ebitda += m.ebitda; t.gross_profit += m.gross_profit;
    for (const [k, v] of Object.entries(m.opex_by_category)) t.opex_by_category[k] = (t.opex_by_category[k] ?? 0) + v;
    t.cash_in += m.cash_in; t.cash_out += m.cash_out; t.vat_in += m.vat_in; t.vat_out += m.vat_out; t.excluded += m.excluded; t.neutral += m.neutral;
    t.provisional ||= m.provisional;
  }
  t.gross_margin = t.revenue.total ? t.gross_profit / t.revenue.total : null;
  return t;
}

/** Drill-down: the movements and schedule lines behind one P&L cell. */
function DrillPanel({ fin, month, months, lines, label, onClose }: { fin: Fin; month: string | null; months: string[]; lines: string[]; label: string; onClose: () => void }) {
  const t = useT();
  const dt = useDateTag();
  const fmt = useFmt();
  const items = new Map(fin.items.map((i) => [i.id, i]));
  const sched = new Map(fin.schedule.map((s) => [s.id, s]));
  const rows = new Map<string, number>();
  for (const c of fin.contributions) if (lines.includes(c.line) && (month ? c.month === month : months.includes(c.month))) rows.set(c.ref, (rows.get(c.ref) ?? 0) + c.amount);
  const list = [...rows.entries()].map(([ref, amount]) => ({ ref, amount, it: items.get(ref), s: sched.get(ref) })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return (
    <DetailPanel open onClose={onClose} title={<h2 className="text-base font-semibold">{label}</h2>}>
      <p className="mb-3 text-[13px] text-text-2">{t("{n} lines", { n: list.length })} · {fmt(list.reduce((a, r) => a + r.amount, 0))}</p>
      <ul className="flex flex-col divide-y divide-hairline">
        {list.map(({ ref, amount, it, s }) => (
          <li key={ref} className="flex items-start justify-between gap-3 py-2 text-[13px]">
            <div className="min-w-0">
              <p className="truncate">{it ? it.counterparty || t(it.label) || "—" : s ? t(s.label) : "—"}</p>
              <p className="text-[12px] text-text-3">
                {it ? `${new Date(`${it.date}T12:00:00Z`).toLocaleDateString(dt, { day: "2-digit", month: "short", year: "numeric" })} · ${it.source === "bank" ? (it.bank === "stripe" ? "Stripe" : "Wise") : t("Manual entry")}` : s ? `${t("Revenue schedule")} · ${s.earned_on ?? s.period_start}` : ""}
                {it?.service_from ? ` · ${t("service {from} → {to}", { from: it.service_from, to: it.service_to ?? "" })}` : ""}
                {it && it.currency !== "EUR" ? ` · ${formatMoney(Math.abs(it.gross_minor), it.currency)}` : ""}
              </p>
            </div>
            <span className="num shrink-0">{fmt(amount)}</span>
          </li>
        ))}
      </ul>
    </DetailPanel>
  );
}

/* ---------------- one bank movement: how it is read ---------------- */
export function AllocationPanel({ item, fin, onClose }: { item: FinItemView; fin: Fin; onClose: () => void }) {
  const t = useT();
  const inv = useInvalidate();
  const onError = useOnError();
  const [f, setF] = React.useState({
    cost_center: item.cost_center as CostCenter, cost_class: "" as "" | (typeof COST_CLASSES)[number], vat: item.vat_minor ? (Math.abs(item.vat_minor) / 100).toFixed(2) : "",
    service_from: item.service_from ?? "", service_to: item.service_to ?? "", contract_id: item.contract_id, project_id: item.project_id, receipt_url: item.receipt_url, reference: item.reference, reconciled: item.reconciled,
  });
  const save = useMutation({
    mutationFn: () => {
      const vat = f.vat.trim() ? parseAmount(f.vat) : 0;
      if (vat === null) throw new Error(t("Invalid amount"));
      return api("/api/finance/allocation", { method: "PATCH", body: { bank_tx_id: item.id, expected_version: item.alloc_version, cost_center: f.cost_center, cost_class: f.cost_class, vat_minor: vat, service_from: f.service_from || null, service_to: f.service_to || null, contract_id: f.contract_id, project_id: f.project_id, receipt_url: f.receipt_url.trim(), reference: f.reference.trim(), reconciled: f.reconciled, note: "" } });
    },
    onSuccess: () => { toast(t("Saved")); inv(); onClose(); },
    onError,
  });
  return (
    <DetailPanel open onClose={onClose} title={<div><h2 className="text-base font-semibold">{item.counterparty || t(item.label) || "—"}</h2><p className="text-[13px] text-text-2">{formatMoney(item.gross_minor, item.currency)}{item.currency !== "EUR" ? ` · ${t("not in EUR, not converted")}` : ""} · {t(CATEGORY_LABELS[item.category])}</p></div>}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button><Button variant="dark" disabled={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button></div>}>
      <div className="flex flex-col gap-4">
        {item.auto ? <p className="text-[13px] text-text-2">{t("Suggested automatically; saving confirms it.")}</p> : null}
        <Field label={t("Activity")} htmlFor="al-cc"><Select id="al-cc" value={f.cost_center} onChange={(e) => setF({ ...f, cost_center: e.target.value as CostCenter })}>{COST_CENTERS.map((c) => <option key={c} value={c}>{t(COST_CENTER_LABELS[c])}</option>)}</Select></Field>
        <Field label={t("In the P&L")} htmlFor="al-cls" hint={t("Default from the category: {x}", { x: t(COST_CLASS_LABELS[item.cls]) })}><Select id="al-cls" value={f.cost_class} onChange={(e) => setF({ ...f, cost_class: e.target.value as typeof f.cost_class })}><option value="">{t("From the category")}</option>{COST_CLASSES.map((c) => <option key={c} value={c}>{t(COST_CLASS_LABELS[c])}</option>)}</Select></Field>
        <Field label={t("VAT included in the amount")} htmlFor="al-vat" hint={t("Revenue and costs are ex VAT; cash includes VAT.")}><Input id="al-vat" inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} placeholder="0,00" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Service from")} htmlFor="al-sf"><Input id="al-sf" type="date" value={f.service_from} onChange={(e) => setF({ ...f, service_from: e.target.value })} /></Field>
          <Field label={t("Service to")} htmlFor="al-st"><Input id="al-st" type="date" value={f.service_to} onChange={(e) => setF({ ...f, service_to: e.target.value })} /></Field>
        </div>
        <Field label={t("Contract")} htmlFor="al-ct"><Select id="al-ct" value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })}><option value="">—</option>{fin.contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label={t("Project")} htmlFor="al-pr"><Select id="al-pr" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">—</option>{fin.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label={t("Invoice or receipt reference")} htmlFor="al-ref"><Input id="al-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label={t("Receipt link (Drive)")} htmlFor="al-rc"><Input id="al-rc" type="url" placeholder="https://" value={f.receipt_url} onChange={(e) => setF({ ...f, receipt_url: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.reconciled} onChange={(e) => setF({ ...f, reconciled: e.target.checked })} />{t("Reconciled (checked against the invoice or receipt)")}</label>
      </div>
    </DetailPanel>
  );
}

/* ---------------- manual entries ---------------- */
export function EntriesPanel({ fin }: { fin: Fin }) {
  const t = useT();
  const dt = useDateTag();
  const inv = useInvalidate();
  const onError = useOnError();
  const [adding, setAdding] = React.useState(false);
  const rows = fin.items.filter((i) => i.source === "manual");
  const rev = useMutation({ mutationFn: (id: string) => api("/api/finance/entries/reverse", { body: { id } }), onSuccess: () => { toast(t("Reversed")); inv(); }, onError });
  return (
    <Panel>
      <PanelTitle action={<Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> {t("Add an entry")}</Button>}>{t("Manual entries")}</PanelTitle>
      <p className="mb-3 text-[13px] text-text-2">{t("Only money that did not go through Wise or Stripe (cash, another account, a card refunded later). History is never erased: a mistake is cancelled by a reversing entry.")}</p>
      {rows.length === 0 ? <p className="text-sm text-text-2">{t("Nothing here.")}</p> : (
        <ul className="flex flex-col divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[5rem_1fr_9rem_auto]">
              <span className="num text-[12px] text-text-3">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString(dt, { day: "2-digit", month: "short" })}</span>
              <span className="min-w-0 text-sm">
                <span className="truncate">{r.counterparty || t(r.label) || "—"}</span>
                <span className="block text-[12px] text-text-3">{t(CATEGORY_LABELS[r.category])} · {t(COST_CENTER_LABELS[r.cost_center])}{r.kind === "adjustment" ? ` · ${t("reversing entry")}` : ""}{r.reversed ? ` · ${t("reversed")}` : ""}{r.reference ? ` · ${r.reference}` : ""}{r.receipt_url ? <> · <a className="underline" href={r.receipt_url} target="_blank" rel="noreferrer">{t("receipt")}</a></> : null}</span>
              </span>
              <span className="num text-right text-sm">
                {r.currency === "USD" ? <UsdAmount usd={r.gross_minor} eur={r.eur_gross} rate={r.fx} className="block text-[13px]" /> : formatMoney(r.gross_minor, r.currency)}
                {r.currency !== "EUR" && r.currency !== "USD" ? <span className="block text-[11px] text-text-3">{t("not in EUR, not converted")}</span> : null}
              </span>
              {r.kind !== "adjustment" && !r.reversed ? <Button size="sm" variant="ghost" disabled={rev.isPending} onClick={() => rev.mutate(r.id)}>{t("Reverse")}</Button> : <span />}
            </li>
          ))}
        </ul>
      )}
      {adding ? <EntryForm fin={fin} onClose={() => setAdding(false)} /> : null}
    </Panel>
  );
}

function EntryForm({ fin, onClose }: { fin: Fin; onClose: () => void }) {
  const t = useT();
  const inv = useInvalidate();
  const [id] = React.useState(newId); // generated when the form opens, reused on every retry (spec 4.2)
  const [err, setErr] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ date: fin.today, kind: "expense" as "income" | "expense", category: "software" as BankCategory, cost_center: "shared" as CostCenter, currency: "EUR" as "EUR" | "USD", wise_tx_id: "", amount: "", vat: "", counterparty: "", reference: "", receipt_url: "", service_from: "", service_to: "", contract_id: "", note: "" });
  const rateLabel = useRateLabel();
  const usd = f.currency === "USD";
  const save = useMutation({
    mutationFn: () => {
      const amount = parseAmount(f.amount), vat = f.vat.trim() ? parseAmount(f.vat) : 0;
      if (!amount || vat === null) throw new Error(t("Invalid amount"));
      return api("/api/finance/entries", { body: { id, date: f.date, kind: f.kind, category: f.category, cost_center: f.cost_center, cost_class: "", currency: f.currency, wise_tx_id: usd ? f.wise_tx_id : "", amount_minor: amount, vat_minor: vat, counterparty: f.counterparty, reference: f.reference, receipt_url: f.receipt_url.trim(), project_id: "", contract_id: f.contract_id, service_from: f.service_from || null, service_to: f.service_to || null, note: f.note } });
    },
    onSuccess: () => { toast(t("Saved")); inv(); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("Add an entry")} description={usd ? t("Amounts in US dollars, ex VAT: converted to euros at the rate shown, locked at entry.") : t("Amounts in euros, ex VAT.")}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        <Field label={t("Type")} htmlFor="en-kind"><Select id="en-kind" value={f.kind} onChange={(e) => { const kind = e.target.value as "income" | "expense"; setF({ ...f, kind, category: kind === "income" ? "revenue" : "software", cost_center: kind === "income" ? "consulting" : "shared", currency: kind === "income" ? "EUR" : f.currency }); }}><option value="expense">{t("Expense")}</option><option value="income">{t("Income")}</option></Select></Field>
        {f.kind === "expense" ? <Field label={t("Currency")} htmlFor="en-cur"><Select id="en-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as "EUR" | "USD", category: e.target.value === "USD" ? "contractors" : f.category })}><option value="EUR">{t("Euro (€)")}</option><option value="USD">{t("US dollar ($)")}</option></Select></Field> : null}
        {usd ? (
          <Field label={t("Wise payment (real rate)")} htmlFor="en-wtx"><Select id="en-wtx" value={f.wise_tx_id} onChange={(e) => setF({ ...f, wise_tx_id: e.target.value })}><option value="">{t("None: rate of the day")}</option>{fin.usd.payments.map((p) => <option key={p.id} value={p.id}>{`${p.date} · ${p.label} · ${formatMoney(p.usd_minor, "USD")} → ${formatMoney(p.eur_minor)}`}</option>)}</Select></Field>
        ) : null}
        {usd ? <p className="col-span-2 text-[13px] text-text-2">{f.wise_tx_id ? (() => { const p = fin.usd.payments.find((x) => x.id === f.wise_tx_id); return p ? rateLabel(p.rate) : ""; })() : fin.usd.current ? <RateInUse rate={fin.usd.current} /> : t("No USD rate: the entry is kept in USD, marked \"rate missing\" and left out of EUR totals. Enter a manual rate first to convert it.")}</p> : null}
        <Field label={t("Date")} htmlFor="en-date"><Input id="en-date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={t("Category")} htmlFor="en-cat"><Select id="en-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as BankCategory })}>{BANK_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>)}</Select></Field>
        <Field label={t("Activity")} htmlFor="en-cc"><Select id="en-cc" value={f.cost_center} onChange={(e) => setF({ ...f, cost_center: e.target.value as CostCenter })}>{COST_CENTERS.map((c) => <option key={c} value={c}>{t(COST_CENTER_LABELS[c])}</option>)}</Select></Field>
        <Field label={t("Amount ex VAT")} htmlFor="en-amt"><Input id="en-amt" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" /></Field>
        <Field label={t("VAT")} htmlFor="en-vat"><Input id="en-vat" inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} placeholder="0,00" /></Field>
        <Field label={t("Client or supplier")} htmlFor="en-cp"><Input id="en-cp" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} /></Field>
        <Field label={t("Service from")} htmlFor="en-sf"><Input id="en-sf" type="date" value={f.service_from} onChange={(e) => setF({ ...f, service_from: e.target.value })} /></Field>
        <Field label={t("Service to")} htmlFor="en-st"><Input id="en-st" type="date" value={f.service_to} onChange={(e) => setF({ ...f, service_to: e.target.value })} /></Field>
        <Field label={t("Invoice or receipt reference")} htmlFor="en-ref"><Input id="en-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label={t("Receipt link (Drive)")} htmlFor="en-rc"><Input id="en-rc" type="url" placeholder="https://" value={f.receipt_url} onChange={(e) => setF({ ...f, receipt_url: e.target.value })} /></Field>
        <Field label={t("Contract")} htmlFor="en-ct"><Select id="en-ct" value={f.contract_id} onChange={(e) => setF({ ...f, contract_id: e.target.value })}><option value="">—</option>{fin.contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label={t("Note")} htmlFor="en-note"><Input id="en-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {err ? <p role="alert" className="col-span-2 text-[13px] text-bad">{err}</p> : null}
        <div className="col-span-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button><Button type="submit" variant="dark" disabled={save.isPending}>{t("Save")}</Button></div>
      </form>
    </Modal>
  );
}

/* ---------------- USD for contractors (D085) ---------------- */
/** Which USD→EUR rate converts contractor payments: Wise today (LIVE), else the manual rate below; no ECB, no display switch. */
export function UsdRatePanel({ fin }: { fin: Fin }) {
  const t = useT();
  const u = fin.usd;
  return (
    <Panel>
      <PanelTitle>{t("Contractors paid in USD")}</PanelTitle>
      <p className="mb-2 text-[13px] text-text-2">{t("Only to pay contractors in dollars: a Wise payment uses its real rate; before paying, the Wise rate of the day, else your manual rate. Everything else stays in euros.")}</p>
      <RateInUse rate={u.current} className="mb-1 text-sm font-medium" />
      {u.mode === "live" && u.wise_status === "failed" ? <p className="mb-2 text-[13px] text-bad">{t("Wise did not give a rate today: the manual rate is used.")}</p> : null}
      {u.mode === "live" && u.wise_status === "not_configured" ? <p className="mb-2 text-[13px] text-text-2">{t("Wise is not connected: the manual rate is used.")}</p> : null}
      {fin.usd_missing.count ? <p className="mb-2 text-[13px] text-bad">{t("{n} USD payments have no rate ({x}): left out of EUR totals.", { n: fin.usd_missing.count, x: formatMoney(fin.usd_missing.usd_minor, "USD") })}</p> : null}
      <ManualRateForm key={`${u.manual_version}`} manual={u.manual} version={u.manual_version} today={u.today} />
    </Panel>
  );
}

/* ---------------- contracts, revenue schedule ---------------- */
export function ContractsTab({ fin }: { fin: Fin }) {
  const t = useT();
  const dt = useDateTag();
  const fmt = useFmt();
  const inv = useInvalidate();
  const onError = useOnError();
  const [adding, setAdding] = React.useState(false);
  const mk = useMutation({ mutationFn: () => api<{ added: number }>("/api/finance/contracts/from-projects", { body: {} }), onSuccess: (r) => { toast(t("{n} contracts created", { n: r.added })); inv(); }, onError });
  const upd = useMutation({ mutationFn: (b: { id: string; expected_version: number; status: string }) => api("/api/finance/contracts", { method: "PATCH", body: b }), onSuccess: () => inv(), onError });
  const line = useMutation({ mutationFn: (b: { id: string; expected_version: number; status: string }) => api("/api/finance/schedules", { method: "PATCH", body: b }), onSuccess: () => inv(), onError });
  const mv = fin.mrr_movements;
  const d = (s: string | null) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString(dt, { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const STATUS: Record<string, string> = { active: "Active", paused: "Paused", ended: "Ended", planned: "Planned", earned: "Earned", cancelled: "Cancelled" };
  return (
    <>
      <Panel>
        <PanelTitle action={<div className="flex flex-wrap gap-2">{fin.projects_without_contract ? <Button size="sm" variant="outline" disabled={mk.isPending} onClick={() => mk.mutate()}>{t("Create contracts from projects")}</Button> : null}<Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> {t("New contract")}</Button></div>}>{t("Client contracts")}</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          {t("MRR {mrr} · ARR {arr} (MRR × 12, a run rate, not booked revenue).", { mrr: fmt(fin.numbers.mrr.value), arr: fmt(fin.numbers.arr) })} {fin.numbers.mrr.source === "stripe" ? t("From Stripe subscriptions: no subscription contract yet.") : fin.numbers.stripe_mrr !== null ? t("Stripe measures {x}.", { x: fmt(fin.numbers.stripe_mrr) }) : ""}
          {" "}{t("This month: new {a}, expansion {b}, contraction {c}, churn {d}, reactivation {e}.", { a: fmt(mv.new), b: fmt(mv.expansion), c: fmt(mv.contraction), d: fmt(mv.churn), e: fmt(mv.reactivation) })}
        </p>
        {fin.contracts.length === 0 ? <p className="text-sm text-text-2">{t("No contract yet. Contracts come from won projects or are entered here.")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="text-left text-text-3"><th className="py-2 pr-3 font-medium">{t("Client")}</th><th className="px-2 font-medium">{t("Activity")}</th><th className="num px-2 text-right font-medium">{t("MRR")}</th><th className="num px-2 text-right font-medium">{t("Set-up")}</th><th className="num px-2 text-right font-medium">{t("One-off")}</th><th className="px-2 font-medium">{t("Period")}</th><th className="pl-2 font-medium">{t("Status")}</th></tr></thead>
              <tbody>
                {fin.contracts.map((c) => (
                  <tr key={c.id} className="border-t border-hairline">
                    <td className="py-1.5 pr-3">{c.client_name || c.name}<span className="block text-[11px] text-text-3">{t(c.kind === "subscription" ? (c.billing_months === 1 ? "Monthly subscription" : "Subscription billed every {n} months") : "One-off with milestones", { n: c.billing_months })}</span></td>
                    <td className="px-2">{t(COST_CENTER_LABELS[c.cost_center])}</td>
                    <td className="num px-2 text-right">{c.kind === "subscription" ? fmt(c.mrr_now || Math.round(c.recurring_minor / c.billing_months)) : "—"}</td>
                    <td className="num px-2 text-right">{c.setup_minor ? fmt(c.setup_minor) : "—"}</td>
                    <td className="num px-2 text-right">{c.one_off_minor ? fmt(c.one_off_minor) : "—"}</td>
                    <td className="px-2">{d(c.start_date)} → {c.end_date ? d(c.end_date) : t("open-ended")}</td>
                    <td className="pl-2"><Select aria-label={t("Status")} className="h-8 text-[13px]" value={c.status} onChange={(e) => upd.mutate({ id: c.id, expected_version: c.version, status: e.target.value })}>{["active", "paused", "ended"].map((s) => <option key={s} value={s}>{t(STATUS[s])}</option>)}</Select></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[12px] text-text-3">{t("Set-up fees never enter MRR; they are recognized on payment (policy to confirm with the accountant). 30/30 purchases are one-off sales, never MRR.")}</p>
      </Panel>
      <Panel>
        <PanelTitle>{t("Revenue schedule")}</PanelTitle>
        <p className="mb-3 text-[13px] text-text-2">{t("One-off contracts are recognized milestone by milestone, when the milestone is done (or marked earned here); their payments are cash only. Subscriptions are recognized over the service period of each payment.")}</p>
        {fin.schedule.length === 0 ? <p className="text-sm text-text-2">{t("Nothing here.")}</p> : (
          <ul className="flex flex-col divide-y divide-hairline">
            {fin.schedule.map((s) => (
              <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 text-[13px] sm:grid-cols-[1fr_7rem_8rem_16rem]">
                <span className="min-w-0 truncate">{t(s.label)}<span className="block text-[11px] text-text-3">{fin.contracts.find((c) => c.id === s.contract_id)?.name ?? ""}</span></span>
                <span className="text-text-2">{d(s.earned_on ?? s.period_start)}</span>
                <span className="num text-right">{fmt(s.amount_eur)}</span>
                <span className="flex items-center justify-end gap-2">
                  <span className={cn("text-[12px]", s.status === "earned" ? "text-win" : "text-text-3")}>{t(STATUS[s.status])}{s.derived_earned ? ` · ${t("milestone done")}` : ""}</span>
                  {s.status === "planned" ? <Button size="sm" variant="ghost" disabled={line.isPending} onClick={() => line.mutate({ id: s.id, expected_version: s.version, status: "earned" })}>{t("Mark earned")}</Button> : null}
                  {s.status === "earned" && !s.derived_earned ? <Button size="sm" variant="ghost" disabled={line.isPending} onClick={() => line.mutate({ id: s.id, expected_version: s.version, status: "planned" })}>{t("Back to planned")}</Button> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {adding ? <ContractForm fin={fin} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function ContractForm({ fin, onClose }: { fin: Fin; onClose: () => void }) {
  const t = useT();
  const inv = useInvalidate();
  const [id] = React.useState(newId);
  const [err, setErr] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ name: "", kind: "subscription" as "subscription" | "one_off", cost_center: "local" as CostCenter, amount: "", setup: "", billing_months: "1", start_date: fin.today, end_date: "" });
  const save = useMutation({
    mutationFn: () => {
      const amount = parseAmount(f.amount), setup = f.setup.trim() ? parseAmount(f.setup) : 0;
      if (!amount || setup === null) throw new Error(t("Invalid amount"));
      return api("/api/finance/contracts", { body: { id, name: f.name, client_id: "", project_id: "", cost_center: f.cost_center, kind: f.kind, currency: "EUR", setup_minor: f.kind === "subscription" ? setup : 0, one_off_minor: f.kind === "one_off" ? amount : 0, recurring_minor: f.kind === "subscription" ? amount : 0, billing_months: Number(f.billing_months), start_date: f.start_date, end_date: f.end_date || null, notes: "" } });
    },
    onSuccess: () => { toast(t("Saved")); inv(); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("New contract")} description={t("A signed contract only: quotes and accepted proposals are not revenue.")}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        <Field className="col-span-2" label={t("Client")} htmlFor="ct-name"><Input id="ct-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t("Type")} htmlFor="ct-kind"><Select id="ct-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}><option value="subscription">{t("Subscription")}</option><option value="one_off">{t("One-off with milestones")}</option></Select></Field>
        <Field label={t("Activity")} htmlFor="ct-cc"><Select id="ct-cc" value={f.cost_center} onChange={(e) => setF({ ...f, cost_center: e.target.value as CostCenter })}>{COST_CENTERS.filter((c) => c !== "shared").map((c) => <option key={c} value={c}>{t(COST_CENTER_LABELS[c])}</option>)}</Select></Field>
        <Field label={f.kind === "subscription" ? t("Amount per billing period, ex VAT") : t("Amount, ex VAT")} htmlFor="ct-amt"><Input id="ct-amt" inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" /></Field>
        {f.kind === "subscription" ? <Field label={t("Billed every (months)")} htmlFor="ct-bm"><Select id="ct-bm" value={f.billing_months} onChange={(e) => setF({ ...f, billing_months: e.target.value })}>{["1", "3", "6", "12"].map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field> : <span />}
        {f.kind === "subscription" ? <Field label={t("Set-up fee (never in MRR)")} htmlFor="ct-setup"><Input id="ct-setup" inputMode="decimal" value={f.setup} onChange={(e) => setF({ ...f, setup: e.target.value })} placeholder="0,00" /></Field> : null}
        <Field label={t("Start")} htmlFor="ct-start"><Input id="ct-start" type="date" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label={t("End (optional)")} htmlFor="ct-end"><Input id="ct-end" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        {err ? <p role="alert" className="col-span-2 text-[13px] text-bad">{err}</p> : null}
        <div className="col-span-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button><Button type="submit" variant="dark" disabled={save.isPending}>{t("Save")}</Button></div>
      </form>
    </Modal>
  );
}
