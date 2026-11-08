"use client";
import { useMutation, useMutationState } from "@tanstack/react-query";
import { Circle, Clock, Copy, Phone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import { METRICS, METRIC_LABELS, WORK_MODES, WORK_MODE_LABELS, type ActivityType, type Metric } from "@/domain/constants";
import { METRIC_OF_TYPE } from "@/domain/activity";
import { api } from "@/lib/api";
import { cn, timeOfDay } from "@/lib/utils";
import { ActionMeter } from "./action-meter";
import { QUICK_KINDS, useQuickAction, type QuickKind } from "./quick-action";
import { TargetsEditor } from "./targets-editor";
import { useMyDay, type MyDayData } from "./use-crm";
import { useQueryClient } from "@tanstack/react-query";

const METRIC_KIND: Partial<Record<Metric, QuickKind>> = {
  calls: "call", field_visits: "visit", dms: "dm", invitations: "invitation", inmails: "inmail", cold_emails: "email", follow_ups: "follow_up", comments: "comment",
};

export function MyDayView() {
  const q = useMyDay();
  const qa = useQuickAction();
  const [focus, setFocus] = React.useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("vos-focus") === "1"; } catch { return false; } // per-viewer convenience only
  });
  const [editor, setEditor] = React.useState(false);
  const [report, setReport] = React.useState(false);
  const [allFollowUps, setAllFollowUps] = React.useState(false);
  const [allLog, setAllLog] = React.useState(false);
  const toggleFocus = () => setFocus((f) => { try { localStorage.setItem("vos-focus", f ? "0" : "1"); } catch { /* ignore */ } return !f; });

  // Pending ticks: activities being saved right now (hollow until the server confirms).
  const pendingTypes = useMutationState({ filters: { mutationKey: ["log-activity"], status: "pending" }, select: (m) => (m.state.variables as { activity_type?: ActivityType } | undefined)?.activity_type });
  const pendingByMetric: Partial<Record<Metric, number>> = {};
  for (const t of pendingTypes) { const m = t ? METRIC_OF_TYPE[t] : undefined; if (m) pendingByMetric[m] = (pendingByMetric[m] ?? 0) + 1; }

  if (q.isPending) return <div className="flex flex-col gap-4"><Skeleton className="h-36" /><Skeleton className="h-72" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const active = d.targets ? METRICS.filter((m) => d.targets![m].target > 0) : [];

  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My Day</h1>
            <p className="text-sm text-text-2">
              {d.today} · {d.mode ? WORK_MODE_LABELS[d.mode] : "No mode set"} · day closes at {timeOfDay(d.cutoffAt, d.timezone)} ({d.timezone})
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReport(true)} className={focus ? "hidden" : ""}><Copy /> WhatsApp report</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditor(true)} className={focus ? "hidden" : ""}>Mode & targets</Button>
            <Button variant="outline" size="sm" aria-pressed={focus} onClick={toggleFocus}>{focus ? "Exit focus" : "Focus"}</Button>
          </div>
        </div>

        <NextActionCard d={d} onOnboard={() => setEditor(true)} />

        {d.mode ? (
          <Panel aria-labelledby="meters-title">
            <PanelTitle action={d.attainment !== null && !focus ? (
              <div className="rounded-[12px] bg-ink px-4 py-2 text-panel" title="Weighted attainment: each target is capped at 100% so one channel cannot compensate for another.">
                <span className="num text-[28px] font-semibold leading-none tracking-tight">{Math.round(d.attainment * 100)}%</span>
                <span className="ml-2 text-[12px] text-panel/80">of target, weighted</span>
              </div>
            ) : null}>
              <span id="meters-title">Today&apos;s targets</span>
            </PanelTitle>
            {!d.isWorkday ? (
              <EmptyState title="Not a scheduled workday">Nothing is expected today and nothing counts against you. Logged activity still updates the CRM.</EmptyState>
            ) : active.length === 0 ? (
              <EmptyState title="No targets in this mode" action={<Button size="sm" onClick={() => setEditor(true)}>Set targets</Button>}>Targets are optional. Without targets no day is marked missed.</EmptyState>
            ) : (
              <div className="divide-y divide-hairline">
                {active.map((m) => (
                  <ActionMeter key={m} label={METRIC_LABELS[m]} actual={d.tally[m]} target={d.targets![m].target} pending={pendingByMetric[m] ?? 0}
                    onLog={METRIC_KIND[m] ? () => qa.open({ kind: METRIC_KIND[m] }) : m === "new_businesses" ? () => qa.open({ kind: "visit" }) : undefined} />
                ))}
              </div>
            )}
            {d.feasibility && !focus ? (
              <p className={cn("mt-3 flex items-center gap-2 text-[13px]", d.feasibility.feasible ? "text-text-2" : "text-bad")}>
                <Clock className="size-3.5" />
                Planned <span className="num">{d.feasibility.plannedMinutes}</span> min of outreach against <span className="num">{d.feasibility.capacityMinutes}</span> min capacity
                {d.feasibility.feasible ? "" : ` (${d.feasibility.overBy} min over: lower a target for tomorrow)`}
              </p>
            ) : null}
          </Panel>
        ) : null}

        {!focus ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel aria-labelledby="fu-title">
              <PanelTitle action={d.followUps.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setAllFollowUps((v) => !v)}>{allFollowUps ? "Show fewer" : `See all ${d.followUps.length}`}</Button> : null}>
                <span id="fu-title">Due follow-ups <span className="num text-text-3">{d.followUps.length}</span></span>
              </PanelTitle>
              {d.followUps.length === 0 ? (
                <p className="text-sm text-text-2">No follow-ups due. That counts as fulfilled.</p>
              ) : (
                <ul className="flex flex-col">
                  {(allFollowUps ? d.followUps : d.followUps.slice(0, 5)).map((f) => (
                    <li key={f.key} className="flex items-center gap-3 border-t border-hairline py-2.5 first:border-t-0">
                      <button type="button" aria-label={`Log follow-up for ${f.accountName}`} onClick={() => qa.open({ kind: "follow_up", accountId: f.accountId, opportunityId: f.opportunityId ?? undefined })}
                        className="flex size-11 shrink-0 items-center justify-center rounded-full text-control hover:text-ink">
                        <Circle className="size-6" strokeWidth={1.5} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{f.action}</p>
                        <p className={cn("truncate text-[13px]", f.overdue ? "text-bad" : "text-text-2")}>{f.accountName} · {f.why}</p>
                      </div>
                      {f.phone ? <a href={`tel:${f.phone}`} className="flex size-11 items-center justify-center rounded-full text-text-2 hover:bg-subtle" aria-label={`Call ${f.accountName}`}><Phone className="size-4" /></a> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[12px] text-text-3">Opening a phone or LinkedIn link never counts as done. Log the outcome.</p>
            </Panel>

            <Panel aria-labelledby="log-title">
              <PanelTitle action={d.todayEvents.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setAllLog((v) => !v)}>{allLog ? "Show fewer" : `See all ${d.todayEvents.length}`}</Button> : null}>
                <span id="log-title">Logged today <span className="num text-text-3">{d.todayEvents.length}</span></span>
              </PanelTitle>
              {d.todayEvents.length === 0 ? (
                <EmptyState title="Nothing logged yet" action={<Button size="sm" onClick={() => qa.open()}>Log your first action</Button>}>Shortcuts: {QUICK_KINDS.slice(0, 4).map((k) => `${k.key.toUpperCase()} ${k.label.toLowerCase()}`).join(" · ")}</EmptyState>
              ) : (
                <ul className="flex flex-col">
                  {(allLog ? d.todayEvents : d.todayEvents.slice(0, 5)).map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-3 border-t border-hairline py-2.5 first:border-t-0">
                      <span className="min-w-0 truncate"><span className="font-medium">{e.label}</span>{e.accountName ? <span className="text-text-2"> · {e.accountName}</span> : null}</span>
                      <span className="num shrink-0 text-[13px] text-text-3">{timeOfDay(e.occurredAt, d.timezone)}{e.lateLogged ? " · late" : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        ) : null}
      </div>

      <DetailPanel open={editor} onClose={() => setEditor(false)} title={<h2 className="text-lg font-semibold">Mode & targets</h2>}>
        <TargetsEditor initialMode={d.mode} />
      </DetailPanel>
      <ReportModal open={report} onOpenChange={setReport} />
    </div>
  );
}

function NextActionCard({ d, onOnboard }: { d: MyDayData; onOnboard: () => void }) {
  const qa = useQuickAction();
  const n = d.nextAction;
  const qc = useQueryClient();
  const setMode = useMutation({
    mutationFn: (mode: string) => api("/api/settings/mode", { body: { mode } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (n.kind === "onboarding") {
    return (
      <Panel aria-labelledby="onb">
        <h2 id="onb" className="text-lg font-semibold">Which mode are you working in?</h2>
        <p className="mt-1 text-sm text-text-2">Targets come from your mode and stay editable. Nothing is counted against you until you choose.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {WORK_MODES.map((m) => (
            <Button key={m} variant="outline" disabled={setMode.isPending} onClick={() => setMode.mutate(m)}>{WORK_MODE_LABELS[m]}</Button>
          ))}
          <Button variant="ghost" onClick={onOnboard}>Review targets first</Button>
        </div>
        {setMode.isError ? <div className="mt-3"><ErrorState error={setMode.error} onRetry={() => setMode.reset()} /></div> : null}
      </Panel>
    );
  }
  return (
    <Panel aria-labelledby="next-title" className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-text-2">Do now</p>
        <h2 id="next-title" className="text-[22px] font-semibold leading-tight tracking-tight">{n.title}</h2>
        <p className="mt-0.5 text-sm text-text-2">{n.detail}</p>
      </div>
      {n.kind === "follow_up" && n.followUp ? (
        <div className="flex gap-2">
          {n.followUp.phone ? <Button asChild variant="outline" size="lg"><a href={`tel:${n.followUp.phone}`}><Phone /> Call</a></Button> : null}
          <Button variant="dark" size="lg" onClick={() => qa.open({ kind: "follow_up", accountId: n.followUp!.accountId, opportunityId: n.followUp!.opportunityId ?? undefined })}>Log outcome</Button>
        </div>
      ) : n.kind === "metric" && n.metric ? (
        <Button variant="dark" size="lg" onClick={() => qa.open({ kind: METRIC_KIND[n.metric!] ?? "visit" })}>Log {METRIC_LABELS[n.metric].toLowerCase()}</Button>
      ) : null}
    </Panel>
  );
}

function ReportModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [priority, setPriority] = React.useState("");
  const gen = useMutation({ mutationFn: () => api<{ text: string }>("/api/report", { body: { next_day_priority: priority } }) });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it in WhatsApp.");
    } catch {
      toast("Copy failed. Select the text and copy it manually.");
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) gen.reset(); }} title="WhatsApp daily report" description="Exactly what was logged today, open opportunities and tomorrow's priority.">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); gen.mutate(); }}>
        <Field label="Tomorrow's priority" htmlFor="prio"><Input id="prio" value={priority} onChange={(e) => setPriority(e.target.value)} maxLength={300} placeholder="e.g. Visit 5 garages in Lyon 3e" /></Field>
        <Button type="submit" variant="dark" className="self-start" disabled={gen.isPending}>{gen.isPending ? "Building…" : "Build report"}</Button>
        {gen.isError ? <ErrorState error={gen.error} onRetry={() => gen.mutate()} /> : null}
        {gen.data ? (
          <>
            <Textarea aria-label="Report text" readOnly value={gen.data.text} className="num min-h-64 font-mono text-[13px]" />
            <Button type="button" variant="primary" onClick={() => copy(gen.data!.text)}><Copy /> Copy report</Button>
          </>
        ) : null}
      </form>
    </Modal>
  );
}
