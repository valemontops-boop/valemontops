"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import { useDateTag, useT } from "@/i18n/react";
import { addDays } from "@/domain/time";
import { PUBLISHING_CALENDAR } from "@/domain/content";
import { CHECKPOINTS, FORMAT_LABELS, PRODUCTION_STAGES, STAGE_LABELS, nextProductionStage, utmUrl, type ChecklistItem, type ContentFormat, type PieceStage } from "@/domain/content-studio";
import type { Studio } from "@/server/services/content-studio";
import { FOUNDER_NAMES } from "@/domain/constants";
import { fmtDateTime, fmtDay } from "./bits";

/**
 * Content Studio (Stage 3 marketing, D079): pipeline (Kanban) idea → script → shooting → editing → scheduled →
 * published, week calendar on the round-8 slots, batch production, results (views → leads per post and per week)
 * and the editable publishing checklist. Self-contained: mounted at /marketing/content; <ContentStudioCard/> is the
 * summary the Growth dashboard can place.
 */
type Piece = Studio["pieces"][number];
type Variant = Piece["variants"][number];
type Section = "pipeline" | "calendar" | "batch" | "results" | "checklist";
const BRAND_NAME: Record<string, string> = { thirty: "30/30 AI", consulting: "Valemont" };
const BRAND_DOT: Record<string, string> = { thirty: "bg-brand-thirty", consulting: "bg-brand-consulting" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const METRIC_LABEL: Record<string, string> = { views: "Views", impressions: "Impressions", reach: "Reach", likes: "Likes", comments: "Comments", saves: "Saves", shares: "Shares", profile_visits: "Profile visits", link_clicks: "Link clicks", site_visits: "Site visits", leads: "Leads", follows: "Follows" };
const isPublished = (v: Variant) => v.status === "published";

function useStudio(week: string | null) {
  return useQuery({ queryKey: ["content-studio", week], queryFn: () => api<Studio>(`/api/content${week ? `?week=${week}` : ""}`) });
}
function useSave() {
  const qc = useQueryClient();
  const t = useT();
  return (onDone?: () => void) => ({
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["content-studio"] }); qc.invalidateQueries({ queryKey: ["marketing-week"] }); onDone?.(); },
    onError: (e: unknown) => { if (e instanceof ApiError && e.isConflict) { toast(t("Someone else changed this record. Review both versions.")); qc.invalidateQueries({ queryKey: ["content-studio"] }); } },
  });
}

