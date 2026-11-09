"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, Select, Skeleton } from "@/components/ui/form";
import { BRANDS, BRAND_LABELS } from "@/domain/constants";
import { api } from "@/lib/api";
import { cn, formatEur } from "@/lib/utils";
import type { marketingOverview } from "@/server/services/marketing";
import { Bars } from "./charts";
import { StatStrip, StepFunnel, useFunnels, type Days, type GrowthFilter } from "./growth-common";
import { useDateTag, useT } from "@/i18n/react";

type Overview = Awaited<ReturnType<typeof marketingOverview>>;
const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);

/** Website, social reach and countries for the period, all brands (shared by the Website, LinkedIn and Instagram tabs). */
export function useMarketingOverview(days: Days) {
  return useQuery({ queryKey: ["marketing-overview", days, "all"], queryFn: () => api<Overview>(`/api/marketing/overview?days=${days}&brand=all`) });
}

/** Growth › Website: traffic numbers → the website funnel → sources, countries → GA4 import. */
export function WebsiteTab({ filter }: { filter: GrowthFilter }) {
  const t = useT();
  const q = useMarketingOverview(filter.days);
  const f = useFunnels(filter);
  return (
    <div className="flex flex-col gap-5">
      {q.isPending ? <Skeleton className="h-[420px]" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <WebsiteBody d={q.data} steps={f.data?.inbound.steps ?? []} />
      )}
      <div className="pt-2"><h2 className="text-lg font-semibold tracking-tight">{t("Add website numbers")}</h2><p className="text-sm text-text-2">{t("Import a GA4 export once a week, or type the numbers of a day.")}</p></div>
      <TrafficTab />
    </div>
  );
}

function WebsiteBody({ d, steps }: { d: Overview; steps: { label: string; value: number }[] }) {
  const t = useT();
  const tag = useDateTag();
  const conv = d.totals.sessions ? (d.totals.leads + d.totals.purchases) / d.totals.sessions : null;
  const fits = d.fits.filter((f) => f.fit);
  return (
    <>
      <StatStrip stats={[
        { label: t("Website visits"), value: d.totals.sessions.toLocaleString(tag), note: d.hasTraffic ? t("sessions, all sites") : t("import GA4 below to see this") },
        { label: t("Leads"), value: d.totals.leads.toLocaleString(tag), note: t("forms and calls from the website") },
        { label: t("30/30 purchases"), value: d.totals.purchases.toLocaleString(tag), note: d.totals.revenue_minor ? formatEur(d.totals.revenue_minor) : t("revenue not imported"), result: true },
        { label: t("Visit → lead or sale"), value: pct(conv, 1), note: t("conversion of website sessions") },
      ]} />
      <StepFunnel title={t("Website funnel")} steps={steps} empty={t("No website traffic in this period: import a GA4 export below.")} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>{t("Where visits come from")}</PanelTitle>
          {d.sources.length ? <Bars tone="sales" data={d.sources.map((s) => ({ label: `${s.source}${s.medium ? ` / ${s.medium}` : ""}`, value: s.sessions, sub: t("{pct} convert · {n}", { pct: pct(s.conversion, 1), n: s.leads + s.purchases }) }))} /> : <p className="text-sm text-text-2">{t("No website traffic in this period: import a GA4 export below.")}</p>}
          {d.sources.length ? <p className="mt-3 text-[12px] text-text-3">{t("Sessions per source; under each, the share that became a lead or a sale.")}</p> : null}
        </Panel>
        <Panel>
          <PanelTitle>{t("Visits by country")}</PanelTitle>
          {d.countries.length ? <Bars data={d.countries.map((c) => ({ label: `${t(c.country)}${c.target ? "" : ` · ${t("outside target")}`}`, value: c.sessions, tone: c.target ? ("sales" as const) : ("muted" as const), sub: t("{n} conversions", { n: c.conversions }) }))} /> : <p className="text-sm text-text-2">{t("No website traffic in this period: import a GA4 export below.")}</p>}
          {d.countries.length ? <p className="mt-3 text-[12px] text-text-3">{t("Grey = outside the target markets.")}</p> : null}
        </Panel>
      </div>
      <Panel>
        <PanelTitle>{t("Are we reaching the right countries?")}</PanelTitle>
        {fits.length === 0 ? (
          <EmptyState title={t("No audience country data yet")}>{t("In the LinkedIn or Instagram tab, select an account and use “Enter country split”, or import the LinkedIn follower export.")}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-4">
            {fits.map((f) => (
              <li key={f.accountId}>
                <p className="mb-1 flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{f.account}</span><span><span className="num font-semibold">{pct(f.fit!.inTarget)}</span> <span className="text-text-2">{t("in {markets}", { markets: f.targets.join(" + ") })}</span></span></p>
                <div className="flex h-6 overflow-hidden rounded-[6px]" role="img" aria-label={t("{account} audience by country", { account: f.account })}>
                  {f.fit!.countries.map((c) => (
                    <div key={c.country} title={`${c.country} ${pct(c.share)}`} className={cn("flex items-center justify-center overflow-hidden border-r-2 border-panel text-[11px] font-medium", c.target ? "bg-sales text-panel" : "hatch-strong text-ink")} style={{ width: `${c.share * 100}%` }}>
                      {c.share >= 0.07 ? `${c.country} ${pct(c.share)}` : ""}
                    </div>
                  ))}
                </div>
              </li>
            ))}
            <li className="flex gap-4 text-[12px] text-text-3"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-sales" />{t("Target market")}</span><span className="flex items-center gap-1"><span className="hatch-strong size-2.5 rounded-sm" />{t("Outside target")}</span></li>
          </ul>
        )}
      </Panel>
    </>
  );
}

