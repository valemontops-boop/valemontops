"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useDateTag, useT } from "@/i18n/react";
import { addDays, startOfWeek } from "@/domain/time";
import {
  CHECKPOINTS, CONTENT_FORMATS, FORMAT_LABELS, PIECE_STAGES, PRODUCTION_STAGES, STAGE_LABELS, monthGrid, neighbourStage, nextProductionStage, recommendedSlots,
  type ChecklistItem, type PieceStage,
} from "@/domain/content-studio";
import type { Studio } from "@/server/services/content-studio";
import { fmtDateTime, fmtDay } from "./bits";
import { CsvExportButton, CsvImportButton } from "./csv-tools";
import { BrandTag, Composer, NewPost, ScoreBadge, useSaveHandlers, versionLabel, type Piece } from "./content-composer";

/**
 * Content Studio (Stage 3 marketing, D079; founder request round 11, D081): board idea → draft → ready → scheduled →
 * published with filters and drag / keyboard moves, week and month planning with recommended slots and conflicts, the
 * composer (content-composer.tsx: versions per account, Drive media, live optimizer score), batch production, results
 * (views → leads) and the editable publishing checklist. <ContentStudioCard/> is the Growth › Content summary.
 */
type Section = "board" | "planning" | "batch" | "results" | "checklist";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isPublished = (v: Piece["variants"][number]) => v.status === "published";

function useStudio(week: string | null) {
  return useQuery({ queryKey: ["content-studio", week], queryFn: () => api<Studio>(`/api/content${week ? `?week=${week}` : ""}`) });
}

type Filters = { account: string; brand: string; language: string; type: string };
const NO_FILTER: Filters = { account: "", brand: "", language: "", type: "" };
function matches(p: Piece, f: Filters) {
  if (f.type && p.format !== f.type) return false;
  if (f.brand && (f.brand === "personal" ? p.brand !== null : p.brand !== f.brand)) return false;
  if (f.account && !p.variants.some((v) => v.account_id === f.account)) return false;
  if (f.language && !p.variants.some((v) => v.language === f.language)) return false;
  return true;
}

export function ContentStudio() {
  const t = useT();
  const [week, setWeek] = React.useState<string | null>(null);
  const [section, setSection] = React.useState<Section>("board");
  const [openId, setOpenId] = React.useState<{ piece: string; version?: string | null } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [filters, setFilters] = React.useState<Filters>(NO_FILTER);
  const q = useStudio(week);
  const qc = useQueryClient();
  const d = q.data;
  const open = openId ? d?.pieces.find((p) => p.id === openId.piece) ?? null : null;
  React.useEffect(() => {
    const onArchived = () => { qc.invalidateQueries({ queryKey: ["content-studio"] }); };
    window.addEventListener("content-archived", onArchived);
    return () => window.removeEventListener("content-archived", onArchived);
  }, [qc]);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-text-3"><Link href="/marketing" className="underline underline-offset-2">{t("Growth")}</Link></p>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Content Studio")}</h1>
          <p className="text-sm text-text-2">{t("Ideas, posts per account, planning and an optimizer score, from the idea to the numbers.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvImportButton kind="content_ideas" />
          <CsvExportButton list="content" />
          <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" />{t("New content")}</Button>
        </div>
      </div>
      {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <Targets studio={q.data} />
          <div className="-mx-1 overflow-x-auto px-1 [&_button]:whitespace-nowrap">
            <SegmentedSwitch label={t("Section")} value={section} onChange={setSection} options={[
              { value: "board", label: t("Board") }, { value: "planning", label: t("Planning") }, { value: "batch", label: t("Batch production") },
              { value: "results", label: t("Results") }, { value: "checklist", label: t("Checklists") },
            ]} />
          </div>
          {section === "board" || section === "planning" ? <FilterBar studio={q.data} value={filters} onChange={setFilters} /> : null}
          {section === "board" ? <Board studio={q.data} filters={filters} onOpen={(piece) => setOpenId({ piece })} onCreate={() => setCreating(true)} />
            : section === "planning" ? <Planning studio={q.data} filters={filters} onOpen={(piece, version) => setOpenId({ piece, version })} week={q.data.week} setWeek={setWeek} />
            : section === "batch" ? <BatchView studio={q.data} onOpen={(piece) => setOpenId({ piece })} />
            : section === "results" ? <ResultsView studio={q.data} onOpen={(piece) => setOpenId({ piece })} week={q.data.week} setWeek={setWeek} />
            : <ChecklistEditor studio={q.data} />}
        </>
      )}
      {open && d ? <Composer key={open.id} piece={open} studio={d} focus={openId?.version} onClose={() => setOpenId(null)} /> : null}
      {d ? <NewPost open={creating} onOpenChange={setCreating} accounts={d.accounts} defaultBrand={filters.brand || "consulting"} onCreated={(id) => { setCreating(false); setOpenId({ piece: id }); }} /> : null}
    </div>
  );
}

