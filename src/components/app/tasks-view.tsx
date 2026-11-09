"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Lock, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import { FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import { addDays, startOfWeek, weekday } from "@/domain/time";
import type { Recurrence } from "@/domain/tasks";
import { ApiError, api } from "@/lib/api";
import { useDateTag, useT } from "@/i18n/react";
import { cn } from "@/lib/utils";
import type { TaskRow } from "@/server/services/tasks";
import { Pill, fmtDay } from "./bits";
import { ConflictNotice } from "./conflict";
import { useMe } from "./providers";

type View = "mine" | "theo" | "pablo" | "unassigned" | "overdue" | "all";
export type Area = "sales" | "marketing" | "ops";
export const AREA_LABEL: Record<Area, string> = { sales: "Sales", marketing: "Marketing", ops: "Ops" };
const today = () => new Date().toLocaleDateString("en-CA");

/** Week order on screen: Monday first (L M M J V S D). Values are weekday numbers, 0 = Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
/** Localized weekday name; 2026-11-08 was a Sunday, so 8 + d lands on weekday d. */
const dayName = (tag: string, d: number, style: "short" | "long") => new Intl.DateTimeFormat(tag, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 8 + d)));

/** "repeats every Tuesday" / "repeats every Monday and Thursday", in the founder's language. */
export function useRecurrenceText() {
  const tr = useT();
  const tag = useDateTag();
  return React.useCallback((t: { recurrence: Recurrence; recurrence_days?: number[] | null }) => {
    if (t.recurrence === "none") return "";
    const days = t.recurrence === "weekly" ? WEEK_ORDER.filter((d) => (t.recurrence_days ?? []).includes(d)) : [];
    if (!days.length) return tr(`repeats ${t.recurrence}`);
    const names = days.map((d) => dayName(tag, d, "long"));
    return tr("repeats every {days}", { days: new Intl.ListFormat(tag, { type: "conjunction" }).format(names) });
  }, [tr, tag]);
}

