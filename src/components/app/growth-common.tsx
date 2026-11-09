"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Panel, PanelTitle } from "@/components/ui/form";
import type { Cost } from "@/domain/cac";
import { CATEGORY_LABELS, type BankCategory } from "@/domain/bank";
import type { marketingFunnels } from "@/server/services/marketing";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn, formatEur } from "@/lib/utils";

/**
 * Shared pieces of the Growth space (round 7): one period and one scope for every tab, and the same
 * layout everywhere: a strip of at most four numbers, then the channel funnel, then the details.
 * Sober style: values in ink, blue for volumes, green only for results (meetings, won, purchases).
 */
export type GrowthTab = "overview" | "messages" | "linkedin" | "instagram" | "website" | "content";
export type Days = "7" | "30" | "90";
export type Scope = "team" | "me";
export type GrowthFilter = { days: Days; scope: Scope };
export type FunnelData = Awaited<ReturnType<typeof marketingFunnels>>;

/** Every channel's funnel for the period and scope (same cache for every tab). */
export function useFunnels({ days, scope }: GrowthFilter) {
  return useQuery({ queryKey: ["funnels", days, scope], queryFn: () => api<FunnelData>(`/api/marketing/funnels?days=${days}&scope=${scope}`) });
}

export type Stat = { label: string; value: React.ReactNode; note?: React.ReactNode; result?: boolean };
/** At most five numbers in one quiet band (DESIGN ≤ 5); each says what it counts in its note. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const shown = stats.slice(0, 5);
  return (
    <Panel className="p-0 sm:p-0">
      <dl className={cn("grid grid-cols-2", shown.length >= 5 ? "md:grid-cols-5" : shown.length === 4 ? "md:grid-cols-4" : shown.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {shown.map((s, i) => (
          <div key={i} className={cn("flex min-w-0 flex-col gap-1 p-5", i > 0 && "md:border-l md:border-hairline", i % 2 === 1 && "border-l border-hairline", i >= 2 && "max-md:border-t max-md:border-hairline")}>
            <dt className="text-[13px] font-medium text-text-2">{s.label}</dt>
            <dd className={cn("num text-[32px] font-semibold leading-none tracking-tight", s.result && "text-win")}>{s.value}</dd>
            {s.note ? <dd className="text-[12px] text-text-3">{s.note}</dd> : null}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const RESULT_STEPS = new Set(["Meetings", "Won", "Purchases"]);
/**
 * One channel's funnel: a bar per step (blue = volume, green = result), the value, and the share kept
 * from the step before. `empty` says what to do when nothing has entered the funnel yet.
 */
export function StepFunnel({ title, steps, hours, empty, compact, action, footnote }: { title: string; steps: { label: string; value: number }[]; hours?: number | null; empty?: string; compact?: boolean; action?: React.ReactNode; footnote?: string }) {
  const t = useT();
  const tag = useDateTag();
  const max = Math.max(1, ...steps.map((s) => s.value));
  const isEmpty = !steps.some((s) => s.value > 0);
  return (
    <Panel>
      <PanelTitle action={action ?? (hours ? <span className="num text-[12px] text-text-3">{t("{h} h of work", { h: hours.toLocaleString(tag) })}</span> : null)}>{title}</PanelTitle>
      {isEmpty && empty ? <p className="text-sm text-text-2">{empty}</p> : (
        <>
          <ol className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2.5")}>
            {steps.map((s, i) => {
              const prev = steps[i - 1]?.value;
              const rate = i > 0 && prev ? Math.round((s.value / prev) * 100) : null;
              return (
                <li key={s.label} className="grid grid-cols-[minmax(110px,34%)_1fr_3.5rem_3rem] items-center gap-3 text-sm">
                  <span className="truncate text-text-2">{t(s.label)}</span>
                  <span className={cn("overflow-hidden rounded-full bg-subtle", compact ? "h-2" : "h-2.5")}><span className={cn("block h-full rounded-full", RESULT_STEPS.has(s.label) ? "bg-win" : "bg-sales")} style={{ width: `${(s.value / max) * 100}%`, minWidth: s.value ? 4 : 0 }} /></span>
                  <span className="num text-right font-semibold">{s.value.toLocaleString(tag)}</span>
                  <span className="num text-right text-[12px] text-text-3">{rate === null || rate > 100 ? "" : `${rate}%`}</span>
                </li>
              );
            })}
          </ol>
          {!compact ? <p className="mt-3 text-[12px] text-text-3">{footnote ?? t("The % is the share kept from the step before.")}</p> : null}
        </>
      )}
    </Panel>
  );
}

