"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Plus, RotateCcw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel } from "@/components/ui/overlay";
import { BRAND_LABELS, FOUNDERS, FOUNDER_NAMES, type Brand } from "@/domain/constants";
import { MARGIN_STATUS_LABELS, PROJECT_STATUS_LABELS, type MarginStatus, type ProjectAlert, type ProjectStatus } from "@/domain/delivery";
import { useDateTag, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn, formatEur } from "@/lib/utils";
import { BigNumber, Pill, fmtDay } from "./bits";
import { ConflictNotice } from "./conflict";
import { LocalSubscriptions } from "./clients-local";
import { PartnersRegistry } from "./clients-partners";
import { WonDialog } from "./won-project";
import { useMe } from "./providers";
import { CsvExportButton } from "./csv-tools";

type Cost = { founder: number; contractors: number; api: number; infra: number; other: number; total: number };
type Milestone = { id: string; version: number; title: string; due_date: string | null; done_at: string | null };
type Assignment = { id: string; version: number; vendor_id: string; vendorName: string; role: string; rate_minor: number; rate_unit: "hour" | "day" | "fixed"; planned_hours: number; start_date: string | null; end_date: string | null; status: string; overCapacity: boolean };
export type Project = {
  id: string; version: number; name: string; clientName: string; client_id: string; brand: Brand; market: "FR" | "ES" | null; owner_founder: "theo" | "pablo" | null; status: ProjectStatus;
  start_date: string; due_date: string | null; scope: string; services: { label: string; qty: number; unit_minor: number; kind: "one_off" | "monthly" }[]; checklist: { id: string; label: string; done: boolean }[];
  revenue_one_off_minor: number; mrr_minor: number; term_months: number | null; est_founder_hours: number; est_api_minor: number; est_infra_minor: number; est_other_minor: number;
  handoff_promised: string; handoff_stakeholders: string; handoff_success: string; source: "quote" | "offer";
  milestones: Milestone[]; assignments: Assignment[]; entries: { id: string; date: string; minutes: number; who: string; person_kind: string; note: string }[];
  costs: { id: string; date: string; kind: string; label: string; amount_minor: number }[]; tasks: { id: string; version: number; title: string; owner: string | null; status: string; due_at: string | null }[];
  estimate: Cost; actual: Cost & { direct: number; founderHours: number; contractorHours: number }; revenue: number; forecast: number; margin: { margin: number; pct: number | null; status: MarginStatus }; alerts: ProjectAlert[];
  hours: { estimated: number; actual: number };
};
type Overview = {
  today: string; hourCostMinor: number; guardrailPct: number; statuses: ProjectStatus[]; projects: Project[];
  runs: { id: string; status: string; subject_id: string; name: string; steps: Record<string, { status: string; error: string }>; last_error: string; updated_at: string }[];
  wonWaiting: { id: string; name: string; brand: Brand; account_id: string }[];
  vendors: { id: string; name: string; hourly_rate_minor: number | null; daily_rate_minor: number | null; fixed_rate_minor: number | null; currency: string; capacity_hours_week: number }[];
};

export const BRAND_DOT: Record<Brand, string> = { consulting: "bg-brand-consulting", local: "bg-brand-local", thirty: "bg-brand-thirty" };
const STEP_LABELS: Record<string, string> = { client: "Client", project: "Project", milestones: "Milestones", handoff: "Handoff" };

/** Mutation helper: server-confirmed save, refetch, conflicts and errors shown in the founder's language. */
export function useSave<B>(path: string, method: "POST" | "PATCH" | "PUT" = "POST", onDone?: (r: unknown) => void) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: (body: B) => api<unknown>(path, { method, body }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["clients"] }); qc.invalidateQueries({ queryKey: ["tasks"] }); onDone?.(r); },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) { toast(t("Someone else changed this record. Review both versions.")); qc.invalidateQueries({ queryKey: ["clients"] }); return; }
      toast(t((e as Error).message));
    },
  });
}

export function ClientsView() {
  const t = useT();
  const params = useSearchParams();
  const [tab, setTab] = React.useState<"projects" | "local" | "partners">(params.get("tab") === "local" ? "local" : params.get("tab") === "partners" ? "partners" : "projects");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Clients")}</h1>
          <p className="text-sm text-text-2">{t("Projects from won deals, delivery, costs and margin; Local subscriptions; contractors and tools.")}</p>
        </div>
        <div className="max-w-full overflow-x-auto [&_button]:whitespace-nowrap"><SegmentedSwitch label={t("Section")} value={tab} onChange={setTab} options={[{ value: "projects", label: t("Projects") }, { value: "local", label: t("Local subscriptions") }, { value: "partners", label: t("Partners & tools") }]} /></div>
        {tab === "projects" ? <CsvExportButton list="projects" /> : null}
      </div>
      {tab === "projects" ? <ProjectsTab /> : tab === "local" ? <LocalSubscriptions /> : <PartnersRegistry />}
    </div>
  );
}

