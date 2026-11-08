"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, Select, Skeleton, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import type { streakSummary } from "@/server/services/results";
import { fmtDateTime, fmtDay } from "./bits";
import { useQuickAction } from "./quick-action";
import { TaskRowItem, NewTaskModal, useTasks } from "./tasks-view";
import { useAgenda } from "./agenda-view";
import { useCrm } from "./use-crm";

type Streaks = Awaited<ReturnType<typeof streakSummary>>;
type Nba = { tier: number; tierLabel: string; accountId: string; opportunityId: string | null; title: string; why: string };

export function useStreaks() {
  return useQuery({ queryKey: ["streaks"], queryFn: () => api<Streaks>("/api/streaks") });
}

export function StreakLine() {
  const q = useStreaks();
  if (!q.data) return null;
  const s = q.data;
  const c = (x: { pct: number | null }) => (x.pct === null ? "—" : `${Math.round(x.pct * 100)}%`);
  return (
    <p className="text-[13px] text-text-2">
      Streak <span className="num font-semibold text-ink">{s.streak}</span> · 7 days {c(s.c7)} · 30 days {c(s.c30)}
      {s.todayStatus.attainment !== null ? <> · today {s.todayStatus.wouldPass ? "on track to pass" : s.todayStatus.reviewDone ? "review done" : "review not done yet"}</> : null}
    </p>
  );
}

export function NextBestActions() {
  const qa = useQuickAction();
  const crm = useCrm();
  const q = useQuery({ queryKey: ["nba"], queryFn: () => api<Nba[]>("/api/nba") });
  const [all, setAll] = React.useState(false);
  const phone = new Map((crm.data?.accounts ?? []).map((a) => [a.id, a.phone]));
  return (
    <Panel aria-labelledby="nba-title">
      <PanelTitle action={q.data && q.data.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `See all ${q.data.length}`}</Button> : null}>
        <span id="nba-title">Next best actions</span>
      </PanelTitle>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <p className="text-sm text-text-2">Queue empty: no reply waiting, no follow-up due, no hot lead going cold.</p>
      ) : (
        <ol className="flex flex-col">
          {(all ? q.data : q.data.slice(0, 5)).map((i) => (
            <li key={i.accountId} className="flex items-center gap-2 border-t border-hairline py-2.5 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.title}</p>
                <p className="text-[13px] text-text-2"><span className="font-medium text-ink">{i.tierLabel}.</span> {i.why}</p>
              </div>
              {phone.get(i.accountId) ? <a href={`tel:${phone.get(i.accountId)}`} className="flex size-10 items-center justify-center rounded-full text-text-2 hover:bg-subtle" aria-label="Call"><Phone className="size-4" /></a> : null}
              <Button size="sm" variant="outline" onClick={() => qa.open({ kind: i.tier === 5 ? "call" : "follow_up", accountId: i.accountId, opportunityId: i.opportunityId ?? undefined })}>Log</Button>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[12px] text-text-3">Order: replies waiting · overdue high-priority · due today · hot leads going cold · new targets in the sprint niche.</p>
    </Panel>
  );
}

export function TodaysTasks() {
  const q = useTasks("mine");
  const [adding, setAdding] = React.useState(false);
  const today = new Date().toLocaleDateString("en-CA");
  const items = (q.data ?? []).filter((t) => (t.status === "todo" || t.status === "in_progress") && (!t.snoozed_until || t.snoozed_until <= today) && ((t.due_at && t.due_at <= today) || (!t.due_at && t.priority === "P0")));
  const doneToday = (q.data ?? []).filter((t) => t.status === "done" && t.completed_at?.slice(0, 10) === today);
  return (
    <Panel aria-labelledby="tt-title">
      <PanelTitle action={<div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => setAdding(true)}>Add</Button><Button asChild variant="ghost" size="sm"><Link href="/tasks">All tasks</Link></Button></div>}>
        <span id="tt-title">Today&apos;s tasks <span className="num text-text-3">{items.length}</span></span>
      </PanelTitle>
      {q.isPending ? <Skeleton className="h-24" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? (
        <p className="text-sm text-text-2">{doneToday.length ? `All done: ${doneToday.length} completed today.` : "No task due today."}</p>
      ) : <ul>{items.slice(0, 5).map((t) => <TaskRowItem key={t.id} t={t} />)}</ul>}
      <NewTaskModal open={adding} onOpenChange={setAdding} />
    </Panel>
  );
}

export function NextMeetings() {
  const q = useAgenda();
  const next = (q.data?.events ?? []).filter((e) => e.kind !== "other_busy").slice(0, 2);
  if (!next.length) return null;
  return (
    <p className="text-[13px] text-text-2">
      Next: {next.map((e, i) => <span key={e.id}>{i ? " · " : ""}<span className="font-medium text-ink">{e.title}</span> {fmtDateTime(e.start)}</span>)} · <Link className="underline underline-offset-2" href="/agenda">Agenda</Link>
    </p>
  );
}

export function CloseDayButton() {
  const [open, setOpen] = React.useState(false);
  const review = useQuery({ queryKey: ["review"], queryFn: () => api<{ review: { went_well: string; blockers: string; tomorrow_priority: string } | null }>("/api/review") });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{review.data?.review ? "Edit day review" : "Close my day"}</Button>
      <Modal open={open} onOpenChange={setOpen} title="End-of-day review" description="Required to pass the day. Two minutes, then tomorrow starts with a priority.">
        {open ? <ReviewForm initial={review.data?.review ?? null} onDone={() => setOpen(false)} /> : null}
      </Modal>
    </>
  );
}
function ReviewForm({ initial, onDone }: { initial: { went_well: string; blockers: string; tomorrow_priority: string } | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState(initial ?? { went_well: "", blockers: "", tomorrow_priority: "" });
  const m = useMutation({ mutationFn: () => api("/api/review", { body: v }), onSuccess: () => { qc.invalidateQueries(); toast("Day review saved"); onDone(); } });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.tomorrow_priority.trim()) m.mutate(); }}>
      <Field label="What moved forward?" htmlFor="rv-w"><Textarea id="rv-w" value={v.went_well} onChange={(e) => setV({ ...v, went_well: e.target.value })} /></Field>
      <Field label="What blocked you?" htmlFor="rv-b"><Textarea id="rv-b" value={v.blockers} onChange={(e) => setV({ ...v, blockers: e.target.value })} /></Field>
      <Field label="Tomorrow's priority (required)" htmlFor="rv-t"><Input id="rv-t" required value={v.tomorrow_priority} onChange={(e) => setV({ ...v, tomorrow_priority: e.target.value })} /></Field>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      <Button type="submit" variant="primary" disabled={!v.tomorrow_priority.trim() || m.isPending}>{m.isPending ? "Saving…" : "Save review"}</Button>
    </form>
  );
}

