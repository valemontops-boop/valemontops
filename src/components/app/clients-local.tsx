"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, Skeleton, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { LOCAL_METRICS, LOCAL_METRIC_LABELS, type LimitLevel, type LocalMetric } from "@/domain/delivery";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn, formatEur } from "@/lib/utils";
import { BigNumber } from "./bits";
import { useSave } from "./clients-view";
import { CsvExportButton } from "./csv-tools";

type Margin = { priceMinor: number; costMinor: number; costBasis: "provisions" | "actual"; provisionedMinor: number; supportCostMinor: number; extraSupportMinutes: number; extraSupportCostMinor: number; marginMinor: number; marginPct: number | null; levels: Record<LocalMetric, LimitLevel> };
type Row = { client: { id: string; name: string; status: string; market: string | null }; usage: ({ id: string; version: number; source: string; note: string; actual_cost_minor: number | null } & Record<LocalMetric, number>) | null; values: Record<LocalMetric, number>; margin: Margin; history: { month: string; support_minutes: number; margin: number }[] };
type Local = {
  month: string; priceMinor: number; limits: Record<LocalMetric, number>; provisionsTotalMinor: number;
  provisions: { lines: { key: string; label: string; minor: number }[]; supportRateMinorPerHour: number; includedSupportMinutes: number };
  rows: Row[]; totals: { clients: number; entered: number; marginMinor: number; overSupport: number; alerts: number };
};
const SHOWN: LocalMetric[] = ["conversations", "qualified_requests", "automated_emails"];

/** Valemont Local: usage vs plan limits per client and month, contribution margin, support minutes as the main risk (spec 5.7). */
export function LocalSubscriptions() {
  const t = useT();
  const [month, setMonth] = React.useState("");
  const q = useQuery({ queryKey: ["clients", "local", month], queryFn: () => api<Local>(`/api/clients/local${month ? `?month=${month}` : ""}`) });
  const [edit, setEdit] = React.useState<Row | null>(null);
  const [csv, setCsv] = React.useState(false);
  const [plan, setPlan] = React.useState(false);
  if (q.isPending) return <Skeleton className="h-80" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("Month")} htmlFor="lc-month"><Input id="lc-month" type="month" className="w-44" value={month || d.month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <span className="flex-1" />
        <Button variant="outline" onClick={() => setCsv(true)}><Upload /> {t("Import CSV")}</Button>
        <CsvExportButton list="local_usage" />
        <Button variant="ghost" onClick={() => setPlan(true)}>{t("Plan limits and provisions")}</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigNumber label={t("Local clients")} value={d.totals.clients} note={t("{n} with usage entered", { n: d.totals.entered })} />
        <BigNumber dark label={t("Contribution margin")} value={formatEur(d.totals.marginMinor)} note={t("{p} / month per client − actual or provisioned costs", { p: formatEur(d.priceMinor) })} />
        <BigNumber label={t("Support over {n} min", { n: d.limits.support_minutes })} value={d.totals.overSupport} note={t("main margin risk")} />
        <BigNumber label={t("Limit alerts")} value={d.totals.alerts} note={t("at 80 % and 100 % of a limit")} />
      </div>
      {d.rows.length === 0 ? <EmptyState title={t("No Local client yet")}>{t("A won Local deal becomes a client from the CRM; its usage is entered here each month.")}</EmptyState> : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="text-[12px] text-text-3">
              <th className="pb-2 font-medium">{t("Client")}</th>
              {SHOWN.map((m) => <th key={m} className="pb-2 text-right font-medium">{t(LOCAL_METRIC_LABELS[m])}</th>)}
              <th className="pb-2 text-right font-medium">{t("Support minutes")}</th><th className="pb-2 text-right font-medium">{t("Cost")}</th><th className="pb-2 text-right font-medium">{t("Margin")}</th><th />
            </tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.client.id} className="border-t border-hairline align-top">
                <td className="py-2 pr-3"><span className="font-medium">{r.client.name}</span><span className="block text-[12px] text-text-3">{r.usage ? t(r.usage.source === "import" ? "imported" : "entered by hand") : t("not entered yet")}</span></td>
                {SHOWN.map((m) => <td key={m} className="py-2 text-right"><Usage used={r.values[m]} limit={d.limits[m]} level={r.margin.levels[m]} /></td>)}
                <td className={cn("py-2 text-right", r.margin.extraSupportMinutes > 0 && "rounded-[8px] bg-[#fbeceb]")}>
                  <Usage used={r.values.support_minutes} limit={d.limits.support_minutes} level={r.margin.levels.support_minutes} big />
                  {r.margin.extraSupportMinutes > 0 ? <span className="block text-[12px] font-semibold text-bad">{t("+{n} min = {x} off the margin", { n: r.margin.extraSupportMinutes, x: formatEur(r.margin.extraSupportCostMinor) })}</span> : null}
                </td>
                <td className="num py-2 text-right">{formatEur(r.margin.costMinor)}<span className="block text-[12px] text-text-3">{t(r.margin.costBasis === "actual" ? "actual" : "provisions")}</span></td>
                <td className={cn("num py-2 text-right font-semibold", r.margin.marginMinor < 0 && "text-bad")}>{formatEur(r.margin.marginMinor)}{r.margin.marginPct !== null ? <span className="block text-[12px] font-normal text-text-3">{r.margin.marginPct} %</span> : null}</td>
                <td className="py-2 pl-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>{r.usage ? t("Edit") : t("Enter")}</Button></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-3 text-[12px] text-text-3">{t("Provisions per client and month: {x} (labelled provisions, not actuals), support valued at {r} per hour for the minutes used (at least the included {n} min). An actual cost entered replaces the provisions.", { x: formatEur(d.provisionsTotalMinor), r: formatEur(d.provisions.supportRateMinorPerHour), n: d.limits.support_minutes })}</p>
        </Panel>
      )}
      {edit ? <UsageForm row={edit} month={d.month} onClose={() => setEdit(null)} /> : null}
      {csv ? <CsvImport onClose={() => setCsv(false)} /> : null}
      {plan ? <PlanForm d={d} onClose={() => setPlan(false)} /> : null}
    </div>
  );
}