function ProjectsTab() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const q = useQuery({ queryKey: ["clients"], queryFn: () => api<Overview>("/api/clients") });
  const [offer, setOffer] = React.useState<"all" | Brand>("all");
  const [market, setMarket] = React.useState<"all" | "FR" | "ES">("all");
  const [view, setView] = React.useState<"kanban" | "timeline">("kanban");
  const [won, setWon] = React.useState<Overview["wonWaiting"][number] | null>(null);
  const selected = params.get("project");
  const open = (id: string | null) => router.replace(id ? `/clients?project=${id}` : "/clients");
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const list = d.projects.filter((p) => (offer === "all" || p.brand === offer) && (market === "all" || p.market === market));
  const activeList = list.filter((p) => p.status !== "delivered");
  const current = d.projects.find((p) => p.id === selected) ?? null;
  const alerts = activeList.reduce((s, p) => s + p.alerts.filter((a) => a.kind !== "at_risk_margin").length, 0);
  return (
    <div className="flex gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <ResumePanel runs={d.runs} waiting={d.wonWaiting} onCreate={setWon} />
        <div className={cn("grid grid-cols-2 gap-3", !current && "lg:grid-cols-4")}>
          <BigNumber label={t("Active projects")} value={activeList.length} note={t("{n} delivered", { n: list.length - activeList.length })} />
          <BigNumber label={t("Revenue in progress")} value={formatEur(activeList.reduce((s, p) => s + p.revenue, 0))} note={t("one-off + MRR × term")} />
          <BigNumber dark label={t("Forecast gross margin")} value={formatEur(activeList.reduce((s, p) => s + p.margin.margin, 0))} note={t("revenue − max(estimated, actual) cost")} />
          <BigNumber label={t("Alerts")} value={alerts} note={t("overdue milestones, unassigned tasks, margin")} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedSwitch size="sm" label={t("Offer")} value={offer} onChange={setOffer} options={[{ value: "all", label: t("All") }, { value: "consulting", label: t("Consulting") }, { value: "local", label: t("Local") }, { value: "thirty", label: "30/30" }]} />
          <SegmentedSwitch size="sm" label={t("Market")} value={market} onChange={setMarket} options={[{ value: "all", label: t("All") }, { value: "FR", label: t("France") }, { value: "ES", label: t("Spain") }]} />
          <span className="flex-1" />
          <SegmentedSwitch size="sm" label={t("View")} value={view} onChange={setView} options={[{ value: "kanban", label: t("Kanban") }, { value: "timeline", label: t("Timeline") }]} />
        </div>
        {d.projects.length === 0 ? (
          <EmptyState title={t("No project yet")}>{t("Move a deal to Won in the CRM, then create the client and the project in one click.")}</EmptyState>
        ) : view === "kanban" ? <Kanban compact={Boolean(current)} projects={list} statuses={d.statuses} today={d.today} selected={selected} onOpen={open} /> : <Timeline projects={list} today={d.today} onOpen={open} />}
      </div>
      {current ? <ProjectPanel key={current.id} p={current} data={d} onClose={() => open(null)} /> : null}
      {won ? <WonDialog opportunityId={won.id} name={won.name} onClose={() => setWon(null)} onDone={(pid) => { setWon(null); if (pid) open(pid); }} /> : null}
    </div>
  );
}