/** "12 %" or "—" when there is no denominator. */
export const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

/* ---------------- cost per channel (round 9, D072) ---------------- */

/** Two costs added together (e.g. email + WhatsApp). */
export function addCosts(a: Cost | undefined, b: Cost | undefined): Cost | undefined {
  if (!a || !b) return a ?? b;
  const totalMinor = a.totalMinor + b.totalMinor, meetings = a.meetings + b.meetings, won = a.won + b.won;
  return { minutes: a.minutes + b.minutes, timeMinor: a.timeMinor + b.timeMinor, moneyMinor: a.moneyMinor + b.moneyMinor, totalMinor, meetings, won, perMeetingMinor: meetings ? Math.round(totalMinor / meetings) : null, cacMinor: won ? Math.round(totalMinor / won) : null, lowSample: meetings < 2 || won < 2 };
}

/** "12,5 h" from minutes. */
export function useHours() {
  const tag = useDateTag();
  return (min: number) => (Math.round(min / 6) / 10).toLocaleString(tag);
}

/** The CAC number of a channel band: cost per client won, with the cost per meeting and the hours in its note. */
export function useCostStat() {
  const t = useT();
  const h = useHours();
  return (c: Cost | undefined, label = "CAC (cost per client)"): Stat => {
    if (!c) return { label: t(label), value: "…" };
    const parts = [
      c.cacMinor === null && c.perMeetingMinor === null ? t("no meeting or client yet") : c.cacMinor === null ? t("no client yet") : null,
      c.perMeetingMinor !== null ? t("{x} per meeting", { x: formatEur(c.perMeetingMinor) }) : null,
      t("{h} h of work", { h: h(c.minutes) }),
      c.totalMinor > 0 && (c.cacMinor !== null || c.perMeetingMinor !== null) && c.lowSample ? t("estimate, little data") : null,
    ].filter(Boolean);
    return { label: t(label), value: c.cacMinor === null ? "—" : formatEur(c.cacMinor), note: parts.join(" · ") };
  };
}

/** The cost of a channel in a table cell: cost per meeting / CAC, "—" with the reason when there is none. */
export function CostCell({ minor, low, empty }: { minor: number | null | undefined; low?: boolean; empty: string }) {
  const t = useT();
  if (minor === null || minor === undefined) return <span className="text-[12px] text-text-3">{empty}</span>;
  return <span className="num" title={low ? t("estimate, little data") : undefined}>{formatEur(minor)}{low ? <span className="text-text-3">*</span> : null}</span>;
}

/** Research behind the formula and the call benchmarks (D072); shown in "How it is calculated". */
export const CAC_SOURCES: [string, string][] = [
  ["Cut the SaaS — How to calculate CAC (blended, channel, fully loaded)", "https://cut-the-saas.com/guides/how-to-calculate-cac"],
  ["Logic Based Marketing — Your real customer acquisition cost", "https://logicbasedmarketing.com/blog/fully-loaded-blended-cac.html"],
  ["Development Corporate — CAC is higher than you think (founder time)", "https://developmentcorporate.com/product-management/understanding-cac-why-your-customer-acquisition-cost-is-higher-than-you-think/"],
  ["ChartMogul — CAC payback", "https://chartmogul.com/saas-metrics/cac-payback/"],
  ["Rework — LTV:CAC ratio benchmark (3:1)", "https://resources.rework.com/libraries/pipeline-management/ltv-cac-ratio"],
  ["Belkins — B2B cold calling benchmarks (175,000+ dials)", "https://belkins.io/blog/cold-calling-benchmarks"],
  ["Cognism — Cold calling report 2025", "https://www.cognism.com/fr/rapport-cold-calling-2025"],
  ["JustCall (Gong data) — Good connect rate", "https://justcall.io/blog/good-connect-rate-for-sales-teams.html"],
  ["Skipcall — Taux de décroché en prospection B2B", "https://skipcall.io/blog/taux-decroche-prospection-b2b"],
];