/** Never / Every day / Weekdays / Every week on [L M M J V S D] / Every month. */
function RecurrencePicker({ id, value, days, due, onChange }: { id: string; value: Recurrence; days: number[]; due: string; onChange: (r: Recurrence, days: number[]) => void }) {
  const tr = useT();
  const tag = useDateTag();
  return (
    <div className="flex flex-col gap-2">
      <Field label={tr("Repeats")} htmlFor={id}>
        <Select id={id} value={value} onChange={(e) => { const r = e.target.value as Recurrence; onChange(r, r === "weekly" ? (days.length ? days : due ? [weekday(due)] : [1]) : []); }}>
          <option value="none">{tr("Never")}</option>
          <option value="daily">{tr("Every day")}</option>
          <option value="weekdays">{tr("Weekdays (Mon–Fri)")}</option>
          <option value="weekly">{tr("Every week on…")}</option>
          <option value="monthly">{tr("Every month")}</option>
        </Select>
      </Field>
      {value === "weekly" ? (
        <fieldset>
          <legend className="sr-only">{tr("Days of the week")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => (
              <label key={d} title={dayName(tag, d, "long")} className="flex h-9 min-w-11 cursor-pointer items-center justify-center rounded-full border border-control px-2.5 text-[13px] has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-panel has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink">
                <input type="checkbox" className="sr-only" aria-label={dayName(tag, d, "long")} checked={days.includes(d)} onChange={(e) => onChange("weekly", e.target.checked ? [...days, d].sort((a, b) => a - b) : days.filter((x) => x !== d))} />
                {dayName(tag, d, "short")}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-text-3">{days.length ? tr("A new task is created on the next chosen day when you complete this one.") : tr("No day chosen: same weekday as the due date.")}</p>
        </fieldset>
      ) : null}
    </div>
  );
}

export function useTasks(view: View) {
  return useQuery({ queryKey: ["tasks", view], queryFn: () => api<TaskRow[]>(`/api/tasks?view=${view}`) });
}

export function useToggleTask() {
  const qc = useQueryClient();
  const tr = useT();
  return useMutation({
    mutationFn: (t: TaskRow) => api("/api/tasks", { method: "PATCH", body: { id: t.id, private: t.private, expected_version: t.version, patch: { status: t.status === "done" ? "todo" : "done" } } }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(e instanceof ApiError && e.isConflict ? tr("Someone else just changed this task. Refreshed.") : (e as Error).message),
  });
}

/** Task row with a round check (DESIGN.md). The check persists the real status. */
export function TaskRowItem({ t, onOpen }: { t: TaskRow; onOpen?: () => void }) {
  const tr = useT();
  const repeats = useRecurrenceText();
  const toggle = useToggleTask();
  const done = t.status === "done";
  const pending = toggle.isPending;
  const overdue = !done && t.due_at && t.due_at < today();
  return (
    <li className="flex items-center gap-2 border-t border-hairline py-1.5 first:border-t-0">
      <button type="button" role="checkbox" aria-checked={done} aria-label={tr(done ? "Reopen {title}" : "Complete {title}", { title: t.title })} disabled={pending} onClick={() => toggle.mutate(t)}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-control hover:text-ink disabled:opacity-60">
        {done ? <span className="flex size-6 items-center justify-center rounded-full bg-ink text-panel"><Check className="size-4" /></span> : pending ? <Circle className="size-6 animate-pulse" strokeWidth={2.5} /> : <Circle className="size-6" strokeWidth={1.5} />}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className={cn("truncate font-medium", done && "text-text-3 line-through")}>{t.private ? <Lock className="mr-1 inline size-3.5" aria-label={tr("Private")} /> : null}{t.title}</p>
        <p className="flex flex-wrap gap-x-2 text-[12px] text-text-2">
          <span className={cn(t.priority === "P0" && "font-semibold text-ink")}>{t.priority}</span>
          {t.due_at ? <span className={cn(overdue && "font-medium text-bad")}>{overdue ? `${tr("Overdue")} · ` : ""}{fmtDay(t.due_at)}</span> : null}
          <span>{t.owner ? FOUNDER_NAMES[t.owner] : tr("Unassigned")}</span>
          <span className="rounded-full bg-subtle px-1.5">{tr(AREA_LABEL[t.area])}</span>
          {t.recurrence !== "none" ? <span>{repeats(t)}</span> : null}
          {t.snoozed_until && t.snoozed_until > today() ? <span>{tr("snoozed to {date}", { date: fmtDay(t.snoozed_until) })}</span> : null}
        </p>
      </button>
    </li>
  );
}

export function TasksView() {
  const tr = useT();
  const me = useMe();
  const [view, setView] = React.useState<View>("mine");
  const [display, setDisplay] = React.useState<"list" | "board" | "week">("list");
  const [area, setArea] = React.useState<Area | "all">("all");
  const [creating, setCreating] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const q0 = useTasks(view);
  const q = { ...q0, data: q0.data?.filter((t) => area === "all" || t.area === area) } as typeof q0;
  const opened = q0.data?.find((t) => t.id === openId) ?? null;
  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tr("Tasks")}</h1>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus /> {tr("New task")}</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="overflow-x-auto"><SegmentedSwitch size="sm" label={tr("View")} value={view} onChange={setView} options={[{ value: "mine", label: tr("My tasks") }, { value: me.founder === "theo" ? "pablo" : "theo", label: tr("Assigned to {name}", { name: FOUNDER_NAMES[me.founder === "theo" ? "pablo" : "theo"] }) }, { value: "unassigned", label: tr("Unassigned") }, { value: "overdue", label: tr("Overdue") }, { value: "all", label: tr("All") }]} /></div>
          <SegmentedSwitch size="sm" label={tr("Area")} value={area} onChange={setArea} options={[{ value: "all", label: tr("All areas") }, { value: "sales", label: tr("Sales") }, { value: "marketing", label: tr("Marketing") }, { value: "ops", label: tr("Ops") }]} />
          <SegmentedSwitch size="sm" label={tr("Display")} value={display} onChange={setDisplay} options={[{ value: "list", label: tr("List") }, { value: "board", label: tr("Board") }, { value: "week", label: tr("Week") }]} />
        </div>
        {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
          <EmptyState title={tr("No tasks here")} action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}>{tr("Add a task")}</Button>} />
        ) : display === "list" ? (
          <Panel className="py-2"><ul>{q.data.map((t) => <TaskRowItem key={t.id} t={t} onOpen={() => setOpenId(t.id)} />)}</ul></Panel>
        ) : display === "board" ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><div className="grid min-w-[760px] grid-cols-3 gap-3">
            {(["todo", "in_progress", "done"] as const).map((st) => (
              <section key={st} aria-label={tr({ todo: "To do", in_progress: "In progress", done: "Done" }[st])} className="rounded-[20px] bg-subtle/60 p-2">
                <h2 className="px-2 py-1 text-[13px] font-semibold">{tr({ todo: "To do", in_progress: "In progress", done: "Done" }[st])} <span className="num font-normal text-text-3">{q.data.filter((t) => t.status === st).length}</span></h2>
                <ul className="rounded-[12px] bg-panel px-2">{q.data.filter((t) => t.status === st).map((t) => <TaskRowItem key={t.id} t={t} onOpen={() => setOpenId(t.id)} />)}</ul>
              </section>
            ))}
          </div></div>
        ) : (
          <WeekGrid tasks={q.data} onOpen={setOpenId} />
        )}
      </div>
      {opened ? <TaskPanel key={opened.id + opened.version} t={opened} onClose={() => setOpenId(null)} /> : null}
      <NewTaskModal open={creating} onOpenChange={setCreating} defaults={{ area: area === "all" ? undefined : area }} />
    </div>
  );
}