type TrafficPreview = { mapped: Record<string, string>; unrecognized: string[]; rows: number; newRows: number; sessions: number; committed: boolean };
export function TrafficTab() {
  const t = useT();
  const qc = useQueryClient();
  const [brand, setBrand] = React.useState<string>("thirty");
  const [end, setEnd] = React.useState(() => new Date().toLocaleDateString("en-CA"));
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const run = useMutation({
    mutationFn: (commit: boolean) => api<TrafficPreview>("/api/marketing/traffic", { body: { brand: brand || null, csv: file!.text, period_end: end, file_name: file!.name, commit } }),
    onSuccess: (r) => { if (r.committed) { for (const k of ["marketing-overview", "funnels"]) qc.invalidateQueries({ queryKey: [k] }); toast(t("Imported {n} row(s)", { n: r.newRows })); } },
  });
  const [v, setV] = React.useState({ date: new Date().toLocaleDateString("en-CA"), source: "instagram", medium: "social", country: "France", sessions: "", leads: "", purchases: "" });
  const manual = useMutation({
    mutationFn: () => api("/api/marketing/traffic", { method: "PUT", body: { date: v.date, brand: brand || null, source: v.source, medium: v.medium, country: v.country, sessions: Number(v.sessions) || 0, leads: Number(v.leads) || 0, purchases: Number(v.purchases) || 0 } }),
    onSuccess: () => { for (const k of ["marketing-overview", "funnels"]) qc.invalidateQueries({ queryKey: [k] }); toast(t("Saved")); },
  });
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel className="flex flex-col gap-3">
        <PanelTitle>{t("Import a GA4 export")}</PanelTitle>
        <p className="text-[13px] text-text-2">{t("GA4 › Reports › Acquisition › Traffic acquisition, add “Country” as secondary dimension, then Share › Download CSV. Columns are matched by name; re-importing adds nothing.")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Brand (site)")} htmlFor="tr-b"><Select id="tr-b" value={brand} onChange={(e) => setBrand(e.target.value)}>{BRANDS.map((b) => <option key={b} value={b}>{t(BRAND_LABELS[b])}</option>)}</Select></Field>
          <Field label={t("Period end (if no Date column)")} htmlFor="tr-e"><Input id="tr-e" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label={t("CSV file")} htmlFor="tr-f"><input id="tr-f" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile({ name: f.name, text: await f.text() }); run.reset(); } }} className="text-sm file:mr-3 file:h-9 file:rounded-full file:border file:border-control file:bg-panel file:px-4" /></Field>
        <Button variant="outline" className="self-start" disabled={!file || run.isPending} onClick={() => run.mutate(false)}>{t("Preview")}</Button>
        {run.isError ? <ErrorState error={run.error} onRetry={() => run.mutate(false)} /> : null}
        {run.data ? (
          <div className="flex flex-col gap-2 rounded-[12px] bg-subtle p-3 text-sm">
            <p className="num">{t("{n} rows", { n: run.data.rows })} · {t("{n} sessions", { n: run.data.sessions })} · {t("{n} new", { n: run.data.newRows })}</p>
            <p className="text-[13px] text-text-2">{t("Mapped:")} {Object.entries(run.data.mapped).map(([h, f]) => `${h} → ${f}`).join(", ")}</p>
            {run.data.unrecognized.length ? <p className="text-[13px] text-text-2">{t("Ignored:")} {run.data.unrecognized.join(", ")}</p> : null}
            {run.data.committed ? <p className="font-medium">{t("Imported.")}</p> : <Button variant="primary" className="self-start" disabled={!run.data.newRows} onClick={() => run.mutate(true)}>{t("Import {n} row(s)", { n: run.data.newRows })}</Button>}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <PanelTitle>{t("Or enter numbers")}</PanelTitle>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); manual.mutate(); }}>
          <Field label={t("Date")} htmlFor="tm-d"><Input id="tm-d" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label={t("Country")} htmlFor="tm-c"><Input id="tm-c" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} /></Field>
          <Field label={t("Source")} htmlFor="tm-s"><Input id="tm-s" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} /></Field>
          <Field label={t("Medium")} htmlFor="tm-m"><Input id="tm-m" value={v.medium} onChange={(e) => setV({ ...v, medium: e.target.value })} /></Field>
          {(["sessions", "leads", "purchases"] as const).map((k) => <Field key={k} label={t(k[0].toUpperCase() + k.slice(1))} htmlFor={`tm-${k}`}><Input id={`tm-${k}`} inputMode="numeric" className="num" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/\D/g, "") })} /></Field>)}
          {manual.isError ? <div className="col-span-2"><ErrorState error={manual.error} onRetry={() => manual.mutate()} /></div> : null}
          <Button type="submit" variant="primary" className="col-span-2 justify-self-start" disabled={manual.isPending || !v.sessions}>{t("Save")}</Button>
        </form>
      </Panel>
    </div>
  );
}

