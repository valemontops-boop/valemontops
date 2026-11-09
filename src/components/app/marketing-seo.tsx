"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Check, CircleDashed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { ISSUE_TEXT, type IssueCode } from "@/domain/seo";
import type { seoOverview } from "@/server/services/seo";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDay } from "./bits";
import { StatStrip, type Days } from "./growth-common";

type Seo = Awaited<ReturnType<typeof seoOverview>>;
type Lang = "all" | "FR" | "ES";
const DOT = { act: "bg-bad", watch: "bg-control", good: "bg-win" } as const;

/** Growth › Web › SEO (round 9, D072): Search Console numbers → optimisation points → top queries and pages → site audit → AI engines → add data. */
export function SeoView({ days }: { days: Days }) {
  const t = useT();
  const [lang, setLang] = React.useState<Lang>("all");
  const q = useQuery({ queryKey: ["seo", lang, days], queryFn: () => api<Seo>(`/api/marketing/seo?language=${lang}&days=${days}`) });
  return (
    <div className="flex flex-col gap-5">
      <div><SegmentedSwitch size="sm" label={t("Language")} value={lang} onChange={setLang} options={[{ value: "all", label: t("FR + ES") }, { value: "FR", label: t("France") }, { value: "ES", label: t("Spain") }]} /></div>
      {q.isPending ? <Skeleton className="h-[420px]" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <SeoBody d={q.data} />}
      <div className="pt-2"><h2 className="text-lg font-semibold tracking-tight">{t("Add Search Console numbers")}</h2><p className="text-sm text-text-2">{t("Import the Performance export once a month (one file per table and per language), or type a query or a page.")}</p></div>
      <GscImport />
    </div>
  );
}

