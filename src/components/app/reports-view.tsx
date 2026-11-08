"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Skeleton, Textarea } from "@/components/ui/form";
import { FOUNDERS, FOUNDER_NAMES, METRICS, METRIC_LABELS } from "@/domain/constants";
import { addDays } from "@/domain/time";
import { api } from "@/lib/api";
import type { scorecard, weeklyReview } from "@/server/services/insights";
import type { streakSummary } from "@/server/services/results";
import { DayDots } from "./bits";
import { useMe } from "./providers";

type Weekly = Awaited<ReturnType<typeof weeklyReview>>;
type Score = Awaited<ReturnType<typeof scorecard>>;
type Streaks = Awaited<ReturnType<typeof streakSummary>>;
type Tab = "weekly" | "scorecard" | "consistency";

export function ReportsView() {
  const [tab, setTab] = React.useState<Tab>("weekly");
  const [week, setWeek] = React.useState<string | undefined>(undefined);
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <SegmentedSwitch label="Report" value={tab} onChange={setTab} options={[{ value: "weekly", label: "Weekly review" }, { value: "scorecard", label: "Scorecard" }, { value: "consistency", label: "Consistency" }]} />
      </div>
      {tab === "weekly" ? <WeeklyReview week={week} setWeek={setWeek} /> : tab === "scorecard" ? <Scorecard week={week} setWeek={setWeek} /> : <Consistency />}
    </div>
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

function Scorecard({ week, setWeek }: { week?: string; setWeek: (w: string) => void }) {
  const q = useQuery({ queryKey: ["scorecard", week], queryFn: () => api<Score>(`/api/reports/scorecard${week ? `?week=${week}` : ""}`) });
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const rate = (r: { num: number; den: number; pct: number | null }) => (r.pct === null ? <span className="text-text-3">{r.num}/{r.den} · not enough data</span> : <>{Math.round(r.pct * 100)}% <span className="text-text-3">({r.num}/{r.den})</span></>);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2"><WeekPicker start={d.weekStart} setWeek={setWeek} /><Button asChild size="sm" variant="outline"><a href={`/api/reports/scorecard?format=csv${week ? `&week=${week}` : ""}`}>Download CSV</a></Button></div>
      <Panel className="overflow-x-auto">
        <PanelTitle>Outreach by channel</PanelTitle>
        <table className="w-full min-w-[460px] text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium">Channel</th>{d.rows.map((r) => <th key={r.founder} className="text-right font-medium">{FOUNDER_NAMES[r.founder]}</th>)}</tr></thead>
          <tbody>{d.rows[0].byChannel.map((c, i) => <tr key={c.channel} className="border-t border-hairline"><td className="py-1.5">{c.label}</td>{d.rows.map((r) => <td key={r.founder} className="num text-right">{r.byChannel[i].count}</td>)}</tr>)}</tbody>
        </table>
      </Panel>
      <Panel className="overflow-x-auto">
        <PanelTitle>Conversion (rates shown from {d.minSample} attempts)</PanelTitle>
        <table className="w-full min-w-[460px] text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium">Step</th>{d.rows.map((r) => <th key={r.founder} className="text-right font-medium">{FOUNDER_NAMES[r.founder]}</th>)}</tr></thead>
          <tbody>
            {([["conversationsPerAttempt", "Conversations per attempt"], ["demosPerConversation", "Demos per conversation"], ["meetingsPerConversation", "Meetings per conversation"], ["salesPerProposal", "Sales per proposal"]] as const).map(([k, l]) => (
              <tr key={k} className="border-t border-hairline"><td className="py-1.5">{l}</td>{d.rows.map((r) => <td key={r.founder} className="num text-right">{rate(r.conversion[k])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function Consistency() {
  const me = useMe();
  const q = useQuery({ queryKey: ["streaks"], queryFn: () => api<Streaks>("/api/streaks") });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const p = (c: { pct: number | null; passed: number; scheduled: number }) => (c.pct === null ? "no scheduled day" : `${Math.round(c.pct * 100)}% (${c.passed}/${c.scheduled})`);
  return (
    <Panel>
      <PanelTitle>{FOUNDER_NAMES[me.founder]}: last 30 days</PanelTitle>
      <DayDots days={d.days} label="Daily results, last 30 days" />
      <p className="mt-4 text-sm"><span className="num font-semibold">{d.streak}</span> day streak · 7 days {p(d.c7)} · 30 days {p(d.c30)}</p>
      <p className="mt-1 text-[12px] text-text-3">Only your own days are shown. There is no founder-versus-founder ranking.</p>
    </Panel>
  );
}
