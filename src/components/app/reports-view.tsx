"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Skeleton, Textarea } from "@/components/ui/form";
import { FOUNDERS, FOUNDER_NAMES, METRIC_LABELS } from "@/domain/constants";
import { addDays } from "@/domain/time";
import { api } from "@/lib/api";
import type { weeklyReview } from "@/server/services/insights";
import type { streakSummary } from "@/server/services/results";
import { DayDots } from "./bits";
import { Bars, Funnel, Kpi } from "./charts";
import { ObjectionRows } from "./call-mode";
import { VerdictPanel } from "./verdicts";
import { salesVerdicts } from "@/domain/verdicts";
import { OBJECTION_LABELS } from "@/domain/constants";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { reportsDashboard as dashboard } from "@/server/services/dashboard";
import { useT } from "@/i18n/react";
import { useMe } from "./providers";
import { CONVERSION_STEPS, CONVERSION_STEP_LABELS, TIME_AREA_LABELS } from "@/domain/conversion";
import { CHANNEL_LABELS } from "@/domain/funnels";
import { cn, formatEur } from "@/lib/utils";
import { ExportButton } from "./export-dialog";

type Weekly = Awaited<ReturnType<typeof weeklyReview>>;
type Streaks = Awaited<ReturnType<typeof streakSummary>>;
type Tab = "dashboard" | "weekly";
type Dash = Awaited<ReturnType<typeof dashboard>>;

export function ReportsView() {
  const t = useT();
  const [tab, setTab] = React.useState<Tab>("dashboard");
  const [week, setWeek] = React.useState<string | undefined>(undefined);
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Reports")}</h1>
        <ExportButton />
        <SegmentedSwitch label={t("Report")} value={tab} onChange={setTab} options={[{ value: "dashboard", label: t("Dashboard") }, { value: "weekly", label: t("Weekly review") }]} />
      </div>
      {tab === "dashboard" ? <Dashboard /> : <WeeklyReview week={week} setWeek={setWeek} />}
    </div>
  );
}

const pctTxt = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function Dashboard() {
  const t = useT();
  const [days, setDays] = React.useState<"7" | "30" | "90">("30");
  const [scope, setScope] = React.useState<"team" | "me">("team");
  const q = useQuery({ queryKey: ["dashboard", days, scope], queryFn: () => api<Dash>(`/api/reports/dashboard?days=${days}&scope=${scope}`) });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedSwitch size="sm" label={t("Period")} value={days} onChange={setDays} options={[{ value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }, { value: "90", label: t("90 days") }]} />
        <SegmentedSwitch size="sm" label={t("Scope")} value={scope} onChange={setScope} options={[{ value: "team", label: t("Team") }, { value: "me", label: t("Me") }]} />
        {q.data ? <span className="text-[13px] text-text-3">{q.data.from} → {q.data.to} · {t("changes vs the previous {n} days", { n: days })}</span> : null}
        <Button asChild size="sm" variant="ghost" className="ml-auto"><a href="/api/reports/scorecard?format=csv">{t("Export week (CSV)")}</a></Button>
      </div>
      {q.isPending ? <Skeleton className="h-[480px]" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <DashboardBody d={q.data} />}
      <Consistency />
    </>
  );
}