function SeoBody({ d }: { d: Seo }) {
  const t = useT();
  const tag = useDateTag();
  const [allPoints, setAllPoints] = React.useState(false);
  const fv = (v: Record<string, string | number>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" ? x.toLocaleString(tag) : x]));
  const s = d.summary;
  const period = d.periods.map((p) => `${p.language} ${fmtDay(p.from)} → ${fmtDay(p.to)}`).join(" · ");
  return (
    <>
      {d.hasData ? (
        <StatStrip stats={[
          { label: t("Clicks"), value: s.clicks.toLocaleString(tag), note: period || t("no data for this language") },
          { label: t("Impressions"), value: s.impressions.toLocaleString(tag), note: s.basis === "queries" ? t("sum of the queries table (anonymised queries left out)") : t("sum of the pages table") },
          { label: t("CTR"), value: s.ctr === null ? "—" : `${(Math.round(s.ctr * 1000) / 10).toLocaleString(tag)} %`, note: t("clicks ÷ impressions") },
          { label: t("Average position"), value: s.position === null ? "—" : s.position.toLocaleString(tag), note: t("weighted by impressions; 1 = top of Google") },
        ]} />
      ) : (
        <EmptyState title={t("No Search Console data yet")}>{t("Search Console › Performance › Search results, choose the period (e.g. 3 months), Export › Download CSV. Import Queries.csv and Pages.csv below, for the French and the Spanish property.")}</EmptyState>
      )}
      {d.points.length ? (
        <Panel>
          <PanelTitle>{t("Points to optimise")}</PanelTitle>
          <ul className="flex flex-col gap-3">
            {(allPoints ? d.points : d.points.slice(0, 5)).map((p, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-snug">
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[p.severity])} aria-hidden />
                <div><p className="font-medium">{t(p.key, fv(p.vars))}</p><p className="mt-0.5 text-text-2">→ {t(p.action, fv(p.vars))}</p></div>
              </li>
            ))}
          </ul>
          {d.points.length > 5 ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAllPoints(!allPoints)}>{allPoints ? t("Show less") : t("See all")}</Button> : null}
          <p className="mt-3 text-[12px] text-text-3">{t("Rules: quick win = position 4 to 20 with 50+ impressions; low CTR = under half the usual CTR for that position (100+ impressions); brand words are set in Settings › Workspace.")}</p>
        </Panel>
      ) : null}
      {d.hasData ? (
        <div className="grid grid-cols-1 gap-5">
          <TopTable title={t("Top queries")} rows={s.topQueries} />
          <TopTable title={t("Top pages")} rows={s.topPages} page />
        </div>
      ) : null}
      <AuditPanel d={d} />
      <Panel>
        <PanelTitle>{t("Visible in AI engines")}</PanelTitle>
        <ul className="flex flex-col divide-y divide-hairline">
          {d.ai.checklist.map((c) => (
            <li key={c.key} className="flex items-start gap-2.5 py-2 text-sm">
              {c.status === "ok" ? <Check className="mt-0.5 size-4 shrink-0 text-win" aria-label={t("done")} /> : c.status === "todo" ? <X className="mt-0.5 size-4 shrink-0 text-bad" aria-label={t("to do")} /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-text-3" aria-label={t("to check")} />}
              <div><p className="font-medium">{t(c.key)}</p><p className="text-[13px] text-text-2">{t(c.hint, { n: "n" in c ? (c.n as number) : 0 })}</p></div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-text-3">{t("Checked by the last audit; AI-engine visits come from the GA4 import (Visits view).")}</p>
      </Panel>
    </>
  );
}

function TopTable({ title, rows, page }: { title: string; rows: Seo["summary"]["topQueries"]; page?: boolean }) {
  const t = useT();
  const tag = useDateTag();
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  const path = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
  return (
    <Panel>
      <PanelTitle action={rows.length > 5 ? <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? t("Show less") : t("See all")}</Button> : null}>{title}</PanelTitle>
      {rows.length === 0 ? <p className="text-sm text-text-2">{page ? t("Import Pages.csv to see the pages.") : t("Import Queries.csv to see the queries.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{page ? t("Page") : t("Query")}</th><th className="text-right font-medium">{t("Clicks")}</th><th className="text-right font-medium">{t("Impr.")}</th><th className="text-right font-medium">{t("CTR")}</th><th className="text-right font-medium">{t("Pos.")}</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.language}:${r.key}`} className="border-t border-hairline">
                  <td className="max-w-[220px] truncate py-1.5" title={r.key}>{page ? path(r.key) : r.key} <span className="text-[11px] text-text-3">{r.language}</span></td>
                  <td className="num text-right">{r.clicks.toLocaleString(tag)}</td>
                  <td className="num text-right">{r.impressions.toLocaleString(tag)}</td>
                  <td className="num text-right">{r.ctr === null ? "—" : `${(Math.round(r.ctr * 1000) / 10).toLocaleString(tag)} %`}</td>
                  <td className="num text-right">{r.position.toLocaleString(tag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AuditPanel({ d }: { d: Seo }) {
  const t = useT();
  const qc = useQueryClient();
  const [all, setAll] = React.useState(false);
  const run = useMutation({ mutationFn: () => api("/api/marketing/seo/audit", { body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["seo"] }); toast(t("Audit done")); } });
  const a = d.audit;
  const issues = a ? [...a.issues].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "act" ? -1 : 1)) : [];
  const shown = all ? issues : issues.slice(0, 5);
  const tag = useDateTag();
  const fv = (v: Record<string, string | number>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" ? x.toLocaleString(tag) : x]));
  return (
    <Panel>
      <PanelTitle action={<Button size="sm" variant="outline" disabled={run.isPending || !d.sites.length} onClick={() => run.mutate()}>{run.isPending ? t("Auditing…") : t("Run the audit")}</Button>}>{t("Site audit")}</PanelTitle>
      {!d.sites.length ? <p className="text-sm text-text-2">{t("Add the French and Spanish website addresses (https) in Settings › Workspace to audit them.")}</p> : null}
      {run.isError ? <ErrorState error={run.error} onRetry={() => run.mutate()} /> : null}
      {a ? (
        <>
          <p className="mb-3 text-[13px] text-text-2">{t("Last audit {date}: {n} page(s), {i} point(s) to fix.", { date: fmtDay(a.run_at.slice(0, 10)), n: a.pages_checked, i: issues.length })}</p>
          {issues.length === 0 ? <p className="text-sm">{t("Nothing to fix on the pages checked.")}</p> : (
            <ul className="flex flex-col divide-y divide-hairline">
              {shown.map((i, k) => {
                const [what, fix] = ISSUE_TEXT[i.code as IssueCode] ?? [i.code, ""];
                return (
                  <li key={k} className="flex gap-2.5 py-2 text-sm leading-snug">
                    <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[i.severity])} aria-hidden />
                    <div className="min-w-0"><p><span className="font-mono text-[12px] text-text-2">{i.page}</span> · <span className="font-medium">{t(what, fv(i.vars))}</span></p>{fix ? <p className="text-text-2">→ {t(fix)}</p> : null}</div>
                  </li>
                );
              })}
            </ul>
          )}
          {issues.length > 5 ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll(!all)}>{all ? t("Show less") : t("See all")}</Button> : null}
        </>
      ) : d.sites.length ? <p className="text-sm text-text-2">{t("No audit yet. It reads robots.txt, sitemap.xml, llms.txt and up to 20 pages of the site (10 s per page).")}</p> : null}
      <p className="mt-3 text-[12px] text-text-3">{t("Checks: title (30–60 characters), meta description (70–160), one H1, canonical, hreflang FR/ES pairs, Open Graph, structured data (Organization/LocalBusiness, FAQ), robots.txt, sitemap.xml, llms.txt, images without alt, noindex, HTML weight.")}</p>
    </Panel>
  );
}

type ImportPreview = { dimension: "query" | "page" | null; rows: number; newRows: number; clicks: number; impressions: number; committed: boolean };
function GscImport() {
  const t = useT();
  const qc = useQueryClient();
  const [meta, setMeta] = React.useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 90);
    return { language: "FR" as "FR" | "ES", period_start: start.toLocaleDateString("en-CA"), period_end: end.toLocaleDateString("en-CA") };
  });
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["seo"] });
  const run = useMutation({
    mutationFn: (commit: boolean) => api<ImportPreview>("/api/marketing/seo", { body: { ...meta, csv: file!.text, file_name: file!.name, commit } }),
    onSuccess: (r) => { if (r.committed) { done(); toast(t("Imported {n} row(s)", { n: r.newRows })); } },
  });
  const [v, setV] = React.useState({ dimension: "query" as "query" | "page", key: "", clicks: "", impressions: "", position: "" });
  const manual = useMutation({
    mutationFn: () => api("/api/marketing/seo", { method: "PUT", body: { ...meta, dimension: v.dimension, key: v.key, clicks: Number(v.clicks) || 0, impressions: Number(v.impressions) || 0, position: Number(v.position.replace(",", ".")) || 0 } }),
    onSuccess: () => { done(); toast(t("Saved")); setV({ ...v, key: "", clicks: "", impressions: "", position: "" }); },
  });
  return (
    <div className="grid grid-cols-1 gap-5">
      <Panel className="flex flex-col gap-3">
        <PanelTitle>{t("Import a Search Console export")}</PanelTitle>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("Site")} htmlFor="gsc-l"><Select id="gsc-l" value={meta.language} onChange={(e) => setMeta({ ...meta, language: e.target.value as "FR" | "ES" })}><option value="FR">{t("France")}</option><option value="ES">{t("Spain")}</option></Select></Field>
          <Field label={t("From")} htmlFor="gsc-s"><Input id="gsc-s" type="date" value={meta.period_start} onChange={(e) => setMeta({ ...meta, period_start: e.target.value })} /></Field>
          <Field label={t("To")} htmlFor="gsc-e"><Input id="gsc-e" type="date" value={meta.period_end} onChange={(e) => setMeta({ ...meta, period_end: e.target.value })} /></Field>
        </div>
        <Field label={t("Queries.csv or Pages.csv")} htmlFor="gsc-f"><input id="gsc-f" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setFile({ name: f.name, text: await f.text() }); run.reset(); } }} className="text-sm file:mr-3 file:h-9 file:rounded-full file:border file:border-control file:bg-panel file:px-4" /></Field>
        <Button variant="outline" className="self-start" disabled={!file || run.isPending} onClick={() => run.mutate(false)}>{t("Preview")}</Button>
        {run.isError ? <ErrorState error={run.error} onRetry={() => run.mutate(false)} /> : null}
        {run.data ? (
          <div className="flex flex-col gap-2 rounded-[12px] bg-subtle p-3 text-sm">
            <p className="num">{run.data.dimension === "page" ? t("{n} pages", { n: run.data.rows }) : t("{n} queries", { n: run.data.rows })} · {t("{n} clicks", { n: run.data.clicks })} · {t("{n} new", { n: run.data.newRows })}</p>
            {run.data.committed ? <p className="font-medium">{t("Imported.")}</p> : <Button variant="primary" className="self-start" disabled={!run.data.newRows} onClick={() => run.mutate(true)}>{t("Import {n} row(s)", { n: run.data.newRows })}</Button>}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <PanelTitle>{t("Or enter a query or a page")}</PanelTitle>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); manual.mutate(); }}>
          <Field label={t("Type")} htmlFor="gm-d"><Select id="gm-d" value={v.dimension} onChange={(e) => setV({ ...v, dimension: e.target.value as "query" | "page" })}><option value="query">{t("Query")}</option><option value="page">{t("Page")}</option></Select></Field>
          <Field label={v.dimension === "page" ? t("Page address") : t("Query")} htmlFor="gm-k"><Input id="gm-k" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} /></Field>
          {(["clicks", "impressions", "position"] as const).map((k) => <Field key={k} label={t(k === "clicks" ? "Clicks" : k === "impressions" ? "Impressions" : "Average position")} htmlFor={`gm-${k}`}><Input id={`gm-${k}`} inputMode="decimal" className="num" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(k === "position" ? /[^\d.,]/g : /\D/g, "") })} /></Field>)}
          {manual.isError ? <div className="col-span-2"><ErrorState error={manual.error} onRetry={() => manual.mutate()} /></div> : null}
          <p className="col-span-2 text-[12px] text-text-3">{t("Saved for the site and the period chosen on the left.")}</p>
          <Button type="submit" variant="primary" className="col-span-2 justify-self-start" disabled={manual.isPending || !v.key.trim() || !v.impressions}>{t("Save")}</Button>
        </form>
      </Panel>
    </div>
  );
}