/** Partial Won → Project runs are visible and resumable (spec 4.4); won deals not converted yet are listed too. */
function ResumePanel({ runs, waiting, onCreate }: { runs: Overview["runs"]; waiting: Overview["wonWaiting"]; onCreate: (w: Overview["wonWaiting"][number]) => void }) {
  const t = useT();
  const resume = useSave<{ opportunity_id: string }>("/api/clients/won", "POST", (r) => toast((r as { status: string }).status === "done" ? t("Client and project ready") : t("Stopped again: {error}", { error: t((r as { error: string }).error) })));
  if (!runs.length && !waiting.length) return null;
  return (
    <Panel className="py-4" aria-label={t("To finish")}>
      <PanelTitle>{t("To finish")}</PanelTitle>
      <ul className="flex flex-col">
        {runs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 border-t border-hairline py-2 first:border-t-0">
            <AlertTriangle className="size-4 text-bad" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.name} · {t(r.status === "failed" ? "Interrupted" : "In progress or interrupted")}</p>
              <p className="text-[12px] text-text-3">{Object.keys(STEP_LABELS).map((s) => `${t(STEP_LABELS[s])} ${r.steps[s]?.status === "done" ? "✓" : r.steps[s]?.status === "failed" ? "✗" : "…"}`).join(" · ")}</p>
            </div>
            <Button size="sm" variant="dark" disabled={resume.isPending} onClick={() => resume.mutate({ opportunity_id: r.subject_id })}><RotateCcw /> {t("Resume")}</Button>
          </li>
        ))}
        {waiting.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-3 border-t border-hairline py-2 first:border-t-0">
            <span aria-hidden className={cn("size-2.5 rounded-full", BRAND_DOT[w.brand])} />
            <p className="min-w-0 flex-1 text-sm"><span className="font-medium">{w.name}</span> · {t("won, no project yet")}</p>
            <Button size="sm" variant="primary" onClick={() => onCreate(w)}>{t("Create client & project")}</Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MarginPill({ status }: { status: MarginStatus }) {
  const t = useT();
  return <Pill tone={status === "healthy" ? "good" : status === "negative" ? "bad" : "neutral"}>{status === "healthy" ? <Check className="mr-1 size-3" /> : <AlertTriangle className="mr-1 size-3" />}{t(MARGIN_STATUS_LABELS[status])}</Pill>;
}

function Kanban({ projects, statuses, today, selected, onOpen, compact }: { compact: boolean; projects: Project[]; statuses: ProjectStatus[]; today: string; selected: string | null; onOpen: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  return (
    <div className={cn("grid gap-3", compact ? "md:grid-cols-2" : "md:grid-cols-3 xl:grid-cols-5")}>
      {statuses.map((s) => {
        const items = projects.filter((p) => p.status === s);
        return (
          <section key={s} aria-label={t(PROJECT_STATUS_LABELS[s])} className="flex min-h-40 flex-col gap-2 rounded-[20px] bg-subtle/60 p-2">
            <h2 className="px-2 pt-1 text-[13px] font-semibold text-text-2">{t(PROJECT_STATUS_LABELS[s])} <span className="num font-normal text-text-3">{items.length}</span></h2>
            {items.map((p) => {
              const next = p.milestones.find((m) => !m.done_at);
              const n = p.alerts.filter((a) => a.kind !== "at_risk_margin").length;
              return (
                <button key={p.id} type="button" onClick={() => onOpen(p.id)} aria-current={selected === p.id ? "true" : undefined}
                  className={cn("flex flex-col gap-1.5 rounded-[12px] bg-panel p-3 text-left hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)]", selected === p.id && "outline-2 outline-ink")}>
                  <span className="flex items-center gap-2 text-sm font-medium"><span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", BRAND_DOT[p.brand])} /><span className="truncate">{p.name}</span></span>
                  <span className="text-[12px] text-text-3">{[t(BRAND_LABELS[p.brand]), p.market, p.owner_founder ? FOUNDER_NAMES[p.owner_founder] : t("Unassigned")].filter(Boolean).join(" · ")}</span>
                  {next ? <span className={cn("text-[12px]", next.due_date && next.due_date < today ? "font-medium text-bad" : "text-text-2")}>{t(next.title)} · {next.due_date ? fmtDay(next.due_date, tag) : "—"}</span> : null}
                  <span className="flex flex-wrap items-center gap-1.5"><MarginPill status={p.margin.status} />{n ? <Pill tone="bad">{t("{n} alerts", { n })}</Pill> : null}</span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/** Simple timeline: one row per project from start to due date, milestones as dots, today as a line; the list below is the table view. */
function Timeline({ projects, today, onOpen }: { projects: Project[]; today: string; onOpen: (id: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const dates = projects.flatMap((p) => [p.start_date, p.due_date, ...p.milestones.map((m) => m.due_date)]).filter(Boolean) as string[];
  if (!projects.length || !dates.length) return <EmptyState title={t("Nothing to show")} />;
  const min = Date.parse([...dates, today].sort()[0]);
  const max = Date.parse([...dates, today].sort().at(-1)!);
  const span = Math.max(1, max - min);
  const x = (d: string) => `${((Date.parse(d) - min) / span) * 100}%`;
  const upcoming = projects.flatMap((p) => p.milestones.map((m) => ({ ...m, project: p }))).filter((m) => m.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  return (
    <Panel>
      <div className="flex justify-between text-[12px] text-text-3"><span className="num">{fmtDay(new Date(min).toISOString().slice(0, 10), tag)}</span><span className="num">{fmtDay(new Date(max).toISOString().slice(0, 10), tag)}</span></div>
      <ul className="mt-2 flex flex-col gap-3" aria-label={t("Timeline")}>
        {projects.map((p) => (
          <li key={p.id} className="grid grid-cols-[minmax(0,140px)_1fr] items-center gap-3">
            <button type="button" onClick={() => onOpen(p.id)} className="truncate text-left text-sm font-medium hover:underline">{p.name}</button>
            <div className="relative h-6">
              <div className="absolute inset-y-[11px] h-0.5 bg-hairline" style={{ left: 0, right: 0 }} />
              <div className={cn("absolute top-[9px] h-1.5 rounded-full", BRAND_DOT[p.brand])} style={{ left: x(p.start_date), width: `calc(${x(p.due_date ?? p.start_date)} - ${x(p.start_date)})` }} />
              <div aria-hidden className="absolute inset-y-0 w-px bg-ink/60" style={{ left: x(today) }} />
              {p.milestones.filter((m) => m.due_date).map((m) => (
                <span key={m.id} title={`${t(m.title)} · ${m.due_date}`} className={cn("absolute top-[6px] size-3 -translate-x-1/2 rounded-full border-2", m.done_at ? "border-win bg-win" : m.due_date! < today ? "border-bad bg-panel" : "border-ink bg-panel")} style={{ left: x(m.due_date!) }} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-x-3 text-[12px] text-text-3"><span>● {t("done")}</span><span>○ {t("to come")}</span><span className="text-bad">○ {t("overdue")}</span><span>| {t("today")}</span></p>
      <table className="mt-4 w-full text-left text-sm">
        <thead><tr className="text-[12px] text-text-3"><th className="font-medium">{t("Date")}</th><th className="font-medium">{t("Project")}</th><th className="font-medium">{t("Milestone")}</th></tr></thead>
        <tbody>{upcoming.slice(0, 12).map((m) => (
          <tr key={m.id} className="border-t border-hairline"><td className={cn("num py-1.5 pr-3", !m.done_at && m.due_date! < today && "text-bad")}>{fmtDay(m.due_date!, tag)}</td><td className="pr-3">{m.project.name}</td><td>{t(m.title)}{m.done_at ? ` · ${t("done")}` : ""}</td></tr>
        ))}</tbody>
      </table>
    </Panel>
  );
}

function alertText(a: ProjectAlert, t: ReturnType<typeof useT>, tag: string) {
  if (a.kind === "overdue_milestone") return t("Overdue milestone: {title} ({date})", { title: t(a.title), date: fmtDay(a.due, tag) });
  if (a.kind === "unassigned_tasks") return t("Tasks without an owner: {n}", { n: a.count });
  if (a.kind === "negative_margin") return t("Potential negative margin: {x}", { x: formatEur(a.marginMinor) });
  if (a.kind === "over_capacity") return t("{name} is planned above their weekly capacity", { name: a.vendor });
  return t("Margin under the guardrail ({pct} %)", { pct: a.pct ?? "—" });
}

function ProjectPanel({ p, data, onClose }: { p: Project; data: Overview; onClose: () => void }) {
  const t = useT();
  const tag = useDateTag();
  const upd = useSave<{ id: string; expected_version: number; patch: Record<string, unknown> }>("/api/clients/projects", "PATCH");
  const patch = (x: Record<string, unknown>) => upd.mutate({ id: p.id, expected_version: p.version, patch: x });
  return (
    <DetailPanel open onClose={onClose}
      title={<div><h2 className="truncate text-lg font-semibold">{p.name}</h2><p className="text-[13px] text-text-2">{[p.clientName, t(BRAND_LABELS[p.brand]), p.market, p.source === "quote" ? t("from the accepted quote") : t("from the offer (no accepted quote)")].filter(Boolean).join(" · ")}</p></div>}>
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Status")} htmlFor="pj-status"><Select id="pj-status" value={p.status} onChange={(e) => patch({ status: e.target.value })}>{data.statuses.map((s) => <option key={s} value={s}>{t(PROJECT_STATUS_LABELS[s])}</option>)}</Select></Field>
          <Field label={t("Owner")} htmlFor="pj-owner"><Select id="pj-owner" value={p.owner_founder ?? ""} onChange={(e) => patch({ owner_founder: e.target.value || null })}><option value="">{t("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
        </div>
        {p.alerts.length ? <ul className="flex flex-col gap-1.5" aria-label={t("Alerts")}>{p.alerts.map((a, n) => <li key={n} className="flex items-start gap-2 rounded-[12px] bg-[#fbeceb] px-3 py-2 text-sm text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{alertText(a, t, tag)}</li>)}</ul> : null}
        <MarginBlock p={p} hourCost={data.hourCostMinor} guardrail={data.guardrailPct} />
        <Milestones p={p} today={data.today} />
        <Checklist p={p} onSave={(checklist) => patch({ checklist })} />
        <ProjectTasks p={p} />
        <Hours p={p} today={data.today} />
        <Contractors p={p} vendors={data.vendors} />
        <DirectCosts p={p} today={data.today} />
        <Handoff key={p.version} p={p} />
        {p.services.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">{t("Services sold")}</h3>
            <ul className="text-sm">{p.services.map((s, n) => <li key={n} className="flex justify-between gap-2 border-t border-hairline py-1.5 first:border-t-0"><span>{t(s.label)}{s.qty !== 1 ? ` × ${s.qty}` : ""}</span><span className="num text-text-2">{formatEur(Math.round(s.qty * s.unit_minor))}{s.kind === "monthly" ? ` ${t("/ month")}` : ""}</span></li>)}</ul>
          </section>
        ) : null}
      </div>
    </DetailPanel>
  );
}

function MarginBlock({ p, hourCost, guardrail }: { p: Project; hourCost: number; guardrail: number }) {
  const t = useT();
  const [edit, setEdit] = React.useState(false);
  const rows: [string, number, number][] = [
    ["Founder time", p.estimate.founder, p.actual.founder], ["Contractors", p.estimate.contractors, p.actual.contractors],
    ["API and usage", p.estimate.api, 0], ["Infrastructure", p.estimate.infra, 0], ["Other estimated costs", p.estimate.other, 0], ["Direct costs booked", 0, p.actual.direct],
  ];
  return (
    <section aria-label={t("Margin")}>
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("Costs and margin")}</h3><MarginPill status={p.margin.status} /></div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-[12px] bg-subtle p-2"><p className="text-[12px] text-text-2">{t("Revenue")}</p><p className="num font-semibold">{formatEur(p.revenue)}</p></div>
        <div className="rounded-[12px] bg-subtle p-2"><p className="text-[12px] text-text-2">{t("Forecast cost")}</p><p className="num font-semibold">{formatEur(p.forecast)}</p></div>
        <div className="rounded-[12px] bg-ink p-2 text-panel"><p className="text-[12px] text-panel/80">{t("Gross margin")}</p><p className="num font-semibold">{formatEur(p.margin.margin)}{p.margin.pct !== null ? ` · ${p.margin.pct} %` : ""}</p></div>
      </div>
      <table className="mt-3 w-full text-left text-[13px]">
        <thead><tr className="text-text-3"><th className="font-medium" /><th className="text-right font-medium">{t("Estimated")}</th><th className="text-right font-medium">{t("Actual")}</th></tr></thead>
        <tbody>
          {rows.filter(([, e, a]) => e || a).map(([l, e, a]) => <tr key={l} className="border-t border-hairline"><td className="py-1">{t(l)}</td><td className="num text-right">{formatEur(e)}</td><td className="num text-right">{formatEur(a)}</td></tr>)}
          <tr className="border-t border-hairline font-semibold"><td className="py-1">{t("Total")}</td><td className="num text-right">{formatEur(p.estimate.total)}</td><td className="num text-right">{formatEur(p.actual.total)}</td></tr>
          <tr className="border-t border-hairline text-text-2"><td className="py-1">{t("Hours")}</td><td className="num text-right">{p.hours.estimated} h</td><td className="num text-right">{p.hours.actual} h</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-text-3">{t("Revenue: one-off {a} + MRR {m} × {k} months. Founder hour {h}. Status: negative below 0, at risk under {g} %.", { a: formatEur(p.revenue_one_off_minor), m: formatEur(p.mrr_minor), k: Math.max(1, p.term_months ?? 1), h: formatEur(hourCost), g: guardrail })}</p>
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEdit((v) => !v)}>{edit ? t("Close") : t("Edit estimates")}</Button>
      {edit ? <EstimatesForm p={p} onDone={() => setEdit(false)} /> : null}
    </section>
  );
}

function EstimatesForm({ p, onDone }: { p: Project; onDone: () => void }) {
  const t = useT();
  const [v, setV] = React.useState({ est_founder_hours: String(p.est_founder_hours), est_api_eur: String(p.est_api_minor / 100), est_infra_eur: String(p.est_infra_minor / 100), term_months: p.term_months === null ? "" : String(p.term_months) });
  const m = useSave("/api/clients/projects", "PATCH", onDone);
  const n = (s: string) => Number(s.replace(",", ".")) || 0;
  return (
    <form className="mt-2 grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate({ id: p.id, expected_version: p.version, patch: { est_founder_hours: Math.round(n(v.est_founder_hours)), est_api_eur: n(v.est_api_eur), est_infra_eur: n(v.est_infra_eur), term_months: v.term_months ? Math.max(1, Math.round(n(v.term_months))) : null } }); }}>
      <Field label={t("Founder hours")} htmlFor="es-h"><Input id="es-h" inputMode="numeric" value={v.est_founder_hours} onChange={(e) => setV({ ...v, est_founder_hours: e.target.value })} /></Field>
      <Field label={t("Term (months)")} htmlFor="es-t"><Input id="es-t" inputMode="numeric" value={v.term_months} onChange={(e) => setV({ ...v, term_months: e.target.value })} /></Field>
      <Field label={t("API and usage (€)")} htmlFor="es-a"><Input id="es-a" inputMode="decimal" value={v.est_api_eur} onChange={(e) => setV({ ...v, est_api_eur: e.target.value })} /></Field>
      <Field label={t("Infrastructure (€)")} htmlFor="es-i"><Input id="es-i" inputMode="decimal" value={v.est_infra_eur} onChange={(e) => setV({ ...v, est_infra_eur: e.target.value })} /></Field>
      <Button type="submit" size="sm" variant="dark" className="col-span-2" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
    </form>
  );
}

function Milestones({ p, today }: { p: Project; today: string }) {
  const t = useT();
  const tag = useDateTag();
  const toggle = useSave<{ id: string; expected_version: number; patch: { done: boolean } }>("/api/clients/milestones", "PATCH");
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const add = useSave("/api/clients/milestones", "POST", () => { setTitle(""); setDue(""); setId(crypto.randomUUID()); });
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Milestones")}</h3>
      <ul className="flex flex-col">{p.milestones.map((m) => (
        <li key={m.id} className="flex items-center gap-2 border-t border-hairline py-1.5 text-sm first:border-t-0">
          <input type="checkbox" className="size-4" aria-label={t("Done: {title}", { title: t(m.title) })} checked={Boolean(m.done_at)} onChange={(e) => toggle.mutate({ id: m.id, expected_version: m.version, patch: { done: e.target.checked } })} />
          <span className={cn("flex-1", m.done_at && "text-text-3 line-through")}>{t(m.title)}</span>
          <span className={cn("num text-[12px]", !m.done_at && m.due_date && m.due_date < today ? "font-medium text-bad" : "text-text-3")}>{m.due_date ? fmtDay(m.due_date, tag) : "—"}</span>
        </li>
      ))}</ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate({ id, project_id: p.id, title, due_date: due }); }}>
        <Input aria-label={t("New milestone")} placeholder={t("New milestone")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Input aria-label={t("Due date")} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-36 shrink-0" />
        <Button type="submit" size="icon" aria-label={t("Add")} disabled={!title.trim() || add.isPending}><Plus /></Button>
      </form>
    </section>
  );
}

function Checklist({ p, onSave }: { p: Project; onSave: (c: Project["checklist"]) => void }) {
  const t = useT();
  const [label, setLabel] = React.useState("");
  const done = p.checklist.filter((c) => c.done).length;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Delivery checklist")} <span className="num font-normal text-text-3">{done}/{p.checklist.length}</span></h3>
      <ul className="flex flex-col gap-1">{p.checklist.map((c) => (
        <li key={c.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={c.done} onChange={(e) => onSave(p.checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)))} /><span className={cn(c.done && "text-text-3 line-through")}>{t(c.label)}</span></label></li>
      ))}</ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (label.trim()) { onSave([...p.checklist, { id: crypto.randomUUID().slice(0, 8), label: label.trim(), done: false }]); setLabel(""); } }}>
        <Input aria-label={t("New checklist item")} placeholder={t("New checklist item")} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={300} />
        <Button type="submit" size="icon" aria-label={t("Add")} disabled={!label.trim()}><Plus /></Button>
      </form>
    </section>
  );
}

function ProjectTasks({ p }: { p: Project }) {
  const t = useT();
  const me = useMe();
  const [title, setTitle] = React.useState("");
  const [owner, setOwner] = React.useState<string>(me.founder);
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const add = useSave("/api/clients/tasks", "POST", () => { setTitle(""); setId(crypto.randomUUID()); });
  const upd = useSave<{ id: string; expected_version: number; patch: Record<string, unknown> }>("/api/tasks", "PATCH");
  const open = p.tasks.filter((x) => x.status !== "cancelled");
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Tasks")} <span className="num font-normal text-text-3">{open.filter((x) => x.status === "done").length}/{open.length}</span></h3>
      <ul className="flex flex-col">{open.map((x) => (
        <li key={x.id} className="flex items-center gap-2 border-t border-hairline py-1.5 text-sm first:border-t-0">
          <input type="checkbox" className="size-4" aria-label={t("Done: {title}", { title: x.title })} checked={x.status === "done"} onChange={(e) => upd.mutate({ id: x.id, expected_version: x.version, patch: { status: e.target.checked ? "done" : "todo" } })} />
          <span className={cn("min-w-0 flex-1 truncate", x.status === "done" && "text-text-3 line-through")}>{x.title}</span>
          <Select aria-label={t("Owner")} className={cn("h-8 w-28 text-[13px]", !x.owner && "border-bad text-bad")} value={x.owner ?? ""} onChange={(e) => upd.mutate({ id: x.id, expected_version: x.version, patch: { owner: e.target.value || null } })}>
            <option value="">{t("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}
          </Select>
        </li>
      ))}</ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate({ id, project_id: p.id, title, owner: owner || null }); }}>
        <Input aria-label={t("New task")} placeholder={t("New task")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        <Select aria-label={t("Owner")} className="w-28" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{t("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select>
        <Button type="submit" size="icon" aria-label={t("Add")} disabled={!title.trim() || add.isPending}><Plus /></Button>
      </form>
    </section>
  );
}

function Hours({ p, today }: { p: Project; today: string }) {
  const t = useT();
  const tag = useDateTag();
  const me = useMe();
  const [who, setWho] = React.useState<string>(me.founder);
  const [hours, setHours] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const add = useSave("/api/clients/time", "POST", () => { setHours(""); setId(crypto.randomUUID()); });
  const people = [...FOUNDERS.map((f) => [f, FOUNDER_NAMES[f]] as const), ...p.assignments.filter((a) => a.status !== "cancelled").map((a) => [`v:${a.vendor_id}`, a.vendorName] as const)];
  const h = Number(hours.replace(",", "."));
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Time spent")} <span className="num font-normal text-text-3">{t("{a} h of {e} h estimated", { a: p.hours.actual, e: p.hours.estimated })}</span></h3>
      <ul className="flex flex-col">{p.entries.slice(0, 5).map((e) => <li key={e.id} className="flex justify-between gap-2 border-t border-hairline py-1 text-[13px] first:border-t-0"><span>{e.person_kind === "founder" ? FOUNDER_NAMES[e.who as "theo"] ?? e.who : e.who}{e.note ? ` · ${e.note}` : ""}</span><span className="num text-text-3">{fmtDay(e.date, tag)} · {Math.round((e.minutes / 60) * 10) / 10} h</span></li>)}</ul>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (h > 0) add.mutate({ id, project_id: p.id, person_kind: who.startsWith("v:") ? "contractor" : "founder", founder_key: who.startsWith("v:") ? null : who, vendor_id: who.startsWith("v:") ? who.slice(2) : "", date, hours: h, note: "" }); }}>
        <Select aria-label={t("Who")} className="w-36" value={who} onChange={(e) => setWho(e.target.value)}>{people.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select>
        <Input aria-label={t("Date")} type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input aria-label={t("Hours")} inputMode="decimal" placeholder={t("Hours")} className="w-20" value={hours} onChange={(e) => setHours(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={!(h > 0) || add.isPending}>{t("Log hours")}</Button>
      </form>
    </section>
  );
}

function Contractors({ p, vendors }: { p: Project; vendors: Overview["vendors"] }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const upd = useSave<{ id: string; expected_version: number; patch: Record<string, unknown> }>("/api/clients/assignments", "PATCH");
  const unit = (u: string) => t(u === "hour" ? "/ h" : u === "day" ? "/ day" : "fixed");
  return (
    <section>
      <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t("Contractors")}</h3><Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? t("Close") : t("Assign a contractor")}</Button></div>
      {p.assignments.length === 0 && !open ? <p className="text-sm text-text-2">{t("No contractor on this project.")}</p> : null}
      <ul className="flex flex-col">{p.assignments.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2 border-t border-hairline py-1.5 text-sm first:border-t-0">
          <span className="min-w-0 flex-1"><span className="font-medium">{a.vendorName}</span>{a.role ? ` · ${a.role}` : ""}<span className="block text-[12px] text-text-3">{formatEur(a.rate_minor)} {unit(a.rate_unit)} · {t("{n} h planned", { n: a.planned_hours })}</span>{a.overCapacity ? <span className="block text-[12px] font-medium text-bad">{t("Over weekly capacity")}</span> : null}</span>
          <Select aria-label={t("Status")} className="h-8 w-28 text-[13px]" value={a.status} onChange={(e) => upd.mutate({ id: a.id, expected_version: a.version, patch: { status: e.target.value } })}>
            {["planned", "active", "done", "cancelled"].map((s) => <option key={s} value={s}>{t(s === "planned" ? "Planned" : s === "active" ? "Active" : s === "done" ? "Done" : "Cancelled")}</option>)}
          </Select>
        </li>
      ))}</ul>
      {open ? <AssignForm p={p} vendors={vendors} onDone={() => setOpen(false)} /> : null}
    </section>
  );
}

function AssignForm({ p, vendors, onDone }: { p: Project; vendors: Overview["vendors"]; onDone: () => void }) {
  const t = useT();
  const [id] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ vendor_id: "", role: "", rate: "", unit: "hour" as "hour" | "day" | "fixed", hours: "", start: p.start_date, end: p.due_date ?? "" });
  const m = useSave("/api/clients/assignments", "POST", (r) => {
    const x = r as { capacity: { plannedPerWeek: number; capacity: number; over: boolean }; rateExpired: boolean; ndaSigned: boolean };
    if (x.capacity.over) toast(t("Warning: {p} h/week planned for a capacity of {c} h/week.", { p: x.capacity.plannedPerWeek, c: x.capacity.capacity }));
    else toast(t("Assigned · {p} h/week of {c} h/week", { p: x.capacity.plannedPerWeek, c: x.capacity.capacity }));
    if (x.rateExpired) toast(t("The contractor's rate is past its validity date: confirm it."));
    if (!x.ndaSigned) toast(t("No signed NDA with this contractor yet."));
    onDone();
  });
  const pick = (vid: string) => {
    const x = vendors.find((y) => y.id === vid);
    const unit = x?.hourly_rate_minor ? "hour" : x?.daily_rate_minor ? "day" : x?.fixed_rate_minor ? "fixed" : "hour";
    const rate = unit === "hour" ? x?.hourly_rate_minor : unit === "day" ? x?.daily_rate_minor : x?.fixed_rate_minor;
    setV({ ...v, vendor_id: vid, unit, rate: rate ? String(rate / 100) : "" });
  };
  if (!vendors.length) return <p className="text-sm text-text-2">{t("Add a contractor first in Partners & tools.")}</p>;
  const n = (s: string) => Number(s.replace(",", "."));
  return (
    <form className="mt-2 grid grid-cols-2 gap-2 rounded-[12px] bg-subtle p-3" onSubmit={(e) => { e.preventDefault(); m.mutate({ id, project_id: p.id, vendor_id: v.vendor_id, role: v.role, rate_eur: n(v.rate) || 0, rate_unit: v.unit, planned_hours: Math.round(n(v.hours) || 0), start_date: v.start, end_date: v.end, note: "" }); }}>
      <Field label={t("Contractor")} htmlFor="as-v" className="col-span-2"><Select id="as-v" value={v.vendor_id} onChange={(e) => pick(e.target.value)} required><option value="">—</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
      <Field label={t("Role")} htmlFor="as-r" className="col-span-2"><Input id="as-r" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} maxLength={200} /></Field>
      <Field label={t("Rate (€)")} htmlFor="as-rate"><Input id="as-rate" inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} required /></Field>
      <Field label={t("Unit")} htmlFor="as-u"><Select id="as-u" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as "hour" })}><option value="hour">{t("per hour")}</option><option value="day">{t("per day")}</option><option value="fixed">{t("fixed fee")}</option></Select></Field>
      <Field label={t("Planned hours")} htmlFor="as-h"><Input id="as-h" inputMode="numeric" value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} required /></Field>
      <span />
      <Field label={t("Start")} htmlFor="as-s"><Input id="as-s" type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
      <Field label={t("End")} htmlFor="as-e"><Input id="as-e" type="date" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></Field>
      <Button type="submit" size="sm" variant="dark" className="col-span-2" disabled={!v.vendor_id || m.isPending}>{m.isPending ? t("Saving…") : t("Assign")}</Button>
    </form>
  );
}

function DirectCosts({ p, today }: { p: Project; today: string }) {
  const t = useT();
  const tag = useDateTag();
  const [v, setV] = React.useState({ kind: "api", label: "", amount: "", date: today });
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const add = useSave("/api/clients/costs", "POST", () => { setV({ ...v, label: "", amount: "" }); setId(crypto.randomUUID()); });
  const KIND: Record<string, string> = { api: "API and usage", infra: "Infrastructure", contractor: "Contractor invoice", other: "Other" };
  const amount = Number(v.amount.replace(",", "."));
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t("Direct costs")} <span className="num font-normal text-text-3">{formatEur(p.actual.direct)}</span></h3>
      <ul className="flex flex-col">{p.costs.slice(0, 6).map((c) => <li key={c.id} className="flex justify-between gap-2 border-t border-hairline py-1 text-[13px] first:border-t-0"><span>{c.label} · {t(KIND[c.kind] ?? c.kind)}</span><span className="num text-text-3">{fmtDay(c.date, tag)} · {formatEur(c.amount_minor)}</span></li>)}</ul>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (v.label.trim() && amount >= 0) add.mutate({ id, project_id: p.id, date: v.date, kind: v.kind, label: v.label, amount_eur: amount, tool_id: "" }); }}>
        <Select aria-label={t("Kind")} className="w-36" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select>
        <Input aria-label={t("Label")} placeholder={t("Label")} className="min-w-28 flex-1" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} maxLength={200} />
        <Input aria-label={t("Amount (€)")} placeholder="€" inputMode="decimal" className="w-24" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        <Button type="submit" size="sm" variant="outline" disabled={!v.label.trim() || !v.amount || add.isPending}>{t("Add cost")}</Button>
      </form>
    </section>
  );
}

function Handoff({ p }: { p: Project }) {
  const t = useT();
  const qc = useQueryClient();
  const [edit, setEdit] = React.useState(false);
  const [v, setV] = React.useState({ handoff_promised: p.handoff_promised, handoff_stakeholders: p.handoff_stakeholders, handoff_success: p.handoff_success });
  const [conflict, setConflict] = React.useState<Record<string, unknown> | null>(null);
  const [version, setVersion] = React.useState(p.version);
  const m = useMutation({
    mutationFn: (ver: number) => api("/api/clients/projects", { method: "PATCH", body: { id: p.id, expected_version: ver, patch: v } }),
    onSuccess: () => { setConflict(null); setEdit(false); qc.invalidateQueries({ queryKey: ["clients"] }); },
    onError: (e) => { if (e instanceof ApiError && e.isConflict) setConflict(e.body.current ?? {}); else toast(t((e as Error).message)); },
  });
  const rows: [keyof typeof v, string][] = [["handoff_promised", "What was promised"], ["handoff_stakeholders", "Stakeholders"], ["handoff_success", "Success criteria"]];
  return (
    <section>
      <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t("Handoff")}</h3><Button size="sm" variant="ghost" onClick={() => setEdit((e) => !e)}>{edit ? t("Close") : t("Edit")}</Button></div>
      {edit ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
          {rows.map(([k, l]) => <Field key={k} label={t(l)} htmlFor={`ho-${k}`}><Textarea id={`ho-${k}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} maxLength={2_000} /></Field>)}
          {conflict ? <ConflictNotice mine={v} current={conflict} fields={rows.map(([k]) => k)} onKeepTheirs={() => { setConflict(null); setEdit(false); qc.invalidateQueries({ queryKey: ["clients"] }); }} onApplyMine={() => { const cv = Number(conflict.version); setVersion(cv); m.mutate(cv); }} /> : null}
          <Button type="submit" size="sm" variant="dark" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
        </form>
      ) : (
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">{rows.map(([k, l]) => <React.Fragment key={k}><dt className="text-text-3">{t(l)}</dt><dd className="whitespace-pre-line">{p[k] || "—"}</dd></React.Fragment>)}</dl>
      )}
    </section>
  );
}