function Usage({ used, limit, level, big }: { used: number; limit: number; level: LimitLevel; big?: boolean }) {
  const t = useT();
  return (
    <span className={cn("num inline-flex items-center gap-1", big && "text-base font-semibold", level === "over" ? "font-semibold text-bad" : level === "warn" ? "font-medium text-accent-text" : "")}>
      {level !== "ok" ? <AlertTriangle className="size-3.5" aria-label={t(level === "over" ? "limit reached" : "80 % of the limit")} /> : null}{used}<span className="text-[12px] font-normal text-text-3">/{limit}</span>
    </span>
  );
}

function UsageForm({ row, month, onClose }: { row: Row; month: string; onClose: () => void }) {
  const t = useT();
  const [v, setV] = React.useState<Record<string, string>>({ ...Object.fromEntries(LOCAL_METRICS.map((m) => [m, String(row.values[m])])), actual: row.usage?.actual_cost_minor != null ? String(row.usage.actual_cost_minor / 100) : "", note: row.usage?.note ?? "" });
  const m = useSave("/api/clients/local", "PUT", () => { toast(t("Saved")); onClose(); });
  const n = (s: string) => Math.max(0, Math.round(Number(s.replace(",", ".")) || 0));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("Usage · {name}", { name: row.client.name })} description={month}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate({ client_id: row.client.id, month, values: Object.fromEntries(LOCAL_METRICS.map((k) => [k, n(v[k])])), actual_cost_eur: v.actual.trim() ? Number(v.actual.replace(",", ".")) || 0 : null, note: v.note, expected_version: row.usage?.version ?? null }); }}>
        {LOCAL_METRICS.map((k) => <Field key={k} label={t(LOCAL_METRIC_LABELS[k])} htmlFor={`lu-${k}`}><Input id={`lu-${k}`} inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
        <Field label={t("Actual cost (€), optional")} htmlFor="lu-actual" hint={t("Empty = provisions")}><Input id="lu-actual" inputMode="decimal" value={v.actual} onChange={(e) => setV({ ...v, actual: e.target.value })} /></Field>
        <Field label={t("Note")} htmlFor="lu-note" className="col-span-2"><Input id="lu-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} maxLength={500} /></Field>
        <Button type="submit" variant="primary" className="col-span-2" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Modal>
  );
}