function DashboardBody({ d }: { d: Dash }) {
  const t = useT();
  const k = d.kpis;
  const best = d.byHour.filter((h) => h.dials >= 3).sort((a, b) => (b.pickupRate ?? 0) - (a.pickupRate ?? 0))[0];
  const verdicts = salesVerdicts(d as never, (k) => t(OBJECTION_LABELS[k as keyof typeof OBJECTION_LABELS] ?? k));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi tone="sales" label={t("Dials")} spark={d.daily.map((x) => x.dials)} value={String(k.dials.value ?? 0)} delta={k.dials.delta} note={t("{n} new businesses", { n: k.newBusinesses.value ?? 0 })} />
        <Kpi tone="sales" label={t("Pick-up rate")} value={pctTxt(k.pickupRate.value)} delta={k.pickupRate.delta} note={t("picked up / dials")} />
        <Kpi tone="win" spark={d.daily.map((x) => x.yes)} label={t("Yes rate")} value={pctTxt(k.yesRate.value)} delta={k.yesRate.delta} note={t("{n} yes / picked up", { n: k.yes.value ?? 0 })} />
        <Kpi label={t("Meetings booked")} value={String(k.meetings.value ?? 0)} delta={k.meetings.delta} dark />
        <Kpi tone="win" label={t("Deals won")} value={String(k.won.value ?? 0)} delta={k.won.delta} note={t("{n} content published", { n: k.content.value ?? 0 })} />
      </div>
      <VerdictPanel verdicts={verdicts} />
      <Panel>
        <PanelTitle>{t("Dials and yes per day")}</PanelTitle>
        <div className="h-56" role="img" aria-label={t("Dials and yes per day")}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.daily} margin={{ top: 4, right: 8, bottom: 0, left: -12 }} barGap={-14}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(x: string) => x.slice(8)} stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
              <YAxis stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: "var(--subtle)" }} contentStyle={{ borderRadius: 12, border: "none", background: "var(--ink)", color: "var(--panel)", fontSize: 12 }} labelFormatter={(x) => String(x)} />
              <Bar dataKey="dials" name={t("Dials")} fill="var(--sales)" radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
              <Bar dataKey="yes" name={t("Yes")} fill="var(--win)" radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 flex gap-4 text-[12px] text-text-3"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-sales" />{t("Dials")} <b className="num font-medium text-text-2">{d.daily.reduce((a, x) => a + x.dials, 0)}</b></span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-win" />{t("Yes")} <b className="num font-medium text-text-2">{d.daily.reduce((a, x) => a + x.yes, 0)}</b></span></p>
      </Panel>
      <ConversionPanel rows={d.conversion} split={d.timeSplit} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel><PanelTitle>{t("Funnel")}</PanelTitle><Funnel steps={d.funnel.map((f, i) => ({ ...f, label: t(f.label), tone: i < 2 ? ("sales" as const) : ("win" as const) }))} /></Panel>
        <Panel><PanelTitle>{t("Objections heard")}</PanelTitle>{d.objections.length ? <><ObjectionRows rows={d.objections} /><p className="mt-2 text-[12px] text-text-3">{t("Green = the call still ended in a yes. Heard on any call, not only refusals. Practise the weak ones in Call mode › Objection drill.")}</p></> : <p className="text-sm text-text-2">{t("No objection recorded in this period.")}</p>}</Panel>
        <Panel>
          <PanelTitle>{t("Best hours to call")}</PanelTitle>
          {d.byHour.length ? <Bars tone="sales" data={d.byHour.map((h) => ({ label: `${h.hour}:00`, value: Math.round((h.pickupRate ?? 0) * 100), sub: t("{picked}/{dials} picked up", { picked: h.pickedUp, dials: h.dials }) }))} max={100} /> : <p className="text-sm text-text-2">No calls yet.</p>}
          {best ? <p className="mt-3 text-[13px] text-text-2">{t("Most pick-ups around")} <span className="font-semibold text-ink">{best.hour}:00</span> ({pctTxt(best.pickupRate)}). {t("Bars show the pick-up rate in %.")}</p> : null}
        </Panel>
        <Panel><PanelTitle>{t("Outreach by channel")}</PanelTitle><Bars tone="sales" data={d.channels.filter((c) => c.count > 0).map((c) => ({ label: t(METRIC_LABELS[c.metric]), value: c.count }))} /></Panel>
        <Panel>
          <PanelTitle>{t("By country")}</PanelTitle>
          {d.byMarket.length ? <Bars data={d.byMarket.map((m) => ({ label: m.key, value: m.dials, tone: m.key === "ES" ? ("muted" as const) : ("ink" as const), sub: t("{pickup} pick-up · {yes} yes", { pickup: pctTxt(m.picked && m.dials ? m.picked / m.dials : null), yes: pctTxt(m.yesRate) }) }))} /> : <p className="text-sm text-text-2">{t("No calls yet.")}</p>}
        </Panel>
        <Panel>
          <PanelTitle>{t("By trade")}</PanelTitle>
          {d.byNiche.length ? <Bars tone="sales" data={d.byNiche.map((m) => ({ label: t(m.key), value: m.dials, sub: t("{pct} yes when reached", { pct: pctTxt(m.yesRate) }) }))} /> : <p className="text-sm text-text-2">{t("No calls yet.")}</p>}
        </Panel>
      </div>
    </>
  );
}