export function ContentStudio() {
  const t = useT();
  const [week, setWeek] = React.useState<string | null>(null);
  const [section, setSection] = React.useState<Section>("pipeline");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const q = useStudio(week);
  const d = q.data;
  const open = d?.pieces.find((p) => p.id === openId) ?? null;
  return (
    <div className="flex gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] text-text-3"><Link href="/marketing" className="underline underline-offset-2">{t("Growth")}</Link></p>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Content Studio")}</h1>
            <p className="text-sm text-text-2">{t("One concept, a French and a Spanish version, from the idea to the numbers.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d ? (
              <div className="flex items-center gap-1" role="group" aria-label={t("Week")}>
                <Button size="sm" variant="ghost" aria-label={t("Previous week")} onClick={() => setWeek(addDays(d.week, -7))}><ChevronLeft className="size-4" /></Button>
                <span className="num min-w-28 text-center text-sm">{t("Week of {date}", { date: fmtDay(d.week) })}</span>
                <Button size="sm" variant="ghost" aria-label={t("Next week")} onClick={() => setWeek(addDays(d.week, 7))}><ChevronRight className="size-4" /></Button>
              </div>
            ) : null}
            <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" />{t("New piece")}</Button>
          </div>
        </div>
        {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <Targets studio={q.data} />
            <div className="-mx-1 overflow-x-auto px-1 [&_button]:whitespace-nowrap">
              <SegmentedSwitch label={t("Section")} value={section} onChange={setSection} options={[
                { value: "pipeline", label: t("Stages board") }, { value: "calendar", label: t("Calendar") }, { value: "batch", label: t("Batch production") },
                { value: "results", label: t("Results") }, { value: "checklist", label: t("Checklists") },
              ]} />
            </div>
            {section === "pipeline" ? <Pipeline studio={q.data} onOpen={setOpenId} onCreate={() => setCreating(true)} />
              : section === "calendar" ? <CalendarView studio={q.data} onOpen={setOpenId} />
              : section === "batch" ? <BatchView studio={q.data} onOpen={setOpenId} />
              : section === "results" ? <ResultsView studio={q.data} onOpen={setOpenId} />
              : <ChecklistEditor studio={q.data} />}
          </>
        )}
      </div>
      {open && d ? <PieceDrawer key={open.id} piece={open} studio={d} onClose={() => setOpenId(null)} /> : null}
      <NewPiece open={creating} onOpenChange={setCreating} onCreated={(id) => { setCreating(false); setOpenId(id); }} />
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

/* ---------- pipeline (Kanban) ---------- */

function VariantChips({ piece }: { piece: Piece }) {
  const t = useT();
  return (
    <span className="flex gap-1">
      {piece.variants.map((v) => (
        <span key={v.id} className={cn("rounded-full px-1.5 text-[11px] font-semibold", v.status === "published" ? "bg-ink text-panel" : v.status === "scheduled" ? "border border-ink text-ink" : "bg-subtle text-text-2")}
          title={`${v.language} · ${t(v.status === "draft" ? "Draft" : STAGE_LABELS[v.status as PieceStage])}`}>{v.language}</span>
      ))}
    </span>
  );
}
function BrandTag({ brand }: { brand: string | null }) {
  const t = useT();
  if (!brand) return <span className="text-[12px] text-text-3">{t("Personal")}</span>;
  return <span className="inline-flex items-center gap-1 text-[12px] text-text-2"><span aria-hidden className={cn("size-2 rounded-full", BRAND_DOT[brand])} />{BRAND_NAME[brand]}</span>;
}
function PieceCard({ piece, onOpen }: { piece: Piece; onOpen: (id: string) => void }) {
  const t = useT();
  const done = piece.variants.reduce((a, v) => a + v.checklist.done, 0);
  const total = piece.variants.reduce((a, v) => a + v.checklist.total, 0);
  return (
    <button type="button" onClick={() => onOpen(piece.id)} className="flex w-full flex-col gap-1.5 rounded-[12px] bg-panel p-3 text-left shadow-[0_1px_0_var(--hairline)] hover:bg-subtle focus-visible:outline-2">
      <span className="text-sm font-medium leading-snug">{piece.title}</span>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <BrandTag brand={piece.brand} />
        <VariantChips piece={piece} />
      </span>
      <span className="flex flex-wrap justify-between gap-x-2 text-[12px] text-text-3"><span>{t(FORMAT_LABELS[piece.format])}</span>{piece.column === "scheduled" || piece.column === "edit" ? <span className="num">{t("Checklist {done}/{total}", { done, total })}</span> : null}</span>
    </button>
  );
}
function Pipeline({ studio, onOpen, onCreate }: { studio: Studio; onOpen: (id: string) => void; onCreate: () => void }) {
  const t = useT();
  if (!studio.pieces.length) return <EmptyState title={t("No content yet")} action={<Button variant="primary" size="sm" onClick={onCreate}>{t("New piece")}</Button>}>{t("Start with an idea: one line is enough. Its French and Spanish versions are created with it.")}</EmptyState>;
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <ol className="grid min-w-[960px] grid-cols-6 gap-3" aria-label={t("Stages board")}>
        {studio.columns.map((c) => (
          <li key={c.stage} className="flex min-w-0 flex-col gap-2 rounded-[20px] bg-subtle/60 p-2">
            <h3 className="flex justify-between px-1 text-[13px] font-semibold text-text-2"><span>{t(STAGE_LABELS[c.stage])}</span><span className="num">{c.count}</span></h3>
            {studio.pieces.filter((p) => p.column === c.stage).slice(0, 12).map((p) => <PieceCard key={p.id} piece={p} onOpen={onOpen} />)}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- calendar (round-8 weekday slots) ---------- */

function CalendarView({ studio, onOpen }: { studio: Studio; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <Panel>
      <PanelTitle>{t("Publishing calendar")}</PanelTitle>
      <p className="mb-3 text-[13px] text-text-2">{t("Default slots of the weekly plan. Schedule a version from its card to fill a slot.")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {studio.calendar.map((d) => (
          <section key={d.date} className={cn("rounded-[12px] border border-hairline p-3", d.date === studio.today && "border-ink")}>
            <h3 className="mb-2 flex justify-between text-sm font-semibold"><span>{t(WEEKDAYS[d.weekday])}</span><span className="num font-normal text-text-3">{fmtDay(d.date)}</span></h3>
            <ul className="flex flex-col gap-1.5">
              {d.slots.map((s) => (
                <li key={s.key} className="text-[13px]">
                  <span className="block text-text-3">{t(s.label)}</span>
                  {s.variant ? (
                    <button type="button" onClick={() => onOpen(s.variant!.piece_id)} className={cn("w-full truncate rounded-[8px] px-2 py-1 text-left font-medium hover:bg-subtle", s.variant.status === "published" ? "bg-ink text-panel hover:bg-ink" : "border border-ink")}>
                      {s.variant.language} · {s.variant.title}
                    </button>
                  ) : s.deliverable ? <span className="block rounded-[8px] border border-dashed border-control px-2 py-1 text-text-2">{t("Free slot")}</span> : null}
                </li>
              ))}
              {d.extra.map((v) => (
                <li key={v.id} className="text-[13px]"><span className="block text-text-3">{t("Outside the plan")}</span>
                  <button type="button" onClick={() => onOpen(v.piece_id)} className="w-full truncate rounded-[8px] border border-control px-2 py-1 text-left hover:bg-subtle">{v.language} · {v.title}</button></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}

/* ---------- batch production ---------- */

function BatchView({ studio, onOpen }: { studio: Studio; onOpen: (id: string) => void }) {
  const t = useT();
  const save = useSave();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const m = useMutation({
    mutationFn: (v: { to: string; items: { id: string; expected_version: number }[] }) => api<{ moved: number; conflicts: string[] }>("/api/content/batch", { body: v }),
    ...save(() => setPicked(new Set())),
  });
  React.useEffect(() => {
    if (m.data) toast(m.data.conflicts.length ? t("{n} moved, {c} changed by someone else", { n: m.data.moved, c: m.data.conflicts.length }) : t("{n} moved", { n: m.data.moved }));
  }, [m.data, t]);
  const groups = (["idea", "script", "shoot", "edit"] as const).map((s) => ({ stage: s, next: nextProductionStage(s), pieces: studio.pieces.filter((p) => p.column === s) }));
  return (
    <Panel>
      <PanelTitle>{t("Batch production")}</PanelTitle>
      <p className="mb-3 text-[13px] text-text-2">{t("Write, shoot and edit several concepts in one sitting, then move them together.")}</p>
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
                    <span className="hidden text-[12px] text-text-3 sm:inline">{p.hook ? t("hook ready") : t("no hook yet")}{p.script ? ` · ${t("script ready")}` : ""}</span>
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
      <ol className="grid grid-cols-5 gap-2">
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
function ResultsView({ studio, onOpen }: { studio: Studio; onOpen: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const posts = studio.pieces.flatMap((p) => p.variants.filter(isPublished).map((v) => ({ p, v }))).sort((a, b) => (b.v.published_at ?? "").localeCompare(a.v.published_at ?? ""));
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString(tag));
  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelTitle>{t("From views to leads, this week")}</PanelTitle>
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
  const save = useSave();
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

/* ---------- new piece ---------- */

function NewPiece({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useT();
  const save = useSave();
  const blank = () => ({ id: crypto.randomUUID(), title: "", brand: "thirty" as "thirty" | "consulting", format: "reel" as ContentFormat, hook: "", target_persona: "", fr: true, es: true });
  const [v, setV] = React.useState(blank);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>("/api/content", { body: { id: v.id, title: v.title, brand: v.format === "personal_post" ? null : v.brand, format: v.format, hook: v.hook, target_persona: v.target_persona, languages: [v.fr && "FR", v.es && "ES"].filter(Boolean) } }),
    ...save(() => { const id = v.id; setV(blank()); onCreated(id); }),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("New piece")} description={t("One concept; its French and Spanish versions are created with it.")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.title.trim() && (v.fr || v.es)) m.mutate(); }}>
        <Field label={t("Title")} htmlFor="cp-title"><Input id="cp-title" autoFocus value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Format")} htmlFor="cp-format"><Select id="cp-format" value={v.format} onChange={(e) => setV({ ...v, format: e.target.value as ContentFormat })}>{(Object.keys(FORMAT_LABELS) as ContentFormat[]).map((f) => <option key={f} value={f}>{t(FORMAT_LABELS[f])}</option>)}</Select></Field>
          {v.format !== "personal_post" ? <Field label={t("Brand")} htmlFor="cp-brand"><Select id="cp-brand" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value as "thirty" })}><option value="thirty">30/30 AI</option><option value="consulting">Valemont</option></Select></Field> : <p className="self-end text-[13px] text-text-2">{t("Personal posts are never tagged with a brand.")}</p>}
        </div>
        <Field label={t("Hook")} htmlFor="cp-hook" hint={t("The first 2 seconds or the first line.")}><Input id="cp-hook" value={v.hook} maxLength={500} onChange={(e) => setV({ ...v, hook: e.target.value })} /></Field>
        <Field label={t("Target persona")} htmlFor="cp-persona"><Input id="cp-persona" value={v.target_persona} maxLength={200} onChange={(e) => setV({ ...v, target_persona: e.target.value })} /></Field>
        <fieldset className="flex gap-4 text-sm"><legend className="mb-1 text-[13px] font-medium text-text-2">{t("Versions")}</legend>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={v.fr} onChange={(e) => setV({ ...v, fr: e.target.checked })} />{t("French (Théo)")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={v.es} onChange={(e) => setV({ ...v, es: e.target.checked })} />{t("Spanish (Pablo)")}</label>
        </fieldset>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending || !v.title.trim() || !(v.fr || v.es)}>{m.isPending ? t("Saving…") : t("Create")}</Button>
      </form>
    </Modal>
  );
}

/* ---------- piece drawer: production + FR/ES variants ---------- */

function PieceDrawer({ piece, studio, onClose }: { piece: Piece; studio: Studio; onClose: () => void }) {
  const t = useT();
  const save = useSave();
  const [v, setV] = React.useState({ title: piece.title, hook: piece.hook, target_persona: piece.target_persona, script: piece.script, asset_url: piece.asset_url });
  const [lang, setLang] = React.useState<string>(piece.variants.find((x) => x.language === "FR")?.language ?? piece.variants[0]?.language ?? "FR");
  const m = useMutation({ mutationFn: (patch: Record<string, unknown>) => api("/api/content", { method: "PATCH", body: { id: piece.id, expected_version: piece.version, patch } }), ...save(() => toast(t("Saved"))) });
  const dirty = v.title !== piece.title || v.hook !== piece.hook || v.target_persona !== piece.target_persona || v.script !== piece.script || v.asset_url !== piece.asset_url;
  const variant = piece.variants.find((x) => x.language === lang) ?? piece.variants[0];
  const prod = PRODUCTION_STAGES.includes(piece.column as never);
  return (
    <DetailPanel open onClose={onClose} title={<div><p className="truncate text-lg font-semibold">{piece.title}</p><p className="flex flex-wrap gap-2 text-[13px] text-text-2"><BrandTag brand={piece.brand} /><span>{t(FORMAT_LABELS[piece.format])}</span><span>· {t(STAGE_LABELS[piece.column])}</span></p></div>}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3">
          {prod ? <SegmentedSwitch size="sm" label={t("Step")} value={piece.stage as string} onChange={(s) => m.mutate({ stage: s })} options={PRODUCTION_STAGES.map((s) => ({ value: s, label: t(STAGE_LABELS[s]) }))} /> : <p className="text-[13px] text-text-2">{t("The versions drive this step: schedule or publish them below.")}</p>}
          <Field label={t("Title")} htmlFor="pd-title"><Input id="pd-title" value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label={t("Hook")} htmlFor="pd-hook"><Input id="pd-hook" value={v.hook} maxLength={500} onChange={(e) => setV({ ...v, hook: e.target.value })} /></Field>
          <Field label={t("Target persona")} htmlFor="pd-persona"><Input id="pd-persona" value={v.target_persona} maxLength={200} onChange={(e) => setV({ ...v, target_persona: e.target.value })} /></Field>
          <Field label={t("Script")} htmlFor="pd-script"><Textarea id="pd-script" rows={5} value={v.script} onChange={(e) => setV({ ...v, script: e.target.value })} /></Field>
          <Field label={t("Video in Drive (link)")} htmlFor="pd-asset" hint={t("Files stay in Drive; only the link is stored.")}><Input id="pd-asset" type="url" placeholder="https://drive.google.com/…" value={v.asset_url} onChange={(e) => setV({ ...v, asset_url: e.target.value })} /></Field>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!dirty || m.isPending} onClick={() => m.mutate(v)}>{m.isPending ? t("Saving…") : t("Save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("Archive this piece?"))) m.mutate({ is_archived: true }); }}>{t("Archive")}</Button>
          </div>
          {m.isError ? <ErrorState error={m.error} onRetry={() => m.reset()} /> : null}
        </section>
        {piece.variants.length > 1 ? <SegmentedSwitch label={t("Version")} value={lang} onChange={setLang} options={piece.variants.map((x) => ({ value: x.language, label: `${x.language} · ${FOUNDER_NAMES[x.owner_founder]}` }))} /> : null}
        {variant ? <VariantEditor key={variant.id + variant.version} piece={piece} variant={variant} studio={studio} /> : null}
      </div>
    </DetailPanel>
  );
}

function VariantEditor({ piece, variant, studio }: { piece: Piece; variant: Variant; studio: Studio }) {
  const t = useT();
  const save = useSave();
  const [v, setV] = React.useState({ caption: variant.caption, cta: variant.cta, destination_url: variant.destination_url, utm_source: variant.utm_source, utm_medium: variant.utm_medium, utm_campaign: variant.utm_campaign, utm_content: variant.utm_content, scheduled_date: variant.scheduled_date ?? "", slot_key: variant.slot_key, platform_post_url: variant.platform_post_url, checklist_done: variant.checklist_done });
  const m = useMutation({
    mutationFn: (x: { action: "save" | "schedule" | "unschedule" | "publish"; patch: Record<string, unknown> }) => api("/api/content/variants", { method: "PATCH", body: { id: variant.id, expected_version: variant.version, ...x } }),
    ...save(() => toast(t("Saved"))),
  });
  const items = studio.checklists[variant.platform === "instagram" ? "instagram" : "linkedin"];
  const link = utmUrl(v.destination_url, v);
  const patch = () => ({ ...v, scheduled_date: v.scheduled_date || undefined, destination_url: v.destination_url.trim(), platform_post_url: v.platform_post_url.trim() });
  const slotsFor = PUBLISHING_CALENDAR.filter((s) => s.key === v.slot_key || !v.scheduled_date || s.weekday === new Date(`${v.scheduled_date}T12:00:00Z`).getUTCDay());
  const missing = items.filter((i) => !v.checklist_done.includes(i.key)).length;
  return (
    <section className="flex flex-col gap-3" aria-label={t("Version {lang}", { lang: variant.language })}>
      <p className="text-[13px] text-text-2">{variant.account || t("No account linked")} · {t("Owner: {name}", { name: FOUNDER_NAMES[variant.owner_founder] })} · <span className="font-medium text-ink">{t(variant.status === "draft" ? "Draft" : STAGE_LABELS[variant.status])}</span></p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Publishing date")} htmlFor="vd-date"><Input id="vd-date" type="date" value={v.scheduled_date} onChange={(e) => setV({ ...v, scheduled_date: e.target.value })} /></Field>
        <Field label={t("Slot")} htmlFor="vd-slot"><Select id="vd-slot" value={v.slot_key} onChange={(e) => setV({ ...v, slot_key: e.target.value })}><option value="">{t("Outside the plan")}</option>{slotsFor.map((s) => <option key={s.key} value={s.key}>{t(WEEKDAYS[s.weekday])} · {t(s.label)}</option>)}</Select></Field>
      </div>
      <Field label={t("Caption")} htmlFor="vd-cap"><Textarea id="vd-cap" rows={3} value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} /></Field>
      <Field label={t("Call to action")} htmlFor="vd-cta"><Input id="vd-cta" value={v.cta} maxLength={300} onChange={(e) => setV({ ...v, cta: e.target.value })} /></Field>
      <Field label={t("Destination page")} htmlFor="vd-dest"><Input id="vd-dest" type="url" placeholder="https://" value={v.destination_url} onChange={(e) => setV({ ...v, destination_url: e.target.value })} /></Field>
      <details className="text-sm">
        <summary className="cursor-pointer text-[13px] font-semibold text-text-2">{t("UTM parameters")}</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const).map((k) => <Field key={k} label={k} htmlFor={`vd-${k}`}><Input id={`vd-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\w.-]/g, "") })} /></Field>)}
        </div>
      </details>
      {link ? (
        <p className="flex items-center gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate text-text-2">{link}</span>
          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(link); toast(t("Link copied")); }}><Copy className="size-4" />{t("Copy the link")}</Button></p>
      ) : null}
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold text-text-2">{t("Checklist {done}/{total}", { done: items.length - missing, total: items.length })}</legend>
        <ul className="flex flex-col gap-1">
          {items.map((i) => (
            <li key={i.key}><label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={v.checklist_done.includes(i.key)} onChange={(e) => setV({ ...v, checklist_done: e.target.checked ? [...v.checklist_done, i.key] : v.checklist_done.filter((k) => k !== i.key) })} />
              <span className={cn(v.checklist_done.includes(i.key) && "text-text-3 line-through")}>{t(i.label)}{i.key === "subtitles" ? ` (${variant.language})` : ""}</span>
            </label></li>
          ))}
        </ul>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate({ action: "save", patch: patch() })}>{t("Save")}</Button>
        {variant.status === "draft" ? <Button size="sm" variant="outline" disabled={m.isPending || !v.scheduled_date} onClick={() => m.mutate({ action: "schedule", patch: patch() })}>{t("Schedule")}</Button> : null}
        {variant.status === "scheduled" ? <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate({ action: "unschedule", patch: {} })}>{t("Unschedule")}</Button> : null}
      </div>
      {variant.status !== "published" ? (
        <div className="flex flex-col gap-2 rounded-[12px] border border-hairline p-3">
          <Field label={t("Post link (once it is out)")} htmlFor="vd-post"><Input id="vd-post" type="url" placeholder="https://" value={v.platform_post_url} onChange={(e) => setV({ ...v, platform_post_url: e.target.value })} /></Field>
          {missing ? <p className="text-[12px] text-bad">{t("{n} checklist step(s) not ticked.", { n: missing })}</p> : null}
          <Button size="sm" variant="primary" disabled={m.isPending} onClick={() => m.mutate({ action: "publish", patch: patch() })}>{t("Mark as published")}</Button>
        </div>
      ) : <MetricsEntry variant={variant} />}
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.reset()} /> : null}
      {piece.format === "story" ? <p className="text-[12px] text-text-3">{t("Instagram serves story numbers for 24 hours only, and none under 5 viewers.")}</p> : null}
    </section>
  );
}

function MetricsEntry({ variant }: { variant: Variant }) {
  const t = useT();
  const tag = useDateTag();
  const ig = variant.platform === "instagram";
  const fields = [ig ? "views" : "impressions", "reach", "likes", "comments", "saves", "shares", "profile_visits", "link_clicks", "site_visits", "leads"] as const;
  const [cp, setCp] = React.useState<string>(variant.checkpoints.find((c) => !c.snapshot)?.key ?? "h24");
  const current = variant.checkpoints.find((c) => c.key === cp)?.snapshot ?? null;
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-hairline p-3">
      <h3 className="text-sm font-semibold">{t("Numbers at a fixed age")}</h3>
      <ul className="grid grid-cols-4 gap-2 text-center">
        {variant.checkpoints.map((c) => (
          <li key={c.key} className="rounded-[8px] bg-subtle/60 p-1.5">
            <p className="text-[11px] text-text-3">{t(c.label)}</p>
            <p className="num text-sm font-semibold">{c.snapshot ? (c.snapshot.availability === "ok" ? ((ig ? c.snapshot.views : c.snapshot.impressions)?.toLocaleString(tag) ?? "—") : t("not available")) : "—"}</p>
            <p className="text-[10px] text-text-3">{c.snapshot ? (c.snapshot.source === "api" ? t("API") : t("entered by hand")) : ""}</p>
          </li>
        ))}
      </ul>
      {variant.stories.length ? <p className="text-[12px] text-text-2">{t("Story captured {n} time(s) while live.", { n: variant.stories.length })}</p> : null}
      <SegmentedSwitch size="sm" label={t("Checkpoint")} value={cp} onChange={setCp} options={CHECKPOINTS.map((c) => ({ value: c.key, label: t(c.label) }))} />
      {current?.source === "api" ? <p className="text-[12px] text-text-2">{t("Captured from the API; a number entered by hand would not replace it.")}</p> : null}
      <MetricsForm key={`${cp}:${current?.captured_at ?? ""}`} variant={variant} cp={cp} fields={fields} initial={Object.fromEntries(fields.map((f) => [f, current && current.source === "manual" && current[f] !== null ? String(current[f]) : ""]))} />
    </div>
  );
}
function MetricsForm({ variant, cp, fields, initial }: { variant: Variant; cp: string; fields: readonly string[]; initial: Record<string, string> }) {
  const t = useT();
  const save = useSave();
  const [vals, setVals] = React.useState<Record<string, string>>(initial);
  const m = useMutation({
    mutationFn: () => api("/api/content/metrics", { method: "PUT", body: { variant_id: variant.id, checkpoint: cp, ...Object.fromEntries(fields.map((f) => [f, vals[f] === "" || vals[f] === undefined ? null : Number(vals[f])])) } }),
    ...save(() => toast(t("Numbers saved"))),
  });
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => <Field key={f} label={t(METRIC_LABEL[f])} htmlFor={`me-${f}`}><Input id={`me-${f}`} type="number" inputMode="numeric" min={0} className="num" value={vals[f] ?? ""} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} /></Field>)}
      </div>
      <Button size="sm" variant="outline" disabled={m.isPending || Object.values(vals).every((x) => x === "")} onClick={() => m.mutate()}>{m.isPending ? t("Saving…") : t("Save the numbers")}</Button>
      <p className="text-[12px] text-text-3">{t("Recorded as entered by hand. Site visits and leads: from the analytics of the UTM link.")}</p>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </>
  );
}

/* ---------- compact card for the Growth dashboard ---------- */

/** Growth › Content: this week's goals, the next scheduled versions and a link to the studio. */
export function ContentStudioCard() {
  const t = useT();
  const q = useStudio(null);
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const next = d.calendar.flatMap((day) => [...day.slots.map((s) => s.variant), ...day.extra].filter((v): v is NonNullable<typeof v> => Boolean(v) && v!.status === "scheduled").map((v) => ({ ...v, date: day.date }))).filter((v) => v.date >= d.today).slice(0, 5);
  const done = d.targets.reduce((a, i) => a + Math.min(i.done, i.target), 0);
  const target = d.targets.reduce((a, i) => a + i.target, 0);
  return (
    <Panel>
      <PanelTitle action={<Link href="/marketing/content" className="text-sm font-medium underline underline-offset-2">{t("Open the Content Studio")}</Link>}>{t("Content Studio")}</PanelTitle>
      <p className="text-sm"><span className="num text-2xl font-semibold">{done}/{target}</span> <span className="text-text-2">{t("weekly video goals done")}</span></p>
      <p className="mt-1 text-[13px] text-text-2">{d.columns.filter((c) => c.count).map((c) => `${t(STAGE_LABELS[c.stage])} ${c.count}`).join(" · ") || t("No content yet")}</p>
      {next.length ? (
        <ul className="mt-3 flex flex-col divide-y divide-hairline text-sm">
          {next.map((v) => <li key={v.id} className="flex justify-between gap-3 py-1.5"><span className="truncate">{v.language} · {v.title}</span><span className="num shrink-0 text-text-3">{fmtDay(v.date)}</span></li>)}
        </ul>
      ) : <p className="mt-3 text-[13px] text-text-3">{t("Nothing scheduled for the rest of the week.")}</p>}
    </Panel>
  );
}
