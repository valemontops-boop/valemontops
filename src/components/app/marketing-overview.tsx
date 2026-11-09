"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { BRANDS, BRAND_LABELS } from "@/domain/constants";
import { api } from "@/lib/api";
import { cn, formatEur } from "@/lib/utils";
import type { marketingOverview } from "@/server/services/marketing";
import { Bars, Funnel, Kpi } from "./charts";
import { useDateTag, useT } from "@/i18n/react";

type Overview = Awaited<ReturnType<typeof marketingOverview>>;
const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);

export function MarketingOverview() {
  const t = useT();
  const [days, setDays] = React.useState<"7" | "30" | "90">("30");
  const [brand, setBrand] = React.useState<"all" | "local" | "consulting" | "thirty">("all");
  const q = useQuery({ queryKey: ["marketing-overview", days, brand], queryFn: () => api<Overview>(`/api/marketing/overview?days=${days}&brand=${brand}`) });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <SegmentedSwitch size="sm" label={t("Period")} value={days} onChange={setDays} options={[{ value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }, { value: "90", label: t("90 days") }]} />
        <SegmentedSwitch size="sm" label={t("Brand")} value={brand} onChange={setBrand} options={[{ value: "all", label: t("All") }, ...BRANDS.map((b) => ({ value: b, label: t(BRAND_LABELS[b]).replace("Valemont ", "") }))]} />
      </div>
      {q.isPending ? <Skeleton className="h-[520px]" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Body d={q.data} />}
    </div>
  );
}

function Body({ d }: { d: Overview }) {
  const t = useT();
  const tag = useDateTag();
  const conv = d.totals.sessions ? (d.totals.leads + d.totals.purchases) / d.totals.sessions : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="mkt" label={t("Website sessions")} value={d.totals.sessions.toLocaleString(tag)} note={d.hasTraffic ? `${d.from} → ${d.to}` : t("import GA4 to see this")} />
        <Kpi tone="mkt" label={t("Leads")} value={String(d.totals.leads)} note={t("from tracked sources")} />
        <Kpi tone="win" label={t("30/30 purchases")} value={String(d.totals.purchases)} note={d.totals.revenue_minor ? formatEur(d.totals.revenue_minor) : t("revenue not imported")} />
        <Kpi label={t("Visit → lead or sale")} value={pct(conv, 1)} dark note={t("conversion of website sessions")} />
      </div>

      <Panel>
        <PanelTitle>{t("What to do next")}</PanelTitle>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {d.insights.map((i, k) => (
            <li key={k} className={cn("flex flex-col gap-1 rounded-[12px] border p-3", i.severity === "act" ? "border-ink" : "border-hairline")}>
              <span className={cn("self-start rounded-full px-2 py-0.5 text-[11px] font-semibold", i.severity === "act" ? "bg-mkt text-panel" : i.severity === "good" ? "bg-win-soft text-win" : "bg-subtle text-text-2")}>{i.severity === "act" ? t("Act") : i.severity === "good" ? t("Working") : t("Watch")}</span>
              <p className="font-semibold leading-snug">{t(i.title)}</p>
              <p className="text-[13px] text-text-2">{t(i.evidence)}</p>
              <p className="text-[13px]">{t(i.action)}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {d.funnels.map((f) => (
          <Panel key={f.brand}>
            <PanelTitle><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: `var(--brand-${f.brand})` }} />{t("{brand} funnel", { brand: t(f.label) })}</span></PanelTitle>
            {f.hasData ? <Funnel steps={f.steps.map((x: { label: string; value: number }, i: number) => ({ ...x, label: t(x.label), tone: i === 0 ? ("mkt" as const) : i === f.steps.length - 1 ? ("win" as const) : ("mkt" as const) }))} /> : <p className="text-sm text-text-2">{t("No data for this brand yet.")}</p>}
            <p className="mt-2 text-[12px] text-text-3">{t("Instagram views and LinkedIn impressions are shown separately; the % compares each step with the first one.")}</p>
          </Panel>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>{t("Where visits come from")}</PanelTitle>
          {d.sources.length ? <Bars tone="mkt" data={d.sources.map((s) => ({ label: `${s.source}${s.medium ? ` / ${s.medium}` : ""}`, value: s.sessions, sub: t("{pct} convert · {n}", { pct: pct(s.conversion, 1), n: s.leads + s.purchases }) }))} /> : <p className="text-sm text-text-2">{t("No traffic imported yet (Traffic tab).")}</p>}
        </Panel>
        <Panel>
          <PanelTitle>{t("Visits by country")}</PanelTitle>
          {d.countries.length ? <Bars data={d.countries.map((c) => ({ label: `${t(c.country)}${c.target ? "" : ` · ${t("outside target")}`}`, value: c.sessions, tone: c.target ? ("mkt" as const) : ("muted" as const), sub: t("{n} conversions", { n: c.conversions }) }))} /> : <p className="text-sm text-text-2">{t("No traffic imported yet.")}</p>}
        </Panel>
      </div>

      <Panel>
        <PanelTitle>{t("Are we reaching the right countries?")}</PanelTitle>
        {d.fits.every((f) => !f.fit) ? <p className="text-sm text-text-2">{t("No audience country data yet. Enter the country split from Instagram Insights, or import the LinkedIn follower export (Location sheet), in the Audience tab.")}</p> : (
          <ul className="flex flex-col gap-4">
            {d.fits.filter((f) => f.fit).map((f) => (
              <li key={f.accountId}>
                <p className="mb-1 flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{f.account}</span><span><span className="num font-semibold">{pct(f.fit!.inTarget)}</span> <span className="text-text-2">{t("in {markets}", { markets: f.targets.join(" + ") })}</span></span></p>
                <div className="flex h-7 overflow-hidden rounded-[6px]" role="img" aria-label={t("{account} audience by country", { account: f.account })}>
                  {f.fit!.countries.map((c) => (
                    <div key={c.country} title={`${c.country} ${pct(c.share)}`} className={cn("flex items-center justify-center overflow-hidden border-r-2 border-panel text-[11px] font-medium", c.target ? "bg-mkt text-panel" : "hatch-strong text-ink")} style={{ width: `${c.share * 100}%` }}>
                      {c.share >= 0.07 ? `${c.country} ${pct(c.share)}` : ""}
                    </div>
                  ))}
                </div>
              </li>
            ))}
            <li className="flex gap-4 text-[12px] text-text-3"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-mkt" />{t("Target market")}</span><span className="flex items-center gap-1"><span className="hatch-strong size-2.5 rounded-sm" />{t("Outside target")}</span></li>
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
    onSuccess: (r) => { if (r.committed) { qc.invalidateQueries({ queryKey: ["marketing-overview"] }); toast(t("Imported {n} row(s)", { n: r.newRows })); } },
  });
  const [v, setV] = React.useState({ date: new Date().toLocaleDateString("en-CA"), source: "instagram", medium: "social", country: "France", sessions: "", leads: "", purchases: "" });
  const manual = useMutation({
    mutationFn: () => api("/api/marketing/traffic", { method: "PUT", body: { date: v.date, brand: brand || null, source: v.source, medium: v.medium, country: v.country, sessions: Number(v.sessions) || 0, leads: Number(v.leads) || 0, purchases: Number(v.purchases) || 0 } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-overview"] }); toast(t("Saved")); },
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
