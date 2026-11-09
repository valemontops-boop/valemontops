"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Skeleton, Textarea } from "@/components/ui/form";
import { FOUNDERS, FOUNDER_NAMES, METRICS, METRIC_LABELS } from "@/domain/constants";
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
          {d.byMarket.length ? <Bars data={d.byMarket.map((m) => ({ label: m.key, value: m.dials, tone: m.key === "ES" ? ("muted" as const) : ("ink" as const), sub: t("{pickup} pick-up · {yes} yes", { pickup: pctTxt(m.picked && m.dials ? m.picked / m.dials : null), yes: pctTxt(m.yesRate) }) }))} /> : <p className="text-sm text-text-2">No calls yet.</p>}
        </Panel>
        <Panel>
          <PanelTitle>{t("By trade")}</PanelTitle>
          {d.byNiche.length ? <Bars tone="sales" data={d.byNiche.map((m) => ({ label: m.key, value: m.dials, sub: t("{pct} yes when reached", { pct: pctTxt(m.yesRate) }) }))} /> : <p className="text-sm text-text-2">No calls yet.</p>}
        </Panel>
      </div>
    </>
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

function WeeklyReview({ week, setWeek }: { week?: string; setWeek: (w: string) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["weekly", week], queryFn: () => api<Weekly>(`/api/weekly${week ? `?week=${week}` : ""}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const shown = METRICS.filter((m) => FOUNDERS.some((f) => (d.perFounder[f].target[m] ?? 0) > 0 || (d.perFounder[f].actual[m] ?? 0) > 0));
  return (
    <>
      <WeekPicker start={d.weekStart} setWeek={setWeek} />
      <Panel className="overflow-x-auto">
        <PanelTitle>{t("This week against targets")}</PanelTitle>
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium">{t("Action")}</th>{FOUNDERS.map((f) => <th key={f} className="text-right font-medium">{FOUNDER_NAMES[f]} ({t("done / target")})</th>)}</tr></thead>
          <tbody>
            {shown.map((m) => <tr key={m} className="border-t border-hairline"><td className="py-1.5">{t(METRIC_LABELS[m])}</td>{FOUNDERS.map((f) => <td key={f} className="num text-right">{d.perFounder[f].actual[m] ?? 0} / {d.perFounder[f].target[m] ?? 0}</td>)}</tr>)}
            <tr className="border-t border-hairline"><td className="py-1.5">{t("Days passed")}</td>{FOUNDERS.map((f) => <td key={f} className="num text-right">{t("{passed} / {scheduled} closed", { passed: d.perFounder[f].passed, scheduled: d.perFounder[f].scheduled })}</td>)}</tr>
            {(["conversations", "demos", "meetingsBooked", "proposals", "sales"] as const).map((k) => <tr key={k} className="border-t border-hairline"><td className="py-1.5">{t({ conversations: "Conversations", demos: "Demos", meetingsBooked: "Meetings booked", proposals: "Proposals", sales: "Deals won" }[k])}</td>{FOUNDERS.map((f) => <td key={f} className="num text-right">{d.perFounder[f].funnel[k]}</td>)}</tr>)}
          </tbody>
        </table>
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel><PanelTitle>{t("Top objections")}</PanelTitle>{d.topObjections.length ? <ul className="text-sm">{d.topObjections.map((o) => <li key={o.label} className="flex justify-between border-t border-hairline py-1.5 first:border-t-0"><span>{t(o.label)}</span><span className="num">{o.count}</span></li>)}</ul> : <p className="text-sm text-text-2">{t("No objection logged this week.")}</p>}</Panel>
        <Panel><PanelTitle>{t("Decisions from founder points")}</PanelTitle>{d.decisions.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{d.decisions.map((x) => <li key={x.id}>{x.text}</li>)}</ul> : <p className="text-sm text-text-2">{t("No decision recorded this week.")}</p>}</Panel>
      </div>
      <WeeklyForm key={d.weekStart + (d.saved?.version ?? 0)} d={d} />
    </>
  );
}

function WeeklyForm({ d }: { d: Weekly }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState({ decisions: d.saved?.decisions ?? "", notes: d.saved?.notes ?? "", priority_theo: d.saved?.priority_theo ?? "", priority_pablo: d.saved?.priority_pablo ?? "" });
  const m = useMutation({ mutationFn: () => api("/api/weekly", { body: { week_start: d.weekStart, ...v } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly"] }); toast(t("Saved")); } });
  return (
    <Panel>
      <PanelTitle>{t("Next week")}</PanelTitle>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("{name}'s single priority", { name: FOUNDER_NAMES.theo })} htmlFor="wp-t"><Input id="wp-t" value={v.priority_theo} onChange={(e) => setV({ ...v, priority_theo: e.target.value })} /></Field>
        <Field label={t("{name}'s single priority", { name: FOUNDER_NAMES.pablo })} htmlFor="wp-p"><Input id="wp-p" value={v.priority_pablo} onChange={(e) => setV({ ...v, priority_pablo: e.target.value })} /></Field>
        <Field label={t("Decisions taken in this review")} htmlFor="wp-d" className="sm:col-span-2"><Textarea id="wp-d" value={v.decisions} onChange={(e) => setV({ ...v, decisions: e.target.value })} /></Field>
        <Field label={t("Notes")} htmlFor="wp-n" className="sm:col-span-2"><Textarea id="wp-n" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        {m.isError ? <div className="sm:col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
        <Button type="submit" variant="primary" className="self-start" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save weekly review")}</Button>
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