function WeekGrid({ tasks, onOpen }: { tasks: TaskRow[]; onOpen: (id: string) => void }) {
  const start = startOfWeek(today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><div className="grid min-w-[900px] grid-cols-7 gap-2">
      {days.map((d) => (
        <section key={d} aria-label={d} className={cn("min-h-40 rounded-[12px] bg-panel p-2", d === today() && "ring-2 ring-ink")}>
          <h2 className="mb-1 text-[12px] font-semibold text-text-2">{fmtDay(d)}</h2>
          <ul className="flex flex-col gap-1">{tasks.filter((t) => t.due_at === d).map((t) => <li key={t.id}><button type="button" onClick={() => onOpen(t.id)} className={cn("w-full rounded-[8px] bg-subtle px-2 py-1 text-left text-[12px]", t.status === "done" && "text-text-3 line-through")}>{t.priority} · {t.title}</button></li>)}</ul>
        </section>
      ))}
    </div></div>
  );
}

function TaskPanel({ t, onClose }: { t: TaskRow; onClose: () => void }) {
  const tr = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState({ title: t.title, description: t.description, owner: t.owner ?? "", priority: t.priority, due_at: t.due_at ?? "", status: t.status, completion_evidence: t.completion_evidence, area: t.area, recurrence: t.recurrence, recurrence_days: t.recurrence_days ?? [] });
  const [snooze, setSnooze] = React.useState({ until: "", reason: "" });
  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api("/api/tasks", { method: "PATCH", body: { id: t.id, private: t.private, expected_version: t.version, patch } }),
    onSuccess: () => { qc.invalidateQueries(); toast(tr("Saved")); },
  });
  const comments = useQuery({ queryKey: ["task-comments", t.id], queryFn: () => api<{ id: string; author: string; body: string; created_at: string }[]>(`/api/tasks/comments?task_id=${t.id}`), enabled: !t.private });
  const [body, setBody] = React.useState("");
  const [cid, setCid] = React.useState(() => crypto.randomUUID());
  const addC = useMutation({ mutationFn: () => api("/api/tasks/comments", { body: { id: cid, task_id: t.id, body } }), onSuccess: () => { setBody(""); setCid(crypto.randomUUID()); qc.invalidateQueries({ queryKey: ["task-comments", t.id] }); } });
  const err = save.error instanceof ApiError ? save.error : null;
  return (
    <DetailPanel open onClose={onClose} title={<div><h2 className="text-lg font-semibold">{t.private ? tr("Private task") : tr("Task")}</h2><p className="text-[13px] text-text-2">{tr("Created by {name}", { name: FOUNDER_NAMES[t.created_by_founder as "theo"] })} · {t.source !== "manual" ? tr(`from ${t.source.replace("_", " ")}`) : tr("manual")}</p></div>}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...v, owner: v.owner || null }); }}>
        <Field label={tr("Title")} htmlFor="tk-title"><Input id="tk-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("Owner")} htmlFor="tk-owner"><Select id="tk-owner" disabled={t.private} value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })}><option value="">{tr("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
          <Field label={tr("Priority")} htmlFor="tk-pr"><Select id="tk-pr" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as "P0" })}>{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label={tr("Due")} htmlFor="tk-due"><Input id="tk-due" type="date" value={v.due_at} onChange={(e) => setV({ ...v, due_at: e.target.value })} /></Field>
          <Field label={tr("Area")} htmlFor="tk-area"><Select id="tk-area" value={v.area} onChange={(e) => setV({ ...v, area: e.target.value as Area })}><option value="sales">{tr("Sales")}</option><option value="marketing">{tr("Marketing")}</option><option value="ops">{tr("Ops")}</option></Select></Field>
          <Field label={tr("Status")} htmlFor="tk-st"><Select id="tk-st" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as "todo" })}><option value="todo">{tr("To do")}</option><option value="in_progress">{tr("In progress")}</option><option value="done">{tr("Done")}</option><option value="cancelled">{tr("Cancelled")}</option></Select></Field>
        </div>
        <RecurrencePicker id="tk-rec" value={v.recurrence} days={v.recurrence_days} due={v.due_at} onChange={(recurrence, recurrence_days) => setV({ ...v, recurrence, recurrence_days })} />
        <Field label={tr("Description")} htmlFor="tk-desc"><Textarea id="tk-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        {v.status === "done" ? <Field label={tr("Completion evidence (optional)")} htmlFor="tk-ev"><Input id="tk-ev" value={v.completion_evidence} onChange={(e) => setV({ ...v, completion_evidence: e.target.value })} placeholder={tr("Link or short note")} /></Field> : null}
        {err?.isConflict ? <ConflictNotice mine={v} current={err.body.current} fields={["title", "owner", "priority", "due_at", "status"]} onKeepTheirs={() => qc.invalidateQueries()} onApplyMine={() => qc.invalidateQueries()} /> : save.isError ? <ErrorState error={save.error} onRetry={() => save.mutate({ ...v, owner: v.owner || null })} /> : null}
        <Button type="submit" variant="primary" className="self-start" disabled={save.isPending}>{save.isPending ? tr("Saving…") : tr("Save")}</Button>
      </form>
      <section className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4">
        <h3 className="text-sm font-semibold">{tr("Snooze")}</h3>
        <div className="flex flex-wrap gap-2">
          <Input aria-label={tr("Snooze until")} type="date" value={snooze.until} onChange={(e) => setSnooze({ ...snooze, until: e.target.value })} className="w-40" />
          <Input aria-label={tr("Reason")} placeholder={tr("Reason (required)")} value={snooze.reason} onChange={(e) => setSnooze({ ...snooze, reason: e.target.value })} className="min-w-40 flex-1" />
          <Button size="md" variant="outline" disabled={!snooze.until || !snooze.reason.trim() || save.isPending} onClick={() => save.mutate({ snoozed_until: snooze.until, snooze_reason: snooze.reason })}>{tr("Snooze")}</Button>
        </div>
      </section>
      {!t.private ? (
        <section className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4">
          <h3 className="text-sm font-semibold">{tr("Comments")}</h3>
          {comments.data?.length ? <ul className="flex flex-col gap-2">{comments.data.map((c) => <li key={c.id} className="text-sm"><span className="font-medium">{FOUNDER_NAMES[c.author as "theo"]}</span> <span className="text-[12px] text-text-3">{c.created_at.slice(0, 16).replace("T", " ")}</span><p>{c.body}</p></li>)}</ul> : <p className="text-sm text-text-2">{tr("No comments.")}</p>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) addC.mutate(); }}>
            <Input aria-label={tr("Comment")} value={body} onChange={(e) => setBody(e.target.value)} placeholder={tr("Add a comment")} />
            <Button type="submit" variant="outline" disabled={!body.trim() || addC.isPending}>{tr("Send")}</Button>
          </form>
        </section>
      ) : <p className="mt-6 text-[13px] text-text-2">{tr("Private tasks live in your own spreadsheet and are never visible to your co-founder.")}</p>}
    </DetailPanel>
  );
}