export function CountrySplitButton({ accountId }: { accountId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState([{ country: "France", percent: "" }, { country: "Spain", percent: "" }, { country: "Belgium", percent: "" }, { country: "", percent: "" }]);
  const m = useMutation({
    mutationFn: () => api("/api/marketing/breakdown", { body: { account_id: accountId, date: new Date().toLocaleDateString("en-CA"), entries: rows.filter((r) => r.country && r.percent).map((r) => ({ country: r.country, percent: Number(r.percent) })) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-overview"] }); toast(t("Saved")); setOpen(false); },
  });
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t("Enter country split")}</Button>;
  return (
    <form className="flex w-full flex-col gap-2 rounded-[12px] bg-subtle p-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-[13px] text-text-2">{t("From Instagram › Insights › Audience › Top locations (countries), in %.")}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={t("Country {n}", { n: i + 1 })} value={r.country} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, country: e.target.value } : x)))} placeholder={t("Country")} />
          <Input aria-label={t("Percent {n}", { n: i + 1 })} inputMode="decimal" className="num w-24" value={r.percent} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, percent: e.target.value.replace(/[^\d.]/g, "") } : x)))} placeholder="%" />
        </div>
      ))}
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      <div className="flex gap-2"><Button type="submit" size="sm" variant="primary" disabled={m.isPending}>{t("Save split")}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("Cancel")}</Button></div>
    </form>
  );
}