/* ---------- weekly targets + capture status ---------- */

function Targets({ studio }: { studio: Studio }) {
  const t = useT();
  const s = studio.snapshot;
  return (
    <Panel>
      <PanelTitle>{t("This week's videos (team)")}</PanelTitle>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {studio.targets.map((i) => (
          <li key={i.key} className="min-w-0">
            <p className="flex justify-between gap-2 text-sm"><span className="truncate">{t(i.label)}</span><span className={cn("num", i.done >= i.target ? "font-semibold text-ink" : "text-text-2")}>{i.done}/{i.target}</span></p>
            <div className="mt-1 flex gap-[3px]" aria-hidden>{Array.from({ length: Math.max(i.target, i.done) }, (_, k) => <span key={k} className={cn("h-2 flex-1 rounded-[2px]", k < i.done ? "bg-ink" : "hatch")} />)}</div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-text-3">
        {s.capability === "connected"
          ? t("Instagram connected (read-only): numbers captured every 6 hours. Last capture: {when}.", { when: s.lastSuccessAt ? fmtDateTime(s.lastSuccessAt) : t("not yet") })
          : t("Instagram not connected: enter the numbers of each post by hand (marked “entered by hand”).")}
        {s.lastError ? <span className="text-bad"> · {t("Last capture failed")}</span> : null}
        {s.accounts.filter((a) => a.daysLeft !== null && a.daysLeft < 15).map((a) => <span key={a.key} className="text-bad"> · {t("Instagram token expires in {d} days", { d: a.daysLeft })}</span>)}
      </p>
    </Panel>
  );
}

/* ---------- filters ---------- */

function FilterBar({ studio, value, onChange }: { studio: Studio; value: Filters; onChange: (f: Filters) => void }) {
  const t = useT();
  const on = Object.values(value).some(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("Filters")}>
      <Select aria-label={t("Account")} className="h-9 w-auto min-w-40" value={value.account} onChange={(e) => onChange({ ...value, account: e.target.value })}>
        <option value="">{t("All accounts")}</option>{studio.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </Select>
      <Select aria-label={t("Brand")} className="h-9 w-auto" value={value.brand} onChange={(e) => onChange({ ...value, brand: e.target.value })}>
        <option value="">{t("All brands")}</option><option value="consulting">Valemont</option><option value="thirty">30/30 AI</option><option value="personal">{t("Personal")}</option>
      </Select>
      <Select aria-label={t("Language")} className="h-9 w-auto" value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
        <option value="">{t("All languages")}</option><option value="FR">FR</option><option value="ES">ES</option>
      </Select>
      <Select aria-label={t("Type")} className="h-9 w-auto" value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })}>
        <option value="">{t("All types")}</option>{CONTENT_FORMATS.map((f) => <option key={f} value={f}>{t(FORMAT_LABELS[f])}</option>)}
      </Select>
      {on ? <Button size="sm" variant="ghost" onClick={() => onChange(NO_FILTER)}>{t("Clear filters")}</Button> : null}
    </div>
  );
}

/* ---------- board (Kanban) ---------- */

