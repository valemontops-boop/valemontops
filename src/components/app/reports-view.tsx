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
import { Bars, Kpi } from "./charts";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OBJECTION_LABELS } from "@/domain/constants";
import type { reportsDashboard as dashboard } from "@/server/services/dashboard";

type Weekly = Awaited<ReturnType<typeof weeklyReview>>;
type Streaks = Awaited<ReturnType<typeof streakSummary>>;
type Tab = "dashboard" | "weekly";
type Dash = Awaited<ReturnType<typeof dashboard>>;

export function ReportsView() {
  const [tab, setTab] = React.useState<Tab>("dashboard");
  const [week, setWeek] = React.useState<string | undefined>(undefined);
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <SegmentedSwitch label="Report" value={tab} onChange={setTab} options={[{ value: "dashboard", label: "Dashboard" }, { value: "weekly", label: "Weekly review" }]} />
      </div>
      {tab === "dashboard" ? <Dashboard /> : <WeeklyReview week={week} setWeek={setWeek} />}
    </div>
  );
}

const pctTxt = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function Dashboard() {
  const [days, setDays] = React.useState<"7" | "30" | "90">("30");
  const [scope, setScope] = React.useState<"team" | "me">("team");
  const q = useQuery({ queryKey: ["dashboard", days, scope], queryFn: () => api<Dash>(`/api/reports/dashboard?days=${days}&scope=${scope}`) });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedSwitch size="sm" label="Period" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <SegmentedSwitch size="sm" label="Scope" value={scope} onChange={setScope} options={[{ value: "team", label: "Team" }, { value: "me", label: "Me" }]} />
        {q.data ? <span className="text-[13px] text-text-3">{q.data.from} → {q.data.to} · changes vs the previous {days} days</span> : null}
        <Button asChild size="sm" variant="ghost" className="ml-auto"><a href="/api/reports/scorecard?format=csv">Export week (CSV)</a></Button>
      </div>
      {q.isPending ? <Skeleton className="h-[480px]" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <DashboardBody d={q.data} />}
      <Consistency />
    </>
  );
}

