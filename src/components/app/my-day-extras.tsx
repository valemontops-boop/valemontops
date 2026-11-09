"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
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
import { TaskRowItem, NewTaskModal, useTasks, type Area } from "./tasks-view";
import { cn } from "@/lib/utils";
import { useAgenda } from "./agenda-view";
import { useCrm } from "./use-crm";
import { useDateTag, useT } from "@/i18n/react";

type Streaks = Awaited<ReturnType<typeof streakSummary>>;
type Nba = { tier: number; tierLabel: string; accountId: string; opportunityId: string | null; title: string; why: string };

export function useStreaks() {
  return useQuery({ queryKey: ["streaks"], queryFn: () => api<Streaks>("/api/streaks") });
}

/** Multi-day streak: one column per day for the last 14 days, shape + color by status. */
const STATUS_LABEL: Record<string, string> = { scheduled: "Scheduled", in_progress: "In progress", passed: "Passed", perfect: "Perfect", missed: "Missed", off: "Off" };

export function StreakStrip() {
  const t = useT();
  const tag = useDateTag();
  const q = useStreaks();
  if (q.isPending) return <Skeleton className="h-24" />;
  if (q.isError) return null;
  const s = q.data;
  const days = s.days.slice(-14);
  const c = (x: { pct: number | null }) => (x.pct === null ? "—" : `${Math.round(x.pct * 100)}%`);
  const dot = (st: string) => st === "perfect" ? "bg-ink ring-2 ring-ink ring-offset-2 ring-offset-panel" : st === "passed" ? "bg-ink" : st === "missed" ? "border-2 border-bad" : st === "in_progress" ? "border-2 border-ink border-dashed" : "bg-subtle";
  return (
    <section aria-label={t("Streak")} className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[20px] bg-panel px-5 py-4">
      <div className="flex items-baseline gap-2">
        <span className="num text-[40px] font-semibold leading-none tracking-tight">{s.streak}</span>
        <span className="text-sm text-text-2">{t("day streak")}</span>
      </div>
      <ol className="flex flex-1 items-end gap-1.5" aria-label={t("Last 14 days")}>
        {days.map((d) => (
          <li key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${t(STATUS_LABEL[d.status] ?? d.status)}${d.attainment !== null ? ` · ${Math.round(d.attainment * 100)}%` : ""}`}>
            <span className={cn("size-4 rounded-full sm:size-5", dot(d.status))} />
            <span className="num text-[10px] text-text-3">{new Intl.DateTimeFormat(tag, { weekday: "narrow", timeZone: "UTC" }).format(new Date(d.date + "T12:00:00Z"))}</span>
            <span className="sr-only">{d.date} {t(STATUS_LABEL[d.status] ?? d.status)}</span>
          </li>
        ))}
      </ol>
      <div className="flex gap-4 text-[13px] text-text-2">
        <span>{t("7 days")} <span className="num font-semibold text-ink">{c(s.c7)}</span></span>
        <span>{t("30 days")} <span className="num font-semibold text-ink">{c(s.c30)}</span></span>
        <span>{s.todayStatus.attainment === null ? t("Today: off") : `${t("Today {pct}%", { pct: Math.round(s.todayStatus.attainment * 100) })}${s.todayStatus.reviewDone ? ` · ${t("reviewed")}` : ""}`}</span>
      </div>
    </section>
  );
}

export function NextBestActions() {
  const t = useT();
  const qa = useQuickAction();
  const crm = useCrm();
  const q = useQuery({ queryKey: ["nba"], queryFn: () => api<Nba[]>("/api/nba") });
  const [all, setAll] = React.useState(false);
  const phone = new Map((crm.data?.accounts ?? []).map((a) => [a.id, a.phone]));
  return (
    <Panel aria-labelledby="nba-title">
      <PanelTitle action={q.data && q.data.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>{all ? t("Show fewer") : t("See all {n}", { n: q.data.length })}</Button> : null}>
        <span id="nba-title">{t("Next best actions")}</span>
      </PanelTitle>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <p className="text-sm text-text-2">{t("Queue empty: no reply waiting, no follow-up due, no hot lead going cold.")}</p>
      ) : (
        <ol className="flex flex-col">
          {(all ? q.data : q.data.slice(0, 5)).map((i) => (
            <li key={i.accountId} className="flex items-center gap-2 border-t border-hairline py-2.5 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t(i.title)}</p>
                <p className="text-[13px] text-text-2"><span className="font-medium text-ink">{t(i.tierLabel)}.</span> {t(i.why)}</p>
              </div>
              {phone.get(i.accountId) ? <a href={`tel:${phone.get(i.accountId)}`} className="flex size-10 items-center justify-center rounded-full text-text-2 hover:bg-subtle" aria-label={t("Call")}><Phone className="size-4" /></a> : null}
              <Button size="sm" variant="outline" onClick={() => qa.open({ kind: i.tier === 5 ? "call" : "follow_up", accountId: i.accountId, opportunityId: i.opportunityId ?? undefined })}>{t("Log")}</Button>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[12px] text-text-3">{t("Order: replies waiting · overdue high-priority · due today · hot leads going cold · new targets in the sprint niche.")}</p>
    </Panel>
  );
}

/** Today's tasks for one area (sales, marketing, ops): open, mine, due today/overdue or undated P0. */
export function TasksFor({ area }: { area: Area }) {
  const tr = useT();
  const q = useTasks("mine");
  const [adding, setAdding] = React.useState(false);
  const today = new Date().toLocaleDateString("en-CA");
  const items = (q.data ?? []).filter((t) => t.area === area && (t.status === "todo" || t.status === "in_progress") && (!t.snoozed_until || t.snoozed_until <= today) && ((t.due_at && t.due_at <= today) || (!t.due_at && t.priority === "P0")));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-text-2">{tr("Tasks today")} <span className="num font-normal text-text-3">{items.length}</span></h3>
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>{tr("+ Task")}</Button>
      </div>
      {q.isPending ? <Skeleton className="h-16" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : items.length === 0 ? <p className="py-1 text-sm text-text-3">{tr("Nothing due.")}</p> : <ul>{items.slice(0, 5).map((t) => <TaskRowItem key={t.id} t={t} />)}</ul>}
      <NewTaskModal open={adding} onOpenChange={setAdding} defaults={{ area }} />
    </div>
  );
}

type Piece = { deliverable: string | null; brand: string | null; language: string | null };
type Week = {
  weekStart: string;
  items: (Piece & { key: string; label: string; done: number; target: number })[];
  todayPosts: (Piece & { key: string; label: string; done: boolean })[];
  calendar: { weekday: number; posts: string[] }[];
};
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Content plan (iteration 8): today's planned posts, the week's video goals (team) and the weekday calendar. One tap = one piece published. */
export function MarketingWeek() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["marketing-week"], queryFn: () => api<Week>("/api/marketing/week") });
  const log = useMutation({
    mutationFn: (p: Piece) => api("/api/marketing/week", { body: { idempotency_key: crypto.randomUUID(), deliverable: p.deliverable, brand: p.brand, language: p.language } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["marketing-week"] }); toast(t("Published · counted")); },
  });
  if (q.isPending) return <Skeleton className="h-28" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-1 text-[13px] font-semibold text-text-2">{t("Today's posts")}</h3>
        {d.todayPosts.length === 0 ? <p className="py-1 text-sm text-text-3">{t("No post planned today.")}</p> : (
          <ul className="flex flex-col">
            {d.todayPosts.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 border-t border-hairline py-1.5 text-sm first:border-t-0">
                <span className={cn(p.done && "text-text-3 line-through")}>{t(p.label)}</span>
                {p.deliverable ? (p.done ? <span className="text-[12px] text-text-3">{t("Published")}</span> : <button type="button" onClick={() => log.mutate(p)} disabled={log.isPending} className="h-8 rounded-full border border-control px-3 text-[12px] font-medium hover:bg-subtle disabled:opacity-50">{t("Mark as published")}</button>) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-text-2">{t("This week's videos (team)")}</h3>
        <ul className="flex flex-col gap-2">
          {d.items.map((i) => (
            <li key={i.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <p className="flex justify-between text-sm"><span>{t(i.label)}</span><span className={cn("num", i.done >= i.target ? "font-semibold text-ink" : "text-text-2")}>{i.done}/{i.target}</span></p>
                <div className="mt-1 flex gap-[3px]" aria-hidden>{Array.from({ length: Math.max(i.target, i.done) }, (_, k) => <span key={k} className={cn("h-2 flex-1 rounded-[2px]", k < i.done ? "bg-ink" : "hatch")} />)}</div>
              </div>
              <button type="button" onClick={() => log.mutate(i)} disabled={log.isPending} aria-label={t("Log one {what}", { what: t(i.label) })} className="h-9 rounded-full border border-control px-3 text-[13px] font-medium hover:bg-subtle disabled:opacity-50">+1</button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-text-3">{t("Produce in batches: one concept gives a Reel in French and one in Spanish.")}</p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-[13px] font-semibold text-text-2">{t("Publishing calendar")}</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {d.calendar.map((c) => <React.Fragment key={c.weekday}><dt className="text-text-3">{t(WEEKDAY_NAMES[c.weekday])}</dt><dd>{c.posts.map((p) => t(p)).join(" · ")}</dd></React.Fragment>)}
        </dl>
      </details>
    </div>
  );
}

export function NextMeetings() {
  const t = useT();
  const q = useAgenda();
  const next = (q.data?.events ?? []).filter((e) => e.kind !== "other_busy").slice(0, 2);
  if (!next.length) return null;
  return (
    <p className="text-[13px] text-text-2">
      {t("Next:")} {next.map((e, i) => <span key={e.id}>{i ? " · " : ""}<span className="font-medium text-ink">{t(e.title)}</span> {fmtDateTime(e.start)}</span>)} · <Link className="underline underline-offset-2" href="/agenda">{t("Agenda")}</Link>
    </p>
  );
}

export function CloseDayButton() {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const review = useQuery({ queryKey: ["review"], queryFn: () => api<{ review: { went_well: string; blockers: string; tomorrow_priority: string } | null }>("/api/review") });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{review.data?.review ? t("Edit day review") : t("Close my day")}</Button>
      <Modal open={open} onOpenChange={setOpen} title={t("End-of-day review")} description={t("Required to pass the day. Two minutes, then tomorrow starts with a priority.")}>
        {open ? <ReviewForm initial={review.data?.review ?? null} onDone={() => setOpen(false)} /> : null}
      </Modal>
    </>
  );
}
function ReviewForm({ initial, onDone }: { initial: { went_well: string; blockers: string; tomorrow_priority: string } | null; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState(initial ?? { went_well: "", blockers: "", tomorrow_priority: "" });
  const m = useMutation({ mutationFn: () => api("/api/review", { body: v }), onSuccess: () => { qc.invalidateQueries(); toast(t("Day review saved")); onDone(); } });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.tomorrow_priority.trim()) m.mutate(); }}>
      <Field label={t("What moved forward?")} htmlFor="rv-w"><Textarea id="rv-w" value={v.went_well} onChange={(e) => setV({ ...v, went_well: e.target.value })} /></Field>
      <Field label={t("What blocked you?")} htmlFor="rv-b"><Textarea id="rv-b" value={v.blockers} onChange={(e) => setV({ ...v, blockers: e.target.value })} /></Field>
      <Field label={t("Tomorrow's priority (required)")} htmlFor="rv-t"><Input id="rv-t" required value={v.tomorrow_priority} onChange={(e) => setV({ ...v, tomorrow_priority: e.target.value })} /></Field>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      <Button type="submit" variant="primary" disabled={!v.tomorrow_priority.trim() || m.isPending}>{m.isPending ? t("Saving…") : t("Save review")}</Button>
    </form>
  );
}

export function LateCorrections() {
  const t = useT();
  const q = useStreaks();
  const qc = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [date, setDate] = React.useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api("/api/streaks/correction", { body: { local_date: date, reason } }), onSuccess: () => { qc.invalidateQueries(); setDate(null); setReason(""); toast(t("Day recomputed with the late activity")); } });
  const days = q.data?.lateDaysToCorrect ?? [];
  if (!days.length) return null;
  return (
    <div className="rounded-[12px] bg-subtle p-3 text-sm">
      <p>{t("Activity was logged after the cutoff for {days}. A closed day changes only through a correction with a reason.", { days: days.map(fmtDay).join(", ") })}</p>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (date && reason.trim().length >= 5) m.mutate(); }}>
        <Select aria-label={t("Day")} value={date ?? ""} onChange={(e) => setDate(e.target.value || null)} className="h-9 w-40"><option value="">{t("Choose a day")}</option>{days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}</Select>
        <Input aria-label={t("Reason")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason (e.g. logged from the car after a visit)")} className="h-9 min-w-56 flex-1" />
        <Button type="submit" size="sm" variant="outline" disabled={!date || reason.trim().length < 5 || m.isPending}>{t("Apply correction")}</Button>
      </form>
      {m.isError ? <div className="mt-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
    </div>
  );
}