function PieceCard({ piece, onOpen, onMove }: { piece: Piece; onOpen: (id: string) => void; onMove: (piece: Piece, to: PieceStage) => void }) {
  const t = useT();
  const next = piece.variants.filter((v) => v.status === "scheduled" && v.scheduled_date).sort((a, b) => `${a.scheduled_date}${a.scheduled_time}`.localeCompare(`${b.scheduled_date}${b.scheduled_time}`))[0];
  const conflict = piece.variants.some((v) => v.conflicts.length);
  return (
    <button type="button" draggable={piece.column !== "published"} data-piece={piece.id}
      onDragStart={(e) => { e.dataTransfer.setData("text/x-piece", piece.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => onOpen(piece.id)}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault();
        const to = neighbourStage(piece.column, e.key === "ArrowLeft" ? -1 : 1);
        if (to) onMove(piece, to);
      }}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
      aria-describedby="board-help"
      className="flex w-full cursor-grab flex-col gap-1.5 rounded-[12px] bg-panel p-3 text-left shadow-[0_1px_0_var(--hairline)] hover:bg-subtle focus-visible:outline-2 active:cursor-grabbing">
      <span className="flex items-start justify-between gap-2"><span className="text-sm font-medium leading-snug">{piece.title}</span><ScoreBadge score={piece.score} className="shrink-0" /></span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-3"><BrandTag brand={piece.brand} /><span>{t(FORMAT_LABELS[piece.format])}</span></span>
      {piece.variants.length ? (
        <span className="flex flex-wrap gap-1">
          {piece.variants.map((v) => (
            <span key={v.id} className={cn("max-w-full truncate rounded-full px-1.5 text-[11px]", v.status === "published" ? "bg-ink text-panel" : v.status === "scheduled" ? "border border-ink text-ink" : "bg-subtle text-text-2")}
              title={`${versionLabel(v)} · ${t(v.status === "draft" ? "Draft" : STAGE_LABELS[v.status])}`}>{versionLabel(v)}</span>
          ))}
        </span>
      ) : <span className="text-[12px] text-text-3">{t("No account yet")}</span>}
      {next || conflict ? (
        <span className="flex flex-wrap justify-between gap-2 text-[12px]">
          {next ? <span className="num text-text-2">{fmtDay(next.scheduled_date!)}{next.scheduled_time ? ` · ${next.scheduled_time}` : ""}</span> : <span />}
          {conflict ? <span className="inline-flex items-center gap-1 text-bad"><AlertTriangle className="size-3.5" />{t("Conflict")}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

function QuickIdea({ brand }: { brand: string }) {
  const t = useT();
  const save = useSaveHandlers();
  const [title, setTitle] = React.useState("");
  const m = useMutation({
    mutationFn: (x: string) => api("/api/content", { body: { id: crypto.randomUUID(), title: x, brand: brand === "personal" ? null : brand || "consulting", format: "post", stage: "idea", targets: [] } }),
    ...save(() => setTitle("")),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) m.mutate(title.trim()); }} className="flex gap-1">
      <Input aria-label={t("Quick idea")} placeholder={t("An idea in one line…")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="h-9 text-[13px]" />
      <Button type="submit" size="sm" variant="ghost" aria-label={t("Add the idea")} disabled={!title.trim() || m.isPending}><Plus className="size-4" /></Button>
    </form>
  );
}

function Board({ studio, filters, onOpen, onCreate }: { studio: Studio; filters: Filters; onOpen: (id: string) => void; onCreate: () => void }) {
  const t = useT();
  const save = useSaveHandlers();
  const [over, setOver] = React.useState<PieceStage | null>(null);
  const move = useMutation({
    mutationFn: (x: { piece: Piece; to: PieceStage }) => api<{ scheduled: number; unscheduled: number }>("/api/content/move", { body: { id: x.piece.id, expected_version: x.piece.version, to: x.to } }),
    ...save(),
    onSuccess: (r) => { save().onSuccess(); if (r.unscheduled) toast(t("{n} version(s) back to draft (dates kept).", { n: r.unscheduled })); if (r.scheduled) toast(t("{n} version(s) scheduled.", { n: r.scheduled })); },
  });
  const tryMove = (piece: Piece, to: PieceStage) => {
    if (to === piece.column) return;
    if (piece.column === "published") return void toast(t("A published piece stays published."));
    if (to === "published") { toast(t("Publish each version from the composer: copy the caption, post, then mark it published.")); return onOpen(piece.id); }
    if (to === "scheduled" && !piece.variants.some((v) => v.status === "draft" && v.scheduled_date)) { toast(t("Choose a date for at least one version first.")); return onOpen(piece.id); }
    if (piece.column === "scheduled" && !window.confirm(t("Put the scheduled versions back to draft?"))) return;
    move.mutate({ piece, to });
  };
  const pieces = studio.pieces.filter((p) => matches(p, filters));
  if (!studio.pieces.length) return <EmptyState title={t("No content yet")} action={<Button variant="primary" size="sm" onClick={onCreate}>{t("New content")}</Button>}>{t("Start with an idea: one line is enough. Add the accounts when you write the post.")}</EmptyState>;
  return (
    <div className="flex flex-col gap-2">
      <p id="board-help" className="text-[12px] text-text-3">{t("Drag a card to another column, or focus it and press Alt + ← / →.")}</p>
      {move.isError && !(move.error instanceof ApiError && move.error.isConflict) ? <ErrorState error={move.error} onRetry={() => move.reset()} /> : null}
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <ol className="grid min-w-[1000px] grid-cols-5 gap-3" aria-label={t("Board")}>
          {PIECE_STAGES.map((stage) => {
            const list = pieces.filter((p) => p.column === stage);
            return (
              <li key={stage} data-column={stage}
                onDragOver={(e) => { if (e.dataTransfer.types.includes("text/x-piece")) { e.preventDefault(); setOver(stage); } }}
                onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const p = studio.pieces.find((x) => x.id === e.dataTransfer.getData("text/x-piece")); if (p) tryMove(p, stage); }}
                className={cn("flex min-w-0 flex-col gap-2 rounded-[20px] bg-subtle/60 p-2 transition-colors", over === stage && "ring-2 ring-ink")}>
                <h3 className="flex justify-between px-1 text-[13px] font-semibold text-text-2"><span>{t(STAGE_LABELS[stage])}</span><span className="num">{list.length}</span></h3>
                {stage === "idea" ? <QuickIdea brand={filters.brand} /> : null}
                {list.slice(0, 20).map((p) => <PieceCard key={p.id} piece={p} onOpen={onOpen} onMove={tryMove} />)}
                {list.length > 20 ? <p className="px-1 text-[12px] text-text-3">{t("+{n} more: use the filters.", { n: list.length - 20 })}</p> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* ---------- planning: week and month ---------- */

type Entry = Studio["schedule"][number];
function Chip({ e, onOpen, onShift, compact }: { e: Entry; onOpen: () => void; onShift: (days: number) => void; compact?: boolean }) {
  const t = useT();
  const movable = e.status !== "published";
  return (
    <button type="button" draggable={movable} data-entry={e.id}
      onDragStart={(ev) => { ev.dataTransfer.setData("text/x-version", e.id); ev.dataTransfer.effectAllowed = "move"; }}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (!movable || !ev.altKey) return;
        const n = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : ev.key === "ArrowUp" ? -7 : ev.key === "ArrowDown" ? 7 : 0;
        if (n) { ev.preventDefault(); onShift(n); }
      }}
      aria-keyshortcuts={movable ? "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" : undefined}
      aria-describedby="planning-help"
      className={cn("w-full rounded-[8px] px-2 py-1 text-left text-[12px] leading-tight", movable && "cursor-grab",
        e.status === "published" ? "bg-ink text-panel" : e.status === "scheduled" ? "border border-ink bg-panel" : "border border-dashed border-control bg-panel text-text-2",
        e.conflict && "border-bad ring-1 ring-bad")}>
      <span className="flex items-center justify-between gap-1"><span className="num font-semibold">{e.time || "—"}</span>{e.conflict ? <AlertTriangle aria-label={t("Conflict")} className="size-3.5 text-bad" /> : null}</span>
      <span className="block truncate font-medium">{e.title}</span>
      {!compact ? <span className={cn("block truncate", e.status === "published" ? "text-panel/80" : "text-text-3")}>{versionLabel(e)}</span> : null}
    </button>
  );
}

function Planning({ studio, filters, onOpen, week, setWeek }: { studio: Studio; filters: Filters; onOpen: (piece: string, version: string) => void; week: string; setWeek: (w: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const save = useSaveHandlers();
  const [view, setView] = React.useState<"week" | "month">("week");
  const [over, setOver] = React.useState<string | null>(null);
  const [slot, setSlot] = React.useState<ReturnType<typeof recommendedSlots>[number] | null>(null);
  const keep = new Set(studio.pieces.filter((p) => matches(p, filters)).map((p) => p.id));
  const entries = studio.schedule.filter((e) => keep.has(e.piece_id) && (!filters.account || e.account_id === filters.account) && (!filters.language || e.language === filters.language));
  const resched = useMutation({
    mutationFn: (x: { e: Entry; date: string }) => api("/api/content/variants", { method: "PATCH", body: { id: x.e.id, expected_version: x.e.version, action: x.e.status === "scheduled" ? "schedule" : "save", patch: { scheduled_date: x.date } } }),
    ...save(),
  });
  const drop = (date: string) => (ev: React.DragEvent) => { ev.preventDefault(); setOver(null); const e = studio.schedule.find((x) => x.id === ev.dataTransfer.getData("text/x-version")); if (e && e.date !== date) resched.mutate({ e, date }); };
  const dragOver = (date: string) => (ev: React.DragEvent) => { if (ev.dataTransfer.types.includes("text/x-version")) { ev.preventDefault(); setOver(date); } };
  const shift = (e: Entry) => (n: number) => resched.mutate({ e, date: addDays(e.date, n) });
  const month = monthGrid(addDays(week, 3), addDays);
  const step = (dir: -1 | 1) => {
    if (view === "week") return setWeek(addDays(week, 7 * dir));
    const [y, mo] = month.month.split("-").map(Number);
    setWeek(startOfWeek(new Date(Date.UTC(y, mo - 1 + dir, 7)).toISOString().slice(0, 10))); // the week of the 7th lies in that month
  };
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const recs = recommendedSlots(week, studio.accounts, addDays).filter((r) => (!filters.account || r.account_id === filters.account) && (!filters.language || r.language === filters.language));
  const free = (r: (typeof recs)[number]) => !studio.schedule.some((e) => e.date === r.date && (r.account_id ? e.account_id === r.account_id : e.network === r.network) && (!r.language || e.language === r.language));
  const title = view === "week" ? t("Week of {date}", { date: fmtDay(week) }) : new Date(`${month.month}-15T12:00:00Z`).toLocaleDateString(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Panel>
      <PanelTitle action={<SegmentedSwitch size="sm" label={t("View")} value={view} onChange={setView} options={[{ value: "week", label: t("Week") }, { value: "month", label: t("Month") }]} />}>{t("Planning")}</PanelTitle>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="group" aria-label={t("Period")}>
          <Button size="sm" variant="ghost" aria-label={t("Previous")} onClick={() => step(-1)}><ChevronLeft className="size-4" /></Button>
          <span className="num min-w-36 text-center text-sm first-letter:uppercase">{title}</span>
          <Button size="sm" variant="ghost" aria-label={t("Next")} onClick={() => step(1)}><ChevronRight className="size-4" /></Button>
        </div>
        <p id="planning-help" className="text-[12px] text-text-3">{t("Drag a post to another day, or focus it and press Alt + arrows (← → one day, ↑ ↓ one week).")}</p>
      </div>
      {resched.isError && !(resched.error instanceof ApiError && resched.error.isConflict) ? <ErrorState error={resched.error} onRetry={() => resched.reset()} /> : null}
      {view === "week" ? (
        <ol className="grid grid-cols-1 gap-2 md:grid-cols-7" aria-label={title}>
          {days.map((date) => {
            const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
            const mine = entries.filter((e) => e.date === date);
            const slots = recs.filter((r) => r.date === date && free(r));
            return (
              <li key={date} data-day={date} onDragOver={dragOver(date)} onDragLeave={() => setOver((o) => (o === date ? null : o))} onDrop={drop(date)}
                className={cn("flex min-h-28 min-w-0 flex-col gap-1.5 rounded-[12px] border p-2", date === studio.today ? "border-ink" : "border-hairline", over === date && "bg-subtle ring-2 ring-ink")}>
                <h3 className="text-[13px] font-semibold"><span className="sr-only">{t(WEEKDAYS[wd])} </span><span className="num">{fmtDay(date)}</span></h3>
                {[...mine.map((e) => ({ time: e.time || "00:00", node: <Chip key={e.id} e={e} onOpen={() => onOpen(e.piece_id, e.id)} onShift={shift(e)} /> })),
                  ...slots.map((r) => ({ time: r.time, node: (
                    <button key={r.key} type="button" onClick={() => setSlot(r)} title={t("Recommended slot")} aria-label={`${t("Recommended slot")} ${r.time} · ${t(r.label)}`}
                      className="w-full rounded-[8px] border border-dashed border-control px-2 py-1 text-left text-[12px] leading-tight text-text-2 hover:bg-subtle">
                      <span className="num font-semibold">{r.time}</span><span className="block truncate">{t(r.label)}</span>
                    </button>
                  ) }))].sort((a, b) => a.time.localeCompare(b.time)).map((x) => x.node)}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[700px] table-fixed border-separate border-spacing-1 text-left">
            <thead><tr>{[1, 2, 3, 4, 5, 6, 0].map((wd) => <th key={wd} className="text-[12px] font-medium text-text-3">{t(WEEKDAYS[wd])}</th>)}</tr></thead>
            <tbody>
              {month.weeks.map((wk) => (
                <tr key={wk[0]}>
                  {wk.map((date) => {
                    const mine = entries.filter((e) => e.date === date);
                    return (
                      <td key={date} data-day={date} onDragOver={dragOver(date)} onDragLeave={() => setOver((o) => (o === date ? null : o))} onDrop={drop(date)}
                        className={cn("h-24 rounded-[8px] border p-1 align-top", date.slice(0, 7) === month.month ? "border-hairline" : "border-transparent bg-subtle/40", date === studio.today && "border-ink", over === date && "ring-2 ring-ink")}>
                        <span className="num block text-[11px] text-text-3">{Number(date.slice(8))}</span>
                        <div className="flex flex-col gap-1">{mine.slice(0, 3).map((e) => <Chip key={e.id} e={e} compact onOpen={() => onOpen(e.piece_id, e.id)} onShift={shift(e)} />)}</div>
                        {mine.length > 3 ? <span className="text-[11px] text-text-3">{t("+{n} more", { n: mine.length - 3 })}</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[12px] text-text-3">{t("Dashed: recommended slots from the weekly plan, at the best hour of the network. Red: two posts on the same account less than an hour apart.")}</p>
      {slot ? <SlotDialog slot={slot} studio={studio} onClose={() => setSlot(null)} /> : null}
    </Panel>
  );
}

/** Fill a recommended slot: pick a piece; its version for that account and language is scheduled (created if needed). */
function SlotDialog({ slot, studio, onClose }: { slot: ReturnType<typeof recommendedSlots>[number]; studio: Studio; onClose: () => void }) {
  const t = useT();
  const save = useSaveHandlers();
  const accounts = studio.accounts.filter((a) => (slot.account_id ? a.id === slot.account_id : a.network === slot.network));
  const [pieceId, setPieceId] = React.useState("");
  const [account, setAccount] = React.useState(accounts[0]?.id ?? "");
  const [lang, setLang] = React.useState<"FR" | "ES">(slot.language ?? "FR");
  const [time, setTime] = React.useState(slot.time);
  const candidates = studio.pieces.filter((p) => p.column !== "published");
  const m = useMutation({
    mutationFn: async () => {
      const p = studio.pieces.find((x) => x.id === pieceId)!;
      const v = p.variants.find((x) => x.account_id === account && x.language === lang);
      if (v) return api("/api/content/variants", { method: "PATCH", body: { id: v.id, expected_version: v.version, action: "schedule", patch: { scheduled_date: slot.date, scheduled_time: time } } });
      return api("/api/content/variants", { body: { piece_id: p.id, targets: [{ account_id: account, language: lang }], schedule: { date: slot.date, time } } });
    },
    ...save(() => { toast(t("Scheduled")); onClose(); }),
  });
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t("Schedule on this slot")} description={`${fmtDay(slot.date)} · ${slot.time} · ${t(slot.label)}`}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-text-2">{t("Content")}
          <Select value={pieceId} onChange={(e) => setPieceId(e.target.value)}><option value="">{t("Choose…")}</option>{candidates.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 flex flex-col gap-1 text-[13px] font-medium text-text-2 sm:col-span-1">{t("Account")}<Select value={account} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select></label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-2">{t("Language")}<Select value={lang} onChange={(e) => setLang(e.target.value as "FR")}><option value="FR">FR</option><option value="ES">ES</option></Select></label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-2">{t("Time")}<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button variant="primary" disabled={!pieceId || !account || m.isPending} onClick={() => m.mutate()}>{t("Schedule")}</Button>
      </div>
    </Modal>
  );
}

/* ---------- batch production ---------- */

function BatchView({ studio, onOpen }: { studio: Studio; onOpen: (id: string) => void }) {
  const t = useT();
  const save = useSaveHandlers();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const m = useMutation({
    mutationFn: (v: { to: string; items: { id: string; expected_version: number }[] }) => api<{ moved: number; conflicts: string[] }>("/api/content/batch", { body: v }),
    ...save(() => setPicked(new Set())),
  });
  React.useEffect(() => {
    if (m.data) toast(m.data.conflicts.length ? t("{n} moved, {c} changed by someone else", { n: m.data.moved, c: m.data.conflicts.length }) : t("{n} moved", { n: m.data.moved }));
  }, [m.data, t]);
  const groups = PRODUCTION_STAGES.map((s) => ({ stage: s, next: nextProductionStage(s), pieces: studio.pieces.filter((p) => p.column === s) }));
  return (
    <Panel>
      <PanelTitle>{t("Batch production")}</PanelTitle>
      <p className="mb-3 text-[13px] text-text-2">{t("Write and shoot several pieces in one sitting, then move them together.")}</p>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.stage}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t(STAGE_LABELS[g.stage])} <span className="num font-normal text-text-3">{g.pieces.length}</span></h3>
              {g.next ? (
                <Button size="sm" variant="outline" disabled={m.isPending || !g.pieces.some((p) => picked.has(p.id))}
                  onClick={() => m.mutate({ to: g.next!, items: g.pieces.filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, expected_version: p.version })) })}>
                  {t("Move selected to {stage}", { stage: t(STAGE_LABELS[g.next]) })}
                </Button>
              ) : null}
            </div>
            {g.pieces.length === 0 ? <p className="text-[13px] text-text-3">{t("Nothing at this step.")}</p> : (
              <ul className="flex flex-col divide-y divide-hairline">
                {g.pieces.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                    <input type="checkbox" className="size-5" aria-label={t("Select {name}", { name: p.title })} checked={picked.has(p.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpen(p.id)}>{p.title}</button>
                    <BrandTag brand={p.brand} />
                    <ScoreBadge score={p.score} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {m.isError && !(m.error instanceof ApiError && m.error.isConflict) ? <ErrorState error={m.error} onRetry={() => m.reset()} /> : null}
    </Panel>
  );
}

/* ---------- results: views → leads per post and per week ---------- */

function PathSteps({ network, data }: { network: "instagram" | "linkedin"; data: Studio["weekPath"]["instagram"] }) {
  const t = useT();
  const tag = useDateTag();
  const first = network === "instagram" ? "Views" : "Impressions";
  const steps = [[first, data.steps.views], ["Profile visits", data.steps.profile_visits], ["Link clicks", data.steps.link_clicks], ["Site visits", data.steps.site_visits], ["Leads", data.steps.leads]] as const;
  return (
    <section aria-label={network === "instagram" ? "Instagram" : "LinkedIn"}>
      <h3 className="mb-2 text-sm font-semibold">{network === "instagram" ? "Instagram" : "LinkedIn"} <span className="font-normal text-text-3">· {t("{n} post(s) published this week", { n: data.posts })}</span></h3>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {steps.map(([label, s], i) => {
          const prev = i > 0 ? steps[i - 1][1].value : null;
          const pct = s.value !== null && prev ? Math.round((s.value / prev) * 1000) / 10 : null;
          return (
            <li key={label} className="min-w-0 rounded-[12px] bg-subtle/60 p-2">
              <p className="truncate text-[12px] text-text-2">{t(label)}</p>
              <p className="num text-lg font-semibold">{s.value === null ? "—" : s.value.toLocaleString(tag)}</p>
              <p className="num text-[11px] text-text-3">{s.value === null ? t("not entered") : `${pct !== null ? `${pct.toLocaleString(tag)} % · ` : ""}${t("{n} post(s)", { n: s.posts })}`}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
function ResultsView({ studio, onOpen, week, setWeek }: { studio: Studio; onOpen: (id: string) => void; week: string; setWeek: (w: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const posts = studio.pieces.flatMap((p) => p.variants.filter(isPublished).map((v) => ({ p, v }))).sort((a, b) => (b.v.published_at ?? "").localeCompare(a.v.published_at ?? ""));
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString(tag));
  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelTitle action={
          <div className="flex items-center gap-1" role="group" aria-label={t("Week")}>
            <Button size="sm" variant="ghost" aria-label={t("Previous week")} onClick={() => setWeek(addDays(week, -7))}><ChevronLeft className="size-4" /></Button>
            <span className="num min-w-28 text-center text-sm">{t("Week of {date}", { date: fmtDay(week) })}</span>
            <Button size="sm" variant="ghost" aria-label={t("Next week")} onClick={() => setWeek(addDays(week, 7))}><ChevronRight className="size-4" /></Button>
          </div>
        }>{t("From views to leads, this week")}</PanelTitle>
        <div className="flex flex-col gap-4">
          <PathSteps network="instagram" data={studio.weekPath.instagram} />
          <PathSteps network="linkedin" data={studio.weekPath.linkedin} />
        </div>
        <p className="mt-3 text-[12px] text-text-3">{t("Each post counts at its most recent checkpoint. Instagram views and LinkedIn impressions are different measures and are never added. Site visits and leads come from the UTM link of each post. No country targeting is assumed.")}</p>
      </Panel>
      <Panel>
        <PanelTitle>{t("Published posts")}</PanelTitle>
        {posts.length === 0 ? <p className="text-sm text-text-2">{t("No post published yet.")}</p> : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Post")}</th><th className="font-medium">{t("Checkpoint")}</th><th className="text-right font-medium">{t("Views / impressions")}</th><th className="text-right font-medium">{t("Profile visits")}</th><th className="text-right font-medium">{t("Link clicks")}</th><th className="text-right font-medium">{t("Site visits")}</th><th className="text-right font-medium">{t("Leads")}</th></tr></thead>
              <tbody className="divide-y divide-hairline">
                {posts.slice(0, 20).map(({ p, v }) => (
                  <tr key={v.id}>
                    <td className="max-w-[260px] py-2"><button type="button" className="truncate text-left hover:underline" onClick={() => onOpen(p.id)}>{v.language} · {p.title}</button><span className="block text-[12px] text-text-3">{v.published_at ? fmtDay(v.published_at.slice(0, 10)) : ""} · {v.account}</span></td>
                    <td className="text-[12px] text-text-2">{v.latest ? `${t(CHECKPOINTS.find((c) => c.key === v.latest!.checkpoint)?.label ?? "Story")} · ${v.latest.source === "api" ? t("API") : t("entered by hand")}` : t("no numbers yet")}</td>
                    <td className="num text-right">{n(v.path.views)}</td><td className="num text-right">{n(v.path.profile_visits)}</td><td className="num text-right">{n(v.path.link_clicks)}</td><td className="num text-right">{n(v.path.site_visits)}</td><td className="num text-right">{n(v.path.leads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------- editable checklist ---------- */

function ChecklistEditor({ studio }: { studio: Studio }) {
  const [platform, setPlatform] = React.useState<"instagram" | "linkedin">("instagram");
  return <ChecklistForm key={`${platform}:${JSON.stringify(studio.checklists[platform])}`} platform={platform} setPlatform={setPlatform} initial={studio.checklists[platform]} />;
}
function ChecklistForm({ platform, setPlatform, initial }: { platform: "instagram" | "linkedin"; setPlatform: (p: "instagram" | "linkedin") => void; initial: ChecklistItem[] }) {
  const t = useT();
  const [items, setItems] = React.useState<ChecklistItem[]>(initial);
  const save = useSaveHandlers();
  const m = useMutation({ mutationFn: () => api("/api/content/checklist", { method: "PUT", body: { platform, items } }), ...save(() => toast(t("Checklist saved"))) });
  return (
    <Panel>
      <PanelTitle action={<SegmentedSwitch size="sm" label={t("Network")} value={platform} onChange={setPlatform} options={[{ value: "instagram", label: "Instagram" }, { value: "linkedin", label: "LinkedIn" }]} />}>{t("Publishing checklist")}</PanelTitle>
      <p className="mb-3 text-[13px] text-text-2">{t("Ticked on each version before it goes out. Rename, remove or add steps; the change applies to every version of this network.")}</p>
      <ol className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-2">
            <span className="num w-5 text-right text-[12px] text-text-3">{i + 1}</span>
            <Input aria-label={t("Step {n}", { n: i + 1 })} value={t(it.label)} onChange={(e) => setItems(items.map((x) => (x.key === it.key ? { ...x, label: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label={t("Remove")} onClick={() => setItems(items.filter((x) => x.key !== it.key))}><Trash2 className="size-4" /></Button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={items.length >= 30} onClick={() => setItems([...items, { key: `custom-${Date.now().toString(36)}`, label: "" }])}><Plus className="size-4" />{t("Add a step")}</Button>
        <Button size="sm" variant="primary" disabled={m.isPending || !items.length || items.some((i) => !i.label.trim())} onClick={() => m.mutate()}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </div>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </Panel>
  );
}

/* ---------- compact card for the Growth dashboard ---------- */

/** Growth › Content: this week's goals, the next scheduled posts and a link to the studio. */
export function ContentStudioCard() {
  const t = useT();
  const q = useStudio(null);
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const next = d.schedule.filter((e) => e.status === "scheduled" && e.date >= d.today).slice(0, 5);
  const done = d.targets.reduce((a, i) => a + Math.min(i.done, i.target), 0);
  const target = d.targets.reduce((a, i) => a + i.target, 0);
  return (
    <Panel>
      <PanelTitle action={<Link href="/marketing/content" className="text-sm font-medium underline underline-offset-2">{t("Open the Content Studio")}</Link>}>{t("Content Studio")}</PanelTitle>
      <p className="text-sm"><span className="num text-2xl font-semibold">{done}/{target}</span> <span className="text-text-2">{t("weekly video goals done")}</span></p>
      <p className="mt-1 text-[13px] text-text-2">{d.columns.filter((c) => c.count).map((c) => `${t(STAGE_LABELS[c.stage])} ${c.count}`).join(" · ") || t("No content yet")}</p>
      {next.length ? (
        <ul className="mt-3 flex flex-col divide-y divide-hairline text-sm">
          {next.map((v) => <li key={v.id} className="flex justify-between gap-3 py-1.5"><span className="truncate">{versionLabel(v)} · {v.title}</span><span className="num shrink-0 text-text-3">{fmtDay(v.date)}{v.time ? ` ${v.time}` : ""}</span></li>)}
        </ul>
      ) : <p className="mt-3 text-[13px] text-text-3">{t("Nothing scheduled for the rest of the week.")}</p>}
    </Panel>
  );
}