/**
 * "How it is calculated": the formula, what is included (founder time, every Money cost of the period, direct vs shared),
 * what is not, the sources, and the founder hour cost editable in place (also in Settings › Workspace).
 */
export function CostExplainer({ d }: { d: FunnelData }) {
  const t = useT();
  const h = useHours();
  const qc = useQueryClient();
  const [v, setV] = React.useState(String(d.costBasis?.hourCostEur ?? 30));
  const save = useMutation({ mutationFn: () => api("/api/settings/system", { body: { key: "founder_hour_cost_eur", value: v.trim() } }), onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); } });
  if (!d.costBasis || !d.money) return null;
  const m = d.money;
  return (
    <details className="group rounded-[12px] border border-hairline bg-panel px-4 py-3 text-[13px] text-text-2">
      <summary className="cursor-pointer select-none font-medium text-ink">{t("How it is calculated")}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p>{t("CAC = (hours of work × cost of a founder hour + money spent) ÷ clients won. Cost per meeting = the same cost ÷ meetings. “Fully loaded” adds every cost of the period, not only ads.")}</p>
        <ul className="list-disc pl-5">
          <li>{t("Time: calls, visits, LinkedIn, emails and WhatsApp = actions logged × minutes per action; social networks = content pieces × minutes per piece ({n} pieces) + done marketing tasks; web and AI engines = done tasks about the site ({h} h), shared by their visits.", { n: d.costBasis.contentPieces, h: h(d.costBasis.siteMinutes) })}</li>
          <li>{t("Money: every expense of the period in Money ({x}). A cost goes to its channel when it is clear (Sales Navigator → LinkedIn, phone plan → calls, ads → web or social, travel → visits); the rest ({y}, e.g. Google Workspace, hosting) is shared by each channel's share of time.", { x: formatEur(m.totalMinor), y: formatEur(m.sharedMinor) })}</li>
          <li>{t("Not counted: client revenue, founder contributions, transfers between our balances, other income and taxes ({x}).", { x: formatEur(m.excludedMinor) })}{m.adsBudgetMinor ? ` ${t("No ads movement: the monthly ads budget is used ({x}).", { x: formatEur(m.adsBudgetMinor) })}` : ""}</li>
          {m.byCategory.length ? <li>{m.byCategory.map((c) => `${t(CATEGORY_LABELS[c.category as BankCategory] ?? c.category)} ${formatEur(c.minor)}`).join(" · ")}</li> : <li>{t("No expense in Money for this period: only founder time is counted.")}</li>}
          <li>{t("Clients won: deals won (last touch) and 30/30 purchases from the website. * = estimate, little data (fewer than 2 meetings or 2 clients).")}</li>
        </ul>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (/^\d{1,6}$/.test(v.trim())) save.mutate(); }}>
          <label htmlFor="hour-cost" className="text-ink">{t("Cost of a founder hour (€)")}</label>
          <Input id="hour-cost" inputMode="numeric" className="num h-8 w-20" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} />
          <Button size="sm" variant="outline" type="submit" disabled={save.isPending || v === String(d.costBasis.hourCostEur)}>{t("Save")}</Button>
          <span className="text-text-3">{t("Also in Settings › Workspace, with the ads budget and the minutes per content piece.")}</span>
        </form>
        <div>
          <p className="mb-1 font-medium text-ink">{t("Sources")}</p>
          <ul className="flex flex-col gap-0.5">{CAC_SOURCES.map(([name, url]) => <li key={url}><a href={url} target="_blank" rel="noreferrer noopener" className="underline decoration-hairline underline-offset-2 hover:text-ink">{t(name)}</a></li>)}</ul>
        </div>
      </div>
    </details>
  );
}
