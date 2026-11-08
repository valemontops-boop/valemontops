"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import { type CallStats } from "@/domain/calls";
import { ActiveSession } from "./call-live";
import { OBJECTION_LABELS } from "@/domain/constants";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Bars } from "./charts";

type ListRow = { list: { id: string; name: string; niche: string; market: string | null }; total: number; called: number; reached: number; positive: number; meetings: number; remaining: number };
type Summary = { session: { id: string; started_at: string; ended_at: string | null; list_id: string }; stats: CallStats; previous: { sessions: number; pickupRate: number | null; positiveRate: number | null; dials: number | null } };
const SESSION_KEY = "vos-call-session";
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export function CallMode() {
  const [session, setSession] = React.useState<{ id: string; listId: string } | null>(() => {
    try { const v = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null; return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const [ended, setEnded] = React.useState<string | null>(null);
  const keep = (s: { id: string; listId: string } | null) => {
    setSession(s);
    try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* convenience only */ }
  };
  if (ended) return <SessionSummary id={ended} onNew={() => setEnded(null)} />;
  if (session) return <ActiveSession id={session.id} listId={session.listId} onEnd={() => { setEnded(session.id); keep(null); }} />;
  return <StartScreen onStart={(s) => keep(s)} />;
}

function StartScreen({ onStart }: { onStart: (s: { id: string; listId: string }) => void }) {
  const lists = useQuery({ queryKey: ["call-lists"], queryFn: () => api<ListRow[]>("/api/call-lists") });
  const sessions = useQuery({ queryKey: ["call-sessions"], queryFn: () => api<{ session: { id: string; started_at: string }; stats: CallStats }[]>("/api/calls/sessions") });
  const start = useMutation({
    mutationFn: (listId: string) => { const id = crypto.randomUUID(); return api("/api/calls/sessions", { body: { id, list_id: listId } }).then(() => ({ id, listId })); },
    onSuccess: onStart,
  });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Call mode</h1>
        <p className="text-sm text-text-2">Tap one box per call. Refusals are only counted; people who say yes go straight into your pipeline.</p>
      </div>
      <Panel>
        <PanelTitle>Call from a list</PanelTitle>
        {lists.isPending ? <Skeleton className="h-24" /> : lists.isError ? <ErrorState error={lists.error} onRetry={() => lists.refetch()} /> : lists.data.length === 0 ? (
          <EmptyState title="No call list yet" action={<Button asChild size="sm" variant="outline"><Link href="/crm/import">Import a list</Link></Button>}>Import a CSV of businesses; it becomes a list you call through.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.data.map((l) => (
              <li key={l.list.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.list.name}</p>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <div className="bg-ink" style={{ width: `${l.total ? (l.called / l.total) * 100 : 0}%` }} />
                  </div>
                  <p className="num mt-1 text-[12px] text-text-2">{l.called}/{l.total} called · {l.reached} reached · {l.positive} yes · {l.meetings} meetings · {l.remaining} left</p>
                </div>
                <Button variant="primary" disabled={start.isPending || l.remaining === 0} onClick={() => start.mutate(l.list.id)}>Start calling</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">Free dialling</p><p className="text-sm text-text-2">Your own numbers. Type the number if you want, or just tap outcomes.</p></div>
        <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate("")}><Phone /> Start free session</Button>
      </Panel>
      {start.isError ? <ErrorState error={start.error} onRetry={() => start.reset()} /> : null}
      <ObjectionsPanel />
      {sessions.data?.length ? (
        <Panel>
          <PanelTitle>Recent sessions</PanelTitle>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">Started</th><th className="text-right font-medium">Dials</th><th className="text-right font-medium">Picked up</th><th className="text-right font-medium">Yes</th><th className="text-right font-medium">Meetings</th></tr></thead>
            <tbody>{sessions.data.slice(0, 5).map((s) => <tr key={s.session.id} className="border-t border-hairline"><td className="py-1.5">{new Date(s.session.started_at).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="num text-right">{s.stats.dials}</td><td className="num text-right">{pct(s.stats.pickupRate)}</td><td className="num text-right">{s.stats.interested + s.stats.callBacks}</td><td className="num text-right">{s.stats.meetings}</td></tr>)}</tbody>
          </table>
        </Panel>
      ) : null}
    </div>
  );
}

function SessionSummary({ id, onNew }: { id: string; onNew: () => void }) {
  const q = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { stats: s, previous: p } = q.data;
  const yes = s.interested + s.callBacks + s.meetings;
  const delta = (cur: number | null, prev: number | null) => (cur === null || prev === null ? null : Math.round((cur - prev) * 100));
  const d1 = delta(s.pickupRate, p.pickupRate);
  const d2 = delta(s.positiveRate, p.positiveRate);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold tracking-tight">Session summary</h1><Button variant="primary" onClick={onNew}>New session</Button></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Dials", String(s.dials), s.minutes !== null ? `${s.minutes} min${s.dialsPerHour ? ` · ${s.dialsPerHour}/h` : ""}` : ""], ["Pick-up rate", pct(s.pickupRate), d1 === null ? `${s.pickedUp} picked up` : `${d1 >= 0 ? "+" : ""}${d1} pts vs your average`], ["Yes rate", pct(s.positiveRate), d2 === null ? "of people reached" : `${d2 >= 0 ? "+" : ""}${d2} pts vs your average`], ["Meetings", String(s.meetings), `${yes} yes in total`]].map(([l, v, n], i) => (
          <div key={l} className={cn("rounded-[20px] p-4", i === 3 ? "bg-ink text-panel" : "bg-panel")}><p className={cn("text-[13px]", i === 3 ? "text-panel/80" : "text-text-2")}>{l}</p><p className="num text-[36px] font-semibold leading-tight">{v}</p><p className={cn("text-[12px]", i === 3 ? "text-panel/75" : "text-text-3")}>{n}</p></div>
        ))}
      </div>
      <Panel>
        <PanelTitle>Funnel</PanelTitle>
        <Bars data={[{ label: "Dials", value: s.dials }, { label: "Picked up", value: s.pickedUp }, { label: "Decision-maker", value: s.decisionMakerReached }, { label: "Yes", value: yes }, { label: "Meetings", value: s.meetings }]} showShare />
      </Panel>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Panel><PanelTitle>Objections</PanelTitle>{s.objections.length ? <ObjectionRows rows={s.objections} /> : <p className="text-sm text-text-2">No objection recorded.</p>}</Panel>
        <Panel><PanelTitle>By hour</PanelTitle>{s.byHour.length ? <Bars data={s.byHour.map((h) => ({ label: `${h.hour}:00`, value: h.dials, sub: `${h.pickedUp} picked up` }))} /> : <p className="text-sm text-text-2">No call.</p>}</Panel>
      </div>
    </div>
  );
}

type ObjRow = { key: string; count: number; won: number; wonRate: number | null };
/** Each objection: how often it came up, and the share of those calls that still ended in a yes. */
function ObjectionRows({ rows }: { rows: ObjRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <span className="text-sm">{OBJECTION_LABELS[r.key as keyof typeof OBJECTION_LABELS] ?? r.key}</span>
          <span className="num text-right text-[12px] text-text-2">{r.count} heard · {r.won} won over{r.wonRate !== null ? ` (${Math.round(r.wonRate * 100)}%)` : ""}</span>
          <div className="col-span-2 flex h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <div className="bg-good" style={{ width: `${(r.won / max) * 100}%` }} />
            <div className="bg-control" style={{ width: `${((r.count - r.won) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ObjectionsPanel() {
  const q = useQuery({ queryKey: ["call-objections"], queryFn: () => api<{ days: number; team: ObjRow[]; mine: ObjRow[] }>("/api/calls/objections") });
  if (!q.data?.team.length) return null;
  return (
    <Panel>
      <PanelTitle>Objections, last {q.data.days} days</PanelTitle>
      <p className="mb-3 text-[12px] text-text-2"><span className="mr-1 inline-block size-2 rounded-full bg-good align-middle" />won over (call still ended in a yes) · <span className="mr-1 inline-block size-2 rounded-full bg-control align-middle" />lost. Both founders. Replies to use live are in Settings › Playbook.</p>
      <ObjectionRows rows={q.data.team} />
    </Panel>
  );
}