export function LateCorrections() {
  const q = useStreaks();
  const qc = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [date, setDate] = React.useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api("/api/streaks/correction", { body: { local_date: date, reason } }), onSuccess: () => { qc.invalidateQueries(); setDate(null); setReason(""); toast("Day recomputed with the late activity"); } });
  const days = q.data?.lateDaysToCorrect ?? [];
  if (!days.length) return null;
  return (
    <div className="rounded-[12px] bg-subtle p-3 text-sm">
      <p>Activity was logged after the cutoff for {days.map(fmtDay).join(", ")}. A closed day changes only through a correction with a reason.</p>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (date && reason.trim().length >= 5) m.mutate(); }}>
        <Select aria-label="Day" value={date ?? ""} onChange={(e) => setDate(e.target.value || null)} className="h-9 w-40"><option value="">Choose a day</option>{days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}</Select>
        <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. logged from the car after a visit)" className="h-9 min-w-56 flex-1" />
        <Button type="submit" size="sm" variant="outline" disabled={!date || reason.trim().length < 5 || m.isPending}>Apply correction</Button>
      </form>
      {m.isError ? <div className="mt-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
    </div>
  );
}

type Job = { id: string; version: number; company: string; role: string; status: string; next_step: string; next_step_due: string | null };
export function JobSearch() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["jobs"], queryFn: () => api<{ configured: boolean; jobs: Job[] }>("/api/jobs") });
  const [adding, setAdding] = React.useState(false);
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ company: "", role: "", next_step: "", next_step_due: "" });
  const m = useMutation({ mutationFn: () => api("/api/jobs", { body: { id, ...v, status: "applied", applied_on: new Date().toLocaleDateString("en-CA") } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); setId(crypto.randomUUID()); setV({ company: "", role: "", next_step: "", next_step_due: "" }); setAdding(false); } });
  if (!q.data?.configured) return null;
  return (
    <Panel aria-labelledby="js-title">
      <PanelTitle action={<Button variant="ghost" size="sm" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "Add"}</Button>}>
        <span id="js-title" className="flex items-center gap-1.5"><Lock className="size-4" /> Job search (only you)</span>
      </PanelTitle>
      {adding ? (
        <form className="mb-3 grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); if (v.company.trim()) m.mutate(); }}>
          <Input aria-label="Company" placeholder="Company" value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />
          <Input aria-label="Role" placeholder="Role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} />
          <Input aria-label="Next step" placeholder="Next step" value={v.next_step} onChange={(e) => setV({ ...v, next_step: e.target.value })} />
          <Input aria-label="Next step due" type="date" value={v.next_step_due} onChange={(e) => setV({ ...v, next_step_due: e.target.value })} />
          <Button type="submit" size="sm" variant="primary" className="col-span-2 justify-self-start" disabled={!v.company.trim() || m.isPending}>Save</Button>
        </form>
      ) : null}
      {(q.data.jobs ?? []).length === 0 ? <p className="text-sm text-text-2">No application tracked.</p> : (
        <ul className="text-sm">{q.data.jobs.slice(0, 5).map((j) => <li key={j.id} className="flex justify-between gap-2 border-t border-hairline py-2 first:border-t-0"><span className="min-w-0 truncate"><span className="font-medium">{j.company}</span>{j.role ? ` · ${j.role}` : ""}<span className="block text-[12px] text-text-2">{j.status}{j.next_step ? ` · ${j.next_step}` : ""}</span></span><span className="num shrink-0 text-[12px] text-text-3">{j.next_step_due ? fmtDay(j.next_step_due) : ""}</span></li>)}</ul>
      )}
      <p className="mt-2 text-[12px] text-text-3">Stored in your private spreadsheet. Never in team metrics, exports or your co-founder&apos;s views.</p>
    </Panel>
  );
}
