"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, ErrorState, Skeleton } from "@/components/ui/form";
import { METRICS, METRIC_LABELS, WORK_MODES, WORK_MODE_LABELS, type Metric, type WorkMode } from "@/domain/constants";
import { api } from "@/lib/api";
import { feasibility } from "@/domain/targets";
import { useT } from "@/i18n/react";

type TargetsResp = { mode: WorkMode; currentMode: WorkMode | null; nextMode: WorkMode | null; effectiveFrom: string; appliesToday: boolean; targets: Record<Metric, { target: number; weight: number; minutes: number }>; capacityMinutes: number };

export function TargetsEditor({ initialMode }: { initialMode: WorkMode | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<WorkMode>(initialMode ?? "JOB_SEARCHING");
  const q = useQuery({ queryKey: ["targets", mode], queryFn: () => api<TargetsResp>(`/api/settings/targets?mode=${mode}`) });

  const saveMode = useMutation({
    mutationFn: () => api<{ effectiveFrom: string; appliesToday: boolean }>("/api/settings/mode", { body: { mode } }),
    onSuccess: (r) => { qc.invalidateQueries(); toast(r.appliesToday ? t("Mode set to {mode} from today", { mode: t(WORK_MODE_LABELS[mode]) }) : t("Mode set to {mode} from {date}. Today's plan is already locked.", { mode: t(WORK_MODE_LABELS[mode]), date: r.effectiveFrom })); },
  });
  const off = mode === "DAY_OFF" || mode === "VACATION";
  return (
    <div className="flex flex-col gap-5">
      <Field label={t("Work mode")} htmlFor="mode" hint={q.data ? (q.data.appliesToday ? t("Changes apply from today: today's plan is not locked yet.") : t("Changes apply from {date}. Today's plan was locked at day start, so a day cannot be passed by editing its goal.", { date: q.data.effectiveFrom })) : undefined}>
        <div className="flex gap-2">
          <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as WorkMode)}>
            {WORK_MODES.map((m) => <option key={m} value={m}>{t(WORK_MODE_LABELS[m])}{q.data?.currentMode === m ? ` ${t("(current)")}` : ""}</option>)}
          </Select>
          <Button variant="dark" onClick={() => saveMode.mutate()} disabled={saveMode.isPending || q.data?.nextMode === mode}>
            {saveMode.isPending ? t("Saving…") : q.data?.nextMode === mode ? t("Active") : t("Use this mode")}
          </Button>
        </div>
      </Field>
      {saveMode.isError ? <ErrorState error={saveMode.error} onRetry={() => saveMode.mutate()} /> : null}
      {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : off ? (
        <p className="text-sm text-text-2">{t("No targets on days off or vacation. Nothing is counted against you.")}</p>
      ) : (
        <TargetsForm key={`${mode}:${q.dataUpdatedAt}`} mode={mode} initial={q.data.targets} capacity={q.data.capacityMinutes} />
      )}
    </div>
  );
}

function TargetsForm({ mode, initial, capacity }: { mode: WorkMode; initial: TargetsResp["targets"]; capacity: number }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState(initial);
  const saveTargets = useMutation({
    mutationFn: () => api<{ changed: number; effectiveFrom: string; appliesToday: boolean }>("/api/settings/targets", { body: { mode, targets: draft } }),
    onSuccess: (r) => { qc.invalidateQueries(); toast(r.changed === 0 ? t("No change") : r.appliesToday ? t("Targets saved for today") : t("Targets saved from {date}", { date: r.effectiveFrom })); },
  });
  const f = feasibility(draft, capacity);
  return (
        <form onSubmit={(e) => { e.preventDefault(); saveTargets.mutate(); }} className="flex flex-col gap-3">
          <p className="text-[13px] text-text-2">{t("Suggested starting values, not platform caps. Daily targets exclude meetings and delivery time. LinkedIn counters never grant the right to exceed LinkedIn limits.")}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Action")}</th><th className="font-medium">{t("Target")}</th><th className="font-medium">{t("Weight")}</th><th className="font-medium">{t("Min/action")}</th></tr></thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m} className="border-t border-hairline">
                  <td className="py-1.5 pr-2">{t(METRIC_LABELS[m])}</td>
                  {(["target", "weight", "minutes"] as const).map((k) => (
                    <td key={k} className="py-1.5 pr-2">
                      <Input aria-label={`${t(METRIC_LABELS[m])} ${t(k === "target" ? "Target" : k === "weight" ? "Weight" : "Min/action")}`} type="number" min={0} max={k === "weight" ? 10 : 500} inputMode="numeric" className="num h-9 w-20"
                        value={draft[m][k]} onChange={(e) => setDraft({ ...draft, [m]: { ...draft[m], [k]: Math.max(0, Number(e.target.value) || 0) } })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {(
            <p className={f.feasible ? "text-sm text-text-2" : "text-sm text-bad"}>
              {t("Planned {planned} min against {capacity} min capacity", { planned: f.plannedMinutes, capacity: f.capacityMinutes })}
              {f.feasible ? "." : `: ${t("{n} min over. Reduce a target or raise capacity in Settings.", { n: f.overBy })}`}
            </p>
          )}
          {saveTargets.isError ? <ErrorState error={saveTargets.error} onRetry={() => saveTargets.mutate()} /> : null}
          <Button type="submit" variant="dark" className="self-start" disabled={saveTargets.isPending}>{saveTargets.isPending ? t("Saving…") : t("Save targets")}</Button>
        </form>
  );
}