function DashboardBody({ d }: { d: Dash }) {
  const k = d.kpis;
  const best = d.byHour.filter((h) => h.dials >= 3).sort((a, b) => (b.pickupRate ?? 0) - (a.pickupRate ?? 0))[0];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi tone="volume" label="Dials" value={String(k.dials.value ?? 0)} delta={k.dials.delta} note={`${k.newBusinesses.value ?? 0} new businesses`} />
        <Kpi tone="volume" label="Pick-up rate" value={pctTxt(k.pickupRate.value)} delta={k.pickupRate.delta} note="picked up / dials" />
        <Kpi tone="yes" label="Yes rate" value={pctTxt(k.yesRate.value)} delta={k.yesRate.delta} note={`${k.yes.value ?? 0} yes / picked up`} />
        <Kpi label="Meetings booked" value={String(k.meetings.value ?? 0)} delta={k.meetings.delta} dark />
        <Kpi tone="yes" label="Deals won" value={String(k.won.value ?? 0)} delta={k.won.delta} note={`${k.content.value ?? 0} content published`} />
      </div>
      <Panel>
        <PanelTitle>Dials and yes per day</PanelTitle>
        <div className="h-56" role="img" aria-label="Dials and yes per day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.daily} margin={{ top: 4, right: 8, bottom: 0, left: -12 }} barGap={-14}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(x: string) => x.slice(8)} stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
              <YAxis stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: "var(--subtle)" }} contentStyle={{ borderRadius: 12, border: "none", background: "var(--ink)", color: "var(--panel)", fontSize: 12 }} labelFormatter={(x) => String(x)} />
              <Bar dataKey="dials" name="Dials" fill="var(--viz-volume)" radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
              <Bar dataKey="yes" name="Yes" fill="var(--viz-yes)" radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 flex gap-4 text-[12px] text-text-3"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-viz-volume" />Dials <b className="num font-medium text-text-2">{d.daily.reduce((a, x) => a + x.dials, 0)}</b></span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-viz-yes" />Yes <b className="num font-medium text-text-2">{d.daily.reduce((a, x) => a + x.yes, 0)}</b></span></p>
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel><PanelTitle>Funnel</PanelTitle><Bars data={d.funnel.map((f, i) => ({ ...f, tone: i < 2 ? ("volume" as const) : ("yes" as const) }))} showShare /></Panel>
        <Panel><PanelTitle>Objections heard</PanelTitle>{d.objections.length ? <><Bars tone="muted" data={d.objections.map((o) => ({ label: OBJECTION_LABELS[o.key as keyof typeof OBJECTION_LABELS] ?? o.key, value: o.count, sub: o.won ? `${o.won} still said yes` : undefined }))} /><p className="mt-2 text-[12px] text-text-3">Heard on any call, not only refusals. Live replies: Settings › Playbook.</p></> : <p className="text-sm text-text-2">No objection recorded in this period.</p>}</Panel>
        <Panel>
          <PanelTitle>Best hours to call</PanelTitle>
          {d.byHour.length ? <Bars tone="volume" data={d.byHour.map((h) => ({ label: `${h.hour}:00`, value: Math.round((h.pickupRate ?? 0) * 100), sub: `${h.pickedUp}/${h.dials} picked up` }))} max={100} /> : <p className="text-sm text-text-2">No calls yet.</p>}
          {best ? <p className="mt-3 text-[13px] text-text-2">Most pick-ups around <span className="font-semibold text-ink">{best.hour}:00</span> ({pctTxt(best.pickupRate)}). Bars show the pick-up rate in %.</p> : null}
        </Panel>
        <Panel><PanelTitle>Outreach by channel</PanelTitle><Bars tone="volume" data={d.channels.filter((c) => c.count > 0).map((c) => ({ label: METRIC_LABELS[c.metric], value: c.count }))} /></Panel>
        <Panel>
          <PanelTitle>By country</PanelTitle>
          {d.byMarket.length ? <Bars data={d.byMarket.map((m) => ({ label: m.key, value: m.dials, tone: m.key === "ES" ? ("muted" as const) : ("ink" as const), sub: `${pctTxt(m.picked && m.dials ? m.picked / m.dials : null)} pick-up · ${pctTxt(m.yesRate)} yes` }))} /> : <p className="text-sm text-text-2">No calls yet.</p>}
        </Panel>
        <Panel>
          <PanelTitle>By trade</PanelTitle>
          {d.byNiche.length ? <Bars tone="volume" data={d.byNiche.map((m) => ({ label: m.key, value: m.dials, sub: `${pctTxt(m.yesRate)} yes when reached` }))} /> : <p className="text-sm text-text-2">No calls yet.</p>}
        </Panel>
      </div>
    </>
  );
}

function WeekPicker({ start, setWeek }: { start: string; setWeek: (w: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(start, -7))}>← Previous</Button>
      <span className="num">Week of {start}</span>
      <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(start, 7))}>Next →</Button>
    </div>
  );
}

