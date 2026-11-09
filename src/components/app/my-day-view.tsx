"use client";
import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { Clock, Copy, Phone, PhoneCall } from "lucide-react";
import Link from "next/link";
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
import { ToneTitle } from "./charts";
import { useQuickAction, type QuickKind } from "./quick-action";
import { TargetsEditor } from "./targets-editor";
import { useMyDay, type MyDayData } from "./use-crm";
import { useT } from "@/i18n/react";
import { CloseDayButton, LateCorrections, MarketingWeek, NextBestActions, NextMeetings, StreakStrip, TasksFor } from "./my-day-extras";

const METRIC_KIND: Partial<Record<Metric, QuickKind>> = {
  calls: "call", field_visits: "visit", dms: "dm", invitations: "invitation", inmails: "inmail", cold_emails: "email", follow_ups: "follow_up", comments: "comment",
};

export function MyDayView() {
  const t = useT();
  const q = useMyDay();
  const qa = useQuickAction();
  const [focus, setFocus] = React.useState(() => {
    try { return typeof window !== "undefined" && localStorage.getItem("vos-focus") === "1"; } catch { return false; } // per-viewer convenience only
  });
  const toggleFocus = () => setFocus((f) => { try { localStorage.setItem("vos-focus", f ? "0" : "1"); } catch { /* ignore */ } return !f; });
  const [editor, setEditor] = React.useState(false);
  const [report, setReport] = React.useState(false);
  const [allLog, setAllLog] = React.useState(false);

  // Pending ticks: activities being saved right now (hollow until the server confirms).
  const pendingTypes = useMutationState({ filters: { mutationKey: ["log-activity"], status: "pending" }, select: (m) => (m.state.variables as { activity_type?: ActivityType } | undefined)?.activity_type });
  const pendingByMetric: Partial<Record<Metric, number>> = {};
  for (const pt of pendingTypes) { const m = pt ? METRIC_OF_TYPE[pt] : undefined; if (m) pendingByMetric[m] = (pendingByMetric[m] ?? 0) + 1; }

  if (q.isPending) return <div className="flex flex-col gap-4"><Skeleton className="h-24" /><Skeleton className="h-36" /><Skeleton className="h-72" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const active = d.targets ? METRICS.filter((m) => d.targets![m].target > 0) : [];
  const c = d.calls;

  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("My Day")}</h1>
            <p className="text-sm text-text-2">{d.today} · {d.mode ? t(WORK_MODE_LABELS[d.mode]) : t("No mode set")} · {t("closes {time}", { time: timeOfDay(d.cutoffAt, d.timezone) })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!focus ? <>
              <Button variant="ghost" size="sm" onClick={() => setReport(true)}><Copy /> WhatsApp</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditor(true)}>{t("Targets")}</Button>
              <CloseDayButton />
            </> : null}
            <Button variant="outline" size="sm" aria-pressed={focus} onClick={toggleFocus}>{focus ? t("Exit focus") : t("Focus")}</Button>
          </div>
        </div>

        {!focus ? <StreakStrip /> : null}
        {!focus ? <NextMeetings /> : null}
        <NextActionCard d={d} onOnboard={() => setEditor(true)} />
        {!focus ? <LateCorrections /> : null}

        {d.mode ? (
          <Panel aria-labelledby="sales-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <ToneTitle tone="sales" id="sales-title">{t("Sales")}</ToneTitle>
              <Button asChild variant="primary" size="lg"><Link href="/call"><PhoneCall /> {t("Start calling")}</Link></Button>
            </div>
            <div className="mb-4 grid grid-cols-4 gap-2 text-center" aria-label={t("Calls today")}>
              {([["Dials", c.dials, "bg-subtle/70"], ["Picked up", c.pickedUp, "bg-subtle/70"], ["Yes", c.interested + c.callBacks + c.meetings, "bg-subtle/70"], ["Meetings", c.meetings, "bg-ink text-panel"]] as const).map(([l, v, cls]) => (
                <div key={l} className={cn("rounded-[12px] p-3", cls)}><p className="num text-[24px] font-semibold leading-none">{v}</p><p className={cn("mt-1 text-[11px]", l === "Meetings" ? "text-panel/85" : "text-text-2")}>{t(l)}</p></div>
              ))}
            </div>
            {!d.isWorkday ? (
              <EmptyState title={t("Not a scheduled workday")}>{t("Nothing is expected today. Anything you log still counts in the CRM.")}</EmptyState>
            ) : active.length === 0 ? (
              <EmptyState title={t("No targets in this mode")} action={<Button size="sm" onClick={() => setEditor(true)}>{t("Set targets")}</Button>}>{t("Without targets no day is marked missed.")}</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2 [&>*]:border-b [&>*]:border-hairline">
                {active.map((m) => (
                  <ActionMeter key={m} label={t(METRIC_LABELS[m])} actual={d.tally[m]} target={d.targets![m].target} pending={pendingByMetric[m] ?? 0}
                    onLog={m === "calls" ? undefined : METRIC_KIND[m] ? () => qa.open({ kind: METRIC_KIND[m] }) : m === "new_businesses" ? () => qa.open({ kind: "visit" }) : undefined} />
                ))}
              </div>
            )}
            {d.feasibility && !d.feasibility.feasible && !focus ? (
              <p className="mt-3 text-[13px] text-bad"><Clock className="mr-1.5 inline size-3.5 align-[-2px]" />{t("Planned {planned} min of outreach for {capacity} min available: lower a target for tomorrow.", { planned: d.feasibility.plannedMinutes, capacity: d.feasibility.capacityMinutes })}</p>
            ) : null}
            {!focus ? <div className="mt-5 border-t border-hairline pt-4"><TasksFor area="sales" /></div> : null}
          </Panel>
        ) : null}

        {!focus ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <NextBestActions />
            <Panel aria-labelledby="mk-title" className="flex flex-col gap-5">
              <ToneTitle tone="mkt" id="mk-title">{t("Marketing")}</ToneTitle>
              <MarketingWeek />
              <TasksFor area="marketing" />
            </Panel>
            <Panel aria-labelledby="ops-title">
              <ToneTitle tone="ops" id="ops-title" className="mb-3">{t("Ops")}</ToneTitle>
              <TasksFor area="ops" />
            </Panel>
            <Panel aria-labelledby="log-title">
              <PanelTitle action={d.todayEvents.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setAllLog((v) => !v)}>{allLog ? t("Show fewer") : t("See all {n}", { n: d.todayEvents.length })}</Button> : null}>
                <span id="log-title">{t("Logged today")} <span className="num text-text-3">{d.todayEvents.length}</span></span>
              </PanelTitle>
              {d.todayEvents.length === 0 ? <p className="text-sm text-text-2">{t("Nothing yet. Start a call session or press C to log a call.")}</p> : (
                <ul className="flex flex-col">
                  {(allLog ? d.todayEvents : d.todayEvents.slice(0, 5)).map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-3 border-t border-hairline py-2 first:border-t-0 text-sm">
                      <span className="min-w-0 truncate"><span className="font-medium">{t(e.label)}</span>{e.accountName ? <span className="text-text-2"> · {e.accountName}</span> : null}</span>
                      <span className="num shrink-0 text-[12px] text-text-3">{timeOfDay(e.occurredAt, d.timezone)}{e.lateLogged ? ` · ${t("late")}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        ) : null}
      </div>

      <DetailPanel open={editor} onClose={() => setEditor(false)} title={<h2 className="text-lg font-semibold">{t("Mode & targets")}</h2>}>
        <TargetsEditor initialMode={d.mode} />
      </DetailPanel>
      <ReportModal open={report} onOpenChange={setReport} />
    </div>
  );
}

function NextActionCard({ d, onOnboard }: { d: MyDayData; onOnboard: () => void }) {
  const t = useT();
  const qa = useQuickAction();
  const n = d.nextAction;
  const qc = useQueryClient();
  const setMode = useMutation({ mutationFn: (mode: string) => api("/api/settings/mode", { body: { mode } }), onSuccess: () => qc.invalidateQueries() });
  if (n.kind === "onboarding") {
    return (
      <Panel aria-labelledby="onb">
        <h2 id="onb" className="text-lg font-semibold">{t("Which mode are you working in?")}</h2>
        <p className="mt-1 text-sm text-text-2">{t("Targets come from your mode and stay editable. Nothing is counted against you until you choose.")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {WORK_MODES.map((m) => <Button key={m} variant="outline" disabled={setMode.isPending} onClick={() => setMode.mutate(m)}>{t(WORK_MODE_LABELS[m])}</Button>)}
          <Button variant="ghost" onClick={onOnboard}>{t("Review targets first")}</Button>
        </div>
        {setMode.isError ? <div className="mt-3"><ErrorState error={setMode.error} onRetry={() => setMode.reset()} /></div> : null}
      </Panel>
    );
  }
  return (
    <Panel aria-labelledby="next-title" className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-text-2">{t("Do now")}</p>
        <h2 id="next-title" className="text-[22px] font-semibold leading-tight tracking-tight">{t(n.title)}</h2>
        <p className="mt-0.5 text-sm text-text-2">{t(n.detail)}</p>
      </div>
      {n.kind === "follow_up" && n.followUp ? (
        <div className="flex gap-2">
          {n.followUp.phone ? <Button asChild variant="outline" size="lg"><a href={`tel:${n.followUp.phone}`}><Phone /> {t("Call")}</a></Button> : null}
          <Button variant="dark" size="lg" onClick={() => qa.open({ kind: "follow_up", accountId: n.followUp!.accountId, opportunityId: n.followUp!.opportunityId ?? undefined })}>{t("Log outcome")}</Button>
        </div>
      ) : n.kind === "metric" && n.metric === "calls" ? (
        <Button asChild variant="dark" size="lg"><Link href="/call">{t("Start calling")}</Link></Button>
      ) : n.kind === "metric" && n.metric ? (
        <Button variant="dark" size="lg" onClick={() => qa.open({ kind: METRIC_KIND[n.metric!] ?? "visit" })}>{t("Log {what}", { what: t(METRIC_LABELS[n.metric]).toLowerCase() })}</Button>
      ) : null}
    </Panel>
  );
}

function ReportModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [priority, setPriority] = React.useState("");
  const gen = useMutation({ mutationFn: () => api<{ text: string }>("/api/report", { body: { next_day_priority: priority } }) });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast(t("Copied. Paste it in WhatsApp.")); } catch { toast(t("Copy failed. Select the text and copy it manually.")); }
  };
  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) gen.reset(); }} title={t("WhatsApp daily report")} description={t("Exactly what was logged today, open opportunities and tomorrow's priority.")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); gen.mutate(); }}>
        <Field label={t("Tomorrow's priority")} htmlFor="prio"><Input id="prio" value={priority} onChange={(e) => setPriority(e.target.value)} maxLength={300} placeholder={t("e.g. Visit 5 garages in Lyon 3e")} /></Field>
        <Button type="submit" variant="dark" className="self-start" disabled={gen.isPending}>{gen.isPending ? t("Building…") : t("Build report")}</Button>
        {gen.isError ? <ErrorState error={gen.error} onRetry={() => gen.mutate()} /> : null}
        {gen.data ? (
          <>
            <Textarea aria-label={t("Report text")} readOnly value={gen.data.text} className={cn("num min-h-64 font-mono text-[13px]")} />
            <Button type="button" variant="primary" onClick={() => copy(gen.data!.text)}><Copy /> {t("Copy report")}</Button>
          </>
        ) : null}
      </form>
    </Modal>
  );
}