function CsvImport({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [csv, setCsv] = React.useState("");
  const m = useSave("/api/clients/local", "POST", (r) => { const x = r as { saved: number; errors: { line: number; reason: string }[] }; toast(t("{n} rows saved", { n: x.saved })); if (x.errors.length) toast(x.errors.slice(0, 3).map((e) => `${t("Line {n}", { n: e.line })}: ${t(e.reason)}`).join(" · ")); else onClose(); });
  const file = async (f: File | undefined) => { if (f && f.size < 500_000) setCsv(await f.text()); };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("Import Local usage")} description={t("Columns: client, month (YYYY-MM), conversations, qualified_requests, automated_emails, support_minutes, locations, actual_cost (optional). Clients are matched by name.")}>
      <div className="flex flex-col gap-3">
        <Input type="file" accept=".csv,text/csv" aria-label={t("CSV file")} onChange={(e) => file(e.target.files?.[0])} />
        <Textarea aria-label={t("CSV content")} className="num min-h-40 font-mono text-[12px]" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="client,month,conversations,qualified_requests,automated_emails,support_minutes" />
        <Button variant="primary" disabled={!csv.trim() || m.isPending} onClick={() => m.mutate({ csv })}>{m.isPending ? t("Importing…") : t("Import")}</Button>
      </div>
    </Modal>
  );
}

function PlanForm({ d, onClose }: { d: Local; onClose: () => void }) {
  const t = useT();
  const [limits, setLimits] = React.useState<Record<string, string>>(Object.fromEntries(LOCAL_METRICS.map((m) => [m, String(d.limits[m])])));
  const [lines, setLines] = React.useState(d.provisions.lines.map((l) => ({ ...l, eur: String(l.minor / 100) })));
  const [rate, setRate] = React.useState(String(d.provisions.supportRateMinorPerHour / 100));
  const m = useSave("/api/clients/local/plan", "POST", () => { toast(t("Saved")); onClose(); });
  const n = (s: string) => Number(s.replace(",", ".")) || 0;
  return (
    <Modal wide open onOpenChange={(o) => !o && onClose()} title={t("Plan limits and provisions")} description={t("Seeds from the price book (Local Essential). Provisions are estimates, not actual costs.")}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate({ limits: Object.fromEntries(LOCAL_METRICS.map((k) => [k, Math.max(0, Math.round(n(limits[k])))])), provisions: { lines: lines.map((l) => ({ key: l.key, label: l.label, minor: Math.round(n(l.eur) * 100) })), supportRateMinorPerHour: Math.round(n(rate) * 100) } }); }}>
        <PanelTitle>{t("Limits per month")}</PanelTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{LOCAL_METRICS.map((k) => <Field key={k} label={t(LOCAL_METRIC_LABELS[k])} htmlFor={`pl-${k}`}><Input id={`pl-${k}`} inputMode="numeric" value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} /></Field>)}</div>
        <PanelTitle>{t("Cost provisions per client per month (€)")}</PanelTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {lines.map((l, i) => <Field key={l.key} label={t(l.label)} htmlFor={`pv-${l.key}`}><Input id={`pv-${l.key}`} inputMode="decimal" value={l.eur} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, eur: e.target.value } : x)))} /></Field>)}
          <Field label={t("Support (€ per hour)")} htmlFor="pv-rate"><Input id="pv-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        </div>
        <Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Modal>
  );
}