function WeeklyReview({ week, setWeek }: { week?: string; setWeek: (w: string) => void }) {
  const q = useQuery({ queryKey: ["weekly", week], queryFn: () => api<Weekly>(`/api/weekly${week ? `?week=${week}` : ""}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const shown = METRICS.filter((m) => FOUNDERS.some((f) => (d.perFounder[f].target[m] ?? 0) > 0 || (d.perFounder[f].actual[m] ?? 0) > 0));
  return (
    <>
      <WeekPicker start={d.weekStart} setWeek={setWeek} />
      <Panel className="overflow-x-auto">
        <PanelTitle>This week against targets</PanelTitle>
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium">Action</th>{FOUNDERS.map((f) => <th key={f} className="text-right font-medium">{FOUNDER_NAMES[f]} (done / target)</th>)}</tr></thead>
          <tbody>
            {shown.map((m) => <tr key={m} className="border-t border-hairline"><td className="py-1.5">{METRIC_LABELS[m]}</td>{FOUNDERS.map((f) => <td key={f} className="num text-right">{d.perFounder[f].actual[m] ?? 0} / {d.perFounder[f].target[m] ?? 0}</td>)}</tr>)}
            <tr className="border-t border-hairline"><td className="py-1.5">Days passed</td>{FOUNDERS.map((f) => <td key={f} className="num text-right">{d.perFounder[f].passed} / {d.perFounder[f].scheduled} closed</td>)}</tr>
            {(["conversations", "demos", "meetingsBooked", "proposals", "sales"] as const).map((k) => <tr key={k} className="border-t border-hairline"><td className="py-1.5">{{ conversations: "Conversations", demos: "Demos", meetingsBooked: "Meetings booked", proposals: "Proposals", sales: "Deals won" }[k]}</td>{FOUNDERS.map((f) => <td key={f} className="num text-right">{d.perFounder[f].funnel[k]}</td>)}</tr>)}
          </tbody>
        </table>
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel><PanelTitle>Top objections</PanelTitle>{d.topObjections.length ? <ul className="text-sm">{d.topObjections.map((o) => <li key={o.label} className="flex justify-between border-t border-hairline py-1.5 first:border-t-0"><span>{o.label}</span><span className="num">{o.count}</span></li>)}</ul> : <p className="text-sm text-text-2">No objection logged this week.</p>}</Panel>
        <Panel><PanelTitle>Decisions from founder points</PanelTitle>{d.decisions.length ? <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{d.decisions.map((x) => <li key={x.id}>{x.text}</li>)}</ul> : <p className="text-sm text-text-2">No decision recorded this week.</p>}</Panel>
      </div>
      <WeeklyForm key={d.weekStart + (d.saved?.version ?? 0)} d={d} />
    </>
  );
}

function WeeklyForm({ d }: { d: Weekly }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({ decisions: d.saved?.decisions ?? "", notes: d.saved?.notes ?? "", priority_theo: d.saved?.priority_theo ?? "", priority_pablo: d.saved?.priority_pablo ?? "" });
  const m = useMutation({ mutationFn: () => api("/api/weekly", { body: { week_start: d.weekStart, ...v } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["weekly"] }); toast("Saved"); } });
  return (
    <Panel>
      <PanelTitle>Next week</PanelTitle>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Théo's single priority" htmlFor="wp-t"><Input id="wp-t" value={v.priority_theo} onChange={(e) => setV({ ...v, priority_theo: e.target.value })} /></Field>
        <Field label="Pablo's single priority" htmlFor="wp-p"><Input id="wp-p" value={v.priority_pablo} onChange={(e) => setV({ ...v, priority_pablo: e.target.value })} /></Field>
        <Field label="Decisions taken in this review" htmlFor="wp-d" className="sm:col-span-2"><Textarea id="wp-d" value={v.decisions} onChange={(e) => setV({ ...v, decisions: e.target.value })} /></Field>
        <Field label="Notes" htmlFor="wp-n" className="sm:col-span-2"><Textarea id="wp-n" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        {m.isError ? <div className="sm:col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
        <Button type="submit" variant="primary" className="self-start" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save weekly review"}</Button>
      </form>
    </Panel>
  );
}

function Consistency() {
  const q = useQuery({ queryKey: ["streaks"], queryFn: () => api<Streaks>("/api/streaks") });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const p = (c: { pct: number | null; passed: number; scheduled: number }) => (c.pct === null ? "no scheduled day" : `${Math.round(c.pct * 100)}% (${c.passed}/${c.scheduled})`);
  return (
    <Panel>
      <PanelTitle>Your consistency, last 30 days</PanelTitle>
      <DayDots days={d.days} label="Daily results, last 30 days" />
      <p className="mt-4 text-sm"><span className="num font-semibold">{d.streak}</span> day streak · 7 days {p(d.c7)} · 30 days {p(d.c30)}</p>
      <p className="mt-1 text-[12px] text-text-3">Only your own days are shown. There is no founder-versus-founder ranking.</p>
    </Panel>
  );
}