/** Iteration 8: conversion by channel (one compact table) and the time split against its target. */
function ConversionPanel({ rows, split }: { rows: Dash["conversion"]; split: Dash["timeSplit"] }) {
  const t = useT();
  return (
    <Panel>
      <PanelTitle>{t("Conversion by channel")}</PanelTitle>
      {rows.length === 0 ? <p className="text-sm text-text-2">{t("No outreach in this period.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Channel")}</th>{CONVERSION_STEPS.map((s) => <th key={s} className="py-1 text-right font-medium">{t(CONVERSION_STEP_LABELS[s])}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.channel} className="border-t border-hairline">
                <td className="py-1.5">{t(CHANNEL_LABELS[r.channel])}</td>
                {CONVERSION_STEPS.map((s) => <td key={s} className="num py-1.5 text-right">{s === "cashMinor" ? (r.cashMinor ? formatEur(r.cashMinor) : "—") : r[s]}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[12px] text-text-3">{t("Contacts = different businesses touched on the channel. Later steps go to the channel of the last touch; cash = deals won (value, or the offer's default).")}</p>
      <h3 className="mt-4 text-[13px] font-semibold text-text-2">{t("Time split")}</h3>
      <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {split.map((x) => <span key={x.area}>{t(TIME_AREA_LABELS[x.area])} <span className={cn("num font-semibold", x.share !== null && Math.abs(x.share - x.target) > 0.1 ? "text-bad" : "text-ink")}>{pctTxt(x.share)}</span> <span className="text-text-3">/ {pctTxt(x.target)}</span></span>)}
      </p>
      <p className="mt-1 text-[12px] text-text-3">{t("Actual / target. Sales = logged outreach × minutes per action and done sales tasks; other areas = done tasks' estimated minutes.")}</p>
    </Panel>
  );
}

function WeekPicker({ start, setWeek }: { start: string; setWeek: (w: string) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(start, -7))}>← {t("Previous")}</Button>
      <span className="num">{t("Week of {date}", { date: start })}</span>
      <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(start, 7))}>{t("Next")} →</Button>
    </div>
  );
}

type Fact = { key: string; vars?: Record<string, string | number> };

/** Short, data-only reading of the week: what went well, what to improve (max 3 each). */
function weekFacts(d: Weekly, t: (k: string) => string): { good: Fact[]; fix: Fact[] } {
  const good: Fact[] = [], fix: Fact[] = [];
  const sum = (pick: (f: Weekly["perFounder"][keyof Weekly["perFounder"]]) => number) => FOUNDERS.reduce((a, f) => a + pick(d.perFounder[f]), 0);
  const calls = sum((p) => p.actual.calls ?? 0);
  if (calls === 0) fix.push({ key: "No call logged this week." });
  for (const m of ["calls", "new_businesses"] as const) {
    const target = sum((p) => p.target[m] ?? 0), actual = sum((p) => p.actual[m] ?? 0);
    if (!target) continue;
    if (actual >= target) good.push({ key: "{metric}: target reached ({n} / {total}).", vars: { metric: t(METRIC_LABELS[m]), n: actual, total: target } });
    else if (actual < target * 0.8 && actual > 0) fix.push({ key: "{metric}: {n} of {total} done.", vars: { metric: t(METRIC_LABELS[m]), n: actual, total: target } });
  }
  const passed = sum((p) => p.passed), scheduled = sum((p) => p.scheduled);
  if (scheduled && passed === scheduled) good.push({ key: "Every scheduled day passed ({n}).", vars: { n: passed } });
  else if (scheduled) fix.push({ key: "{n} of {total} scheduled days passed.", vars: { n: passed, total: scheduled } });
  const meetings = sum((p) => p.funnel.meetingsBooked), talks = sum((p) => p.funnel.conversations), won = sum((p) => p.funnel.sales);
  if (won) good.push({ key: "{n} deals won.", vars: { n: won } });
  if (meetings) good.push({ key: "{n} meetings booked.", vars: { n: meetings } });
  else if (talks >= 5) fix.push({ key: "{n} conversations but no meeting: ask for the slot before hanging up.", vars: { n: talks } });
  const obj = d.topObjections[0];
  if (obj && obj.count >= 3) fix.push({ key: "Most heard objection: {objection} ({n} times).", vars: { objection: t(obj.label), n: obj.count } });
  return { good: good.slice(0, 3), fix: fix.slice(0, 3) };
}

function WeeklyReview({ week, setWeek }: { week?: string; setWeek: (w: string) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["weekly", week], queryFn: () => api<Weekly>(`/api/weekly${week ? `?week=${week}` : ""}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const sum = (pick: (f: Weekly["perFounder"][keyof Weekly["perFounder"]]) => number) => FOUNDERS.reduce((a, f) => a + pick(d.perFounder[f]), 0);
  const { good, fix } = weekFacts(d, t);
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <WeekPicker start={d.weekStart} setWeek={setWeek} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t("Calls")} value={String(sum((p) => p.actual.calls ?? 0))} dark />
        <Kpi label={t("Qualified conversations")} value={String(d.kpi.qualified)} note={t("target {n}", { n: d.kpi.qualifiedTarget })} />
        <Kpi label={t("Meetings booked")} value={String(sum((p) => p.funnel.meetingsBooked))} note={t("target {n}", { n: d.kpi.meetingsTarget })} />
        <Kpi label={t("New businesses contacted")} value={String(sum((p) => p.actual.new_businesses ?? 0))} note={t("theoretical volume {n}", { n: d.kpi.contactsTheoretical })} />
      </div>
      <Panel>
        {good.length || fix.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section><h3 className="mb-1 text-sm font-semibold">{t("What went well")}</h3>{good.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{good.map((f) => <li key={f.key}>{t(f.key, f.vars)}</li>)}</ul> : <p className="text-sm text-text-2">—</p>}</section>
            <section><h3 className="mb-1 text-sm font-semibold">{t("What to improve")}</h3>{fix.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{fix.map((f) => <li key={f.key}>{t(f.key, f.vars)}</li>)}</ul> : <p className="text-sm text-text-2">—</p>}</section>
          </div>
        ) : <p className="text-sm text-text-2">{t("Not enough activity this week to draw conclusions.")}</p>}
      </Panel>
      <FridayRules rules={d.friday} />
      <WeeklyForm key={d.weekStart + (d.saved?.version ?? 0)} d={d} />
    </div>
  );
}

/** Friday review rules (iteration 8): the ones this week's numbers point to are marked. */
function FridayRules({ rules }: { rules: Weekly["friday"] }) {
  const t = useT();
  return (
    <Panel>
      <PanelTitle>{t("Friday rules")}</PanelTitle>
      <ul className="flex flex-col gap-1.5 text-sm">
        {rules.map((r) => (
          <li key={r.key} className={cn("flex gap-2", r.applies === false && "text-text-3")}>
            <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.applies ? "bg-sales" : "bg-hairline")} />
            <span>
              <span className={cn(r.applies && "font-semibold")}>{t(r.text)}</span>
              {r.applies ? <span className="text-text-2"> — {t("applies this week")}{r.detail ? ` · ${t(r.detail)}` : ""}{r.evidence ? ` · ${t(r.evidence.key, r.evidence.vars)}` : ""}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-text-3">{t("Marked when this week's numbers point to the rule; nothing is concluded below the minimum sample.")}</p>
    </Panel>
  );
}

/**
 * Three fields only (iteration 7). Stored in the existing WeeklyReviews columns, no schema change:
 * "What worked" → worked, "What blocked" → blocked, "Priority next week" → priority_<me>; older notes/decisions are kept. The co-founder's priority is sent back unchanged.
 */
function WeeklyForm({ d }: { d: Weekly }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe().founder;
  const other = me === "theo" ? "pablo" : "theo";
  const mine = me === "theo" ? "priority_theo" : "priority_pablo";
  const theirs = d.saved?.[other === "theo" ? "priority_theo" : "priority_pablo"] ?? "";
  const [v, setV] = React.useState({ worked: d.saved?.worked || d.saved?.notes || "", blocked: d.saved?.blocked || "", priority: d.saved?.[mine] ?? "" });
  const m = useMutation({
    mutationFn: () => api("/api/weekly", { body: { week_start: d.weekStart, worked: v.worked, blocked: v.blocked, notes: d.saved?.notes ?? "", decisions: d.saved?.decisions ?? "", priority_theo: me === "theo" ? v.priority : theirs, priority_pablo: me === "pablo" ? v.priority : theirs } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly"] }); toast(t("Saved")); },
  });
  return (
    <Panel>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("What worked")} htmlFor="wr-w"><Textarea id="wr-w" rows={2} value={v.worked} onChange={(e) => setV({ ...v, worked: e.target.value })} /></Field>
        <Field label={t("What blocked")} htmlFor="wr-b"><Textarea id="wr-b" rows={2} value={v.blocked} onChange={(e) => setV({ ...v, blocked: e.target.value })} /></Field>
        <Field label={t("Priority next week")} htmlFor="wr-p" hint={theirs ? t("{name}'s priority: {text}", { name: FOUNDER_NAMES[other], text: theirs }) : undefined}><Input id="wr-p" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} /></Field>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" className="self-start" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Panel>
  );
}

function Consistency() {
  const t = useT();
  const q = useQuery({ queryKey: ["streaks"], queryFn: () => api<Streaks>("/api/streaks") });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const p = (c: { pct: number | null; passed: number; scheduled: number }) => (c.pct === null ? t("no scheduled day") : `${Math.round(c.pct * 100)}% (${c.passed}/${c.scheduled})`);
  return (
    <Panel>
      <PanelTitle>{t("Your consistency, last 30 days")}</PanelTitle>
      <DayDots days={d.days} label={t("Daily results, last 30 days")} />
      <p className="mt-4 text-sm"><span className="num font-semibold">{d.streak}</span> {t("day streak")} · {t("7 days")} {p(d.c7)} · {t("30 days")} {p(d.c30)}</p>
      <p className="mt-1 text-[12px] text-text-3">{t("Only your own days are shown. There is no founder-versus-founder ranking.")}</p>
    </Panel>
  );
}