export function NewTaskModal({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; defaults?: { account_id?: string; title?: string; area?: Area; recurrence?: Recurrence; recurrence_days?: number[] } }) {
  const tr = useT();
  const qc = useQueryClient();
  const me = useMe();
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const blank = { title: defaults?.title ?? "", owner: me.founder as string, priority: "P2", due_at: today(), recurrence: (defaults?.recurrence ?? "none") as Recurrence, recurrence_days: defaults?.recurrence_days ?? (defaults?.recurrence === "weekly" ? [weekday(today())] : []), private: false, area: (defaults?.area ?? "sales") as Area };
  const [v, setV] = React.useState(blank);
  const m = useMutation({
    mutationFn: () => api("/api/tasks", { body: { id, task: { ...v, owner: v.owner || null, account_id: defaults?.account_id ?? "" } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(tr("Saved")); setId(crypto.randomUUID()); setV(blank); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={tr("New task")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.title.trim()) m.mutate(); }}>
        <Field label={tr("Title")} htmlFor="nt-title"><Input id="nt-title" autoFocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("Owner")} htmlFor="nt-owner"><Select id="nt-owner" value={v.owner} disabled={v.private} onChange={(e) => setV({ ...v, owner: e.target.value })}><option value="">{tr("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
          <Field label={tr("Priority")} htmlFor="nt-pr"><Select id="nt-pr" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label={tr("Due")} htmlFor="nt-due"><Input id="nt-due" type="date" value={v.due_at} onChange={(e) => setV({ ...v, due_at: e.target.value })} /></Field>
          <Field label={tr("Area")} htmlFor="nt-area"><Select id="nt-area" value={v.area} onChange={(e) => setV({ ...v, area: e.target.value as Area })}><option value="sales">{tr("Sales")}</option><option value="marketing">{tr("Marketing")}</option><option value="ops">{tr("Ops")}</option></Select></Field>
        </div>
        <RecurrencePicker id="nt-rec" value={v.recurrence} days={v.recurrence_days} due={v.due_at} onChange={(recurrence, recurrence_days) => setV({ ...v, recurrence, recurrence_days })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={v.private} onChange={(e) => setV({ ...v, private: e.target.checked, owner: e.target.checked ? me.founder : v.owner })} /> {tr("Private (only you, stored in your own spreadsheet)")}</label>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending || !v.title.trim()}>{m.isPending ? tr("Saving…") : tr("Add task")}</Button>
      </form>
    </Modal>
  );
}

export { Pill };
