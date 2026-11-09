"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import { FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgendaEvent } from "@/server/services/agenda";
import { Pill, fmtDateTime } from "./bits";
import { CallbacksList } from "./callbacks";

type Agenda = { available: boolean; events: AgendaEvent[]; error: string | null };
type Item = { id: string; version: number; kind: "agenda" | "decision" | "action"; text: string; done: boolean; owner: string | null; task_id: string };
type Point = { id: string; version: number; title: string; type: string; duration_min: number; status: string; start_at: string | null; notes: string; items: Item[] };

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const dayLabel = (iso: string, tag: string) => new Date(iso).toLocaleDateString(tag, { weekday: "long", day: "2-digit", month: "short" });
const time = (iso: string, tag: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });

export function useAgenda() {
  return useQuery({ queryKey: ["agenda"], queryFn: () => api<Agenda>("/api/agenda") });
}

export function AgendaView() {
  const t = useT();
  const q = useAgenda();
  const [display, setDisplay] = React.useState<"list" | "week">("list");
  const [scheduling, setScheduling] = React.useState(false);
  const [openPoint, setOpenPoint] = React.useState<string | null>(null);
  const points = useQuery({ queryKey: ["points"], queryFn: () => api<Point[]>("/api/points") });
  const opened = points.data?.find((p) => p.id === openPoint) ?? null;
  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Agenda")}</h1>
            <p className="text-sm text-text-2">{t("Next 14 days from the shared Valemont calendar and your calendars. Your co-founder's personal events show only as Busy.")}</p>
          </div>
          <div className="flex gap-2">
            <SegmentedSwitch size="sm" label={t("Display")} value={display} onChange={setDisplay} options={[{ value: "list", label: t("List") }, { value: "week", label: t("Week") }]} />
            <Button variant="primary" onClick={() => setScheduling(true)}>{t("Schedule founder point")}</Button>
          </div>
        </div>
        {q.isPending ? <Skeleton className="h-72" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.available ? (
          <EmptyState title={t("No calendar connected")} action={<Button asChild size="sm" variant="outline"><Link href="/settings">{t("Settings › Calendars")}</Link></Button>}>{t("Share the Valemont calendar and your own calendar with the service account, then add their ids.")}</EmptyState>
        ) : q.data.error ? <ErrorState error={new Error(`Google Calendar: ${q.data.error}`)} onRetry={() => q.refetch()} /> : display === "list" ? (
          <EventList events={q.data.events} onPoint={setOpenPoint} />
        ) : <WeekView events={q.data.events} onPoint={setOpenPoint} />}

        <CallbacksList max={12} />
        <Panel aria-labelledby="fp">
          <PanelTitle><span id="fp">{t("Founder points")}</span></PanelTitle>
          {points.isPending ? <Skeleton className="h-24" /> : points.isError ? <ErrorState error={points.error} onRetry={() => points.refetch()} /> : points.data.length === 0 ? <p className="text-sm text-text-2">{t("No founder point yet. Schedule one: three slots free for both of you are proposed.")}</p> : (
            <ul className="flex flex-col">
              {points.data.slice(0, 8).map((p) => (
                <li key={p.id} className="border-t border-hairline first:border-t-0">
                  <button type="button" onClick={() => setOpenPoint(p.id)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-subtle/50">
                    <span><span className="font-medium">{p.title}</span><span className="block text-[13px] text-text-2">{p.start_at ? fmtDateTime(p.start_at) : t("no time")} · {t("{n} min", { n: p.duration_min })}</span></span>
                    <StatusPill s={p.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {opened ? <PointPanel key={opened.id + opened.version + opened.items.length} p={opened} onClose={() => setOpenPoint(null)} /> : null}
      <ScheduleModal open={scheduling} onOpenChange={setScheduling} onDone={(id) => { setScheduling(false); setOpenPoint(id); }} />
    </div>
  );
}

function StatusPill({ s }: { s: string }) {
  const tr = useT();
  const map: Record<string, [string, "neutral" | "bad" | "good" | "dark"]> = { scheduled: ["Scheduled", "neutral"], done: ["Done", "good"], cancelled: ["Cancelled", "neutral"], moved_in_calendar: ["Moved in Calendar", "neutral"], deleted_in_calendar: ["Deleted in Calendar", "bad"] };
  const [l, t] = map[s] ?? [s, "neutral"];
  return <Pill tone={t}>{tr(l)}</Pill>;
}

function EventList({ events, onPoint }: { events: AgendaEvent[]; onPoint: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  if (!events.length) return <Panel><p className="text-sm text-text-2">{t("Nothing scheduled in the next 14 days.")}</p></Panel>;
  const groups = new Map<string, AgendaEvent[]>();
  for (const e of events) groups.set(dayKey(e.start), [...(groups.get(dayKey(e.start)) ?? []), e]);
  return (
    <Panel className="flex flex-col gap-4">
      {[...groups.entries()].map(([d, evs]) => (
        <section key={d}>
          <h2 className="mb-1 text-[13px] font-semibold text-text-2">{dayLabel(evs[0].start, tag)}</h2>
          <ul>{evs.map((e) => <EventRow key={e.id} e={e} onPoint={onPoint} />)}</ul>
        </section>
      ))}
    </Panel>
  );
}

function EventRow({ e, onPoint }: { e: AgendaEvent; onPoint: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const busy = e.kind === "other_busy";
  return (
    <li className="grid grid-cols-[96px_1fr] gap-3 border-t border-hairline py-2 first:border-t-0 text-sm">
      <span className="num text-text-2">{time(e.start, tag)}–{time(e.end, tag)}</span>
      <span className={cn("min-w-0", busy && "text-text-3")}>
        {e.pointId ? <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onPoint(e.pointId!)}>{t(e.title)}</button> : <span className="font-medium">{t(e.title)}</span>}
        <span className="ml-2 text-[12px] text-text-3">{e.kind === "shared" ? "Valemont" : e.kind === "own" ? t("your calendar") : `${FOUNDER_NAMES[e.owner as "theo"] ?? t("co-founder")}`}</span>
      </span>
    </li>
  );
}

function WeekView({ events, onPoint }: { events: AgendaEvent[]; onPoint: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const [start] = React.useState(() => Date.now());
  const days = Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toLocaleDateString("en-CA"));
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"><div className="grid min-w-[900px] grid-cols-7 gap-2">
      {days.map((d) => (
        <section key={d} aria-label={d} className="min-h-48 rounded-[12px] bg-panel p-2">
          <h2 className="mb-1 text-[12px] font-semibold text-text-2">{new Date(d + "T12:00:00").toLocaleDateString(tag, { weekday: "short", day: "2-digit" })}</h2>
          <ul className="flex flex-col gap-1">
            {events.filter((e) => dayKey(e.start) === d).map((e) => (
              <li key={e.id}><button type="button" disabled={!e.pointId} onClick={() => e.pointId && onPoint(e.pointId)} className={cn("w-full rounded-[8px] px-2 py-1 text-left text-[12px]", e.kind === "other_busy" ? "bg-subtle text-text-3" : e.kind === "shared" ? "bg-ink text-panel" : "bg-subtle")}>
                <span className="num">{time(e.start, tag)}</span> {t(e.title)}
              </button></li>
            ))}
          </ul>
        </section>
      ))}
    </div></div>
  );
}

function ScheduleModal({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => void }) {
  const t = useT();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("Schedule a founder point")} description={t("Written to the shared Valemont calendar, so it appears in both your Google Calendars.")}>
      {open ? <ScheduleForm onDone={onDone} /> : null}
    </Modal>
  );
}
function ScheduleForm({ onDone }: { onDone: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const qc = useQueryClient();
  const [id] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ title: t("Weekly review"), type: "weekly_review", duration_min: 30, agenda: "" });
  const slots = useQuery({ queryKey: ["slots", v.duration_min], queryFn: () => api<{ start: string; end: string }[]>(`/api/points/slots?duration_min=${v.duration_min}`) });
  const [pick, setPick] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<{ pointId: string }>("/api/points", { body: { id, title: v.title, type: v.type, duration_min: v.duration_min, start: pick, recurrence: null, agenda: v.agenda.split("\n").map((x) => x.trim()).filter(Boolean) } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Added to the Valemont calendar")); onDone(id); },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (pick) m.mutate(); }}>
      <Field label={t("Title")} htmlFor="fp-title"><Input id="fp-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Type")} htmlFor="fp-type"><Select id="fp-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}><option value="daily">{t("Daily check-in")}</option><option value="weekly_review">{t("Weekly review")}</option><option value="decision">{t("Decision")}</option><option value="ad_hoc">{t("Ad hoc")}</option></Select></Field>
        <Field label={t("Duration")} htmlFor="fp-dur"><Select id="fp-dur" value={String(v.duration_min)} onChange={(e) => { setV({ ...v, duration_min: Number(e.target.value) }); setPick(null); }}>{[15, 30, 45, 60].map((n) => <option key={n} value={n}>{t("{n} min", { n })}</option>)}</Select></Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium text-text-2">{t("Free for both of you")}</legend>
        {slots.isPending ? <Skeleton className="h-24" /> : slots.isError ? <ErrorState error={slots.error} onRetry={() => slots.refetch()} /> : slots.data.length === 0 ? <p className="text-sm text-text-2">{t("No common free slot in the next 7 days inside your declared availability (Settings › Profile).")}</p> : slots.data.map((s) => (
          <label key={s.start} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] border px-3 text-sm", pick === s.start ? "border-ink" : "border-hairline")}>
            <input type="radio" name="slot" className="size-4" checked={pick === s.start} onChange={() => setPick(s.start)} /> <span className="num">{fmtDateTime(s.start)}–{time(s.end, tag)}</span>
          </label>
        ))}
      </fieldset>
      <Field label={t("Agenda (one item per line, optional)")} htmlFor="fp-ag"><Textarea id="fp-ag" value={v.agenda} onChange={(e) => setV({ ...v, agenda: e.target.value })} /></Field>
      <p className="text-[12px] text-text-3">{t("Ideas marked Discuss are added to the agenda automatically.")}</p>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      <Button type="submit" variant="primary" disabled={!pick || m.isPending}>{m.isPending ? t("Saving…") : t("Add to calendar")}</Button>
    </form>
  );
}

function PointPanel({ p, onClose }: { p: Point; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [notes, setNotes] = React.useState(p.notes);
  const [kind, setKind] = React.useState<"decision" | "action" | "agenda">("decision");
  const [text, setText] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [itemId, setItemId] = React.useState(() => crypto.randomUUID());
  const addItem = useMutation({ mutationFn: () => api<{ taskId?: string }>("/api/points/items", { body: { id: itemId, point_id: p.id, kind, text, owner: owner || null } }), onSuccess: (r) => { setText(""); setItemId(crypto.randomUUID()); qc.invalidateQueries(); if (r.taskId) toast(t("Task created")); } });
  const toggle = useMutation({ mutationFn: (i: Item) => api("/api/points/items", { method: "PATCH", body: { id: i.id, expected_version: i.version, done: !i.done } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["points"] }) });
  const update = useMutation({ mutationFn: (patch: Record<string, unknown>) => api("/api/points", { method: "PATCH", body: { id: p.id, expected_version: p.version, ...patch } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["points"] }); toast(t("Saved")); } });
  const section = (k: Item["kind"], title: string) => {
    const items = p.items.filter((i) => i.kind === k);
    return (
      <section>
        <h3 className="mb-1 text-sm font-semibold">{title}</h3>
        {items.length === 0 ? <p className="text-sm text-text-3">{t("None yet.")}</p> : (
          <ul>{items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-1 text-sm">
              {k === "agenda" ? <button type="button" role="checkbox" aria-checked={i.done} aria-label={i.text} onClick={() => toggle.mutate(i)} className="flex size-9 items-center justify-center text-control hover:text-ink">{i.done ? <span className="flex size-5 items-center justify-center rounded-full bg-ink text-panel"><Check className="size-3.5" /></span> : <Circle className="size-5" strokeWidth={1.5} />}</button> : <span className="size-1.5 rounded-full bg-ink" />}
              <span className={cn(i.done && "text-text-3 line-through")}>{i.text}{i.owner ? <span className="text-text-3"> · {FOUNDER_NAMES[i.owner as "theo"]}</span> : null}{i.task_id ? <span className="text-text-3"> · {t("task created")}</span> : null}</span>
            </li>
          ))}</ul>
        )}
      </section>
    );
  };
  return (
    <DetailPanel open onClose={onClose} title={<div><h2 className="text-lg font-semibold">{p.title}</h2><p className="text-[13px] text-text-2">{p.start_at ? fmtDateTime(p.start_at) : ""} · {t("{n} min", { n: p.duration_min })} · <StatusPill s={p.status} /></p></div>}
      footer={p.status !== "done" ? <Button variant="outline" onClick={() => update.mutate({ status: "done", notes })}>{t("Mark done")}</Button> : null}>
      <div className="flex flex-col gap-5">
        {p.status === "moved_in_calendar" ? <p className="rounded-[12px] bg-subtle p-3 text-sm">{t("Moved directly in Google Calendar; the new time is shown.")}</p> : null}
        {p.status === "deleted_in_calendar" ? <p className="rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad">{t("Deleted in Google Calendar. Schedule a new one if needed.")}</p> : null}
        {section("agenda", t("Agenda"))}
        {section("decision", t("Decisions"))}
        {section("action", t("Action items"))}
        <form className="flex flex-col gap-2 rounded-[12px] border border-hairline p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) addItem.mutate(); }}>
          <SegmentedSwitch size="sm" label={t("Add")} value={kind} onChange={setKind} options={[{ value: "decision", label: t("Decision") }, { value: "action", label: t("Action → task") }, { value: "agenda", label: t("Agenda item") }]} />
          <Input aria-label={t("Text")} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "decision" ? t("What did you decide?") : kind === "action" ? t("What needs doing?") : t("Topic")} />
          {kind === "action" ? <Select aria-label={t("Owner")} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{t("Owner…")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select> : null}
          {addItem.isError ? <ErrorState error={addItem.error} onRetry={() => addItem.mutate()} /> : null}
          <Button type="submit" size="sm" variant="primary" className="self-start" disabled={!text.trim() || (kind === "action" && !owner) || addItem.isPending}>{t("Add")}</Button>
        </form>
        <Field label={t("Notes")} htmlFor="fp-notes"><Textarea id="fp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== p.notes && update.mutate({ notes })} /></Field>
      </div>
    </DetailPanel>
  );
}
