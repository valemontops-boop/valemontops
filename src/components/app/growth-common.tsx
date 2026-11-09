"use client";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Panel, PanelTitle } from "@/components/ui/form";
import type { Funnels } from "@/domain/funnels";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Shared pieces of the Growth space (round 7): one period and one scope for every tab, and the same
 * layout everywhere: a strip of at most four numbers, then the channel funnel, then the details.
 * Sober style: values in ink, blue for volumes, green only for results (meetings, won, purchases).
 */
export type GrowthTab = "overview" | "messages" | "linkedin" | "instagram" | "website" | "content";
export type Days = "7" | "30" | "90";
export type Scope = "team" | "me";
export type GrowthFilter = { days: Days; scope: Scope };
export type FunnelData = Funnels & { from: string; to: string };

/** Every channel's funnel for the period and scope (same cache for every tab). */
export function useFunnels({ days, scope }: GrowthFilter) {
  return useQuery({ queryKey: ["funnels", days, scope], queryFn: () => api<FunnelData>(`/api/marketing/funnels?days=${days}&scope=${scope}`) });
}

export type Stat = { label: string; value: React.ReactNode; note?: React.ReactNode; result?: boolean };
/** At most four numbers in one quiet band; each says what it counts in its note. */
export function StatStrip({ stats }: { stats: Stat[] }) {
  const shown = stats.slice(0, 4);
  return (
    <Panel className="p-0 sm:p-0">
      <dl className={cn("grid grid-cols-2", shown.length >= 4 ? "md:grid-cols-4" : shown.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {shown.map((s, i) => (
          <div key={i} className={cn("flex min-w-0 flex-col gap-1 p-5", i > 0 && "md:border-l md:border-hairline", i % 2 === 1 && "border-l border-hairline", i >= 2 && "max-md:border-t max-md:border-hairline")}>
            <dt className="text-[13px] font-medium text-text-2">{s.label}</dt>
            <dd className={cn("num text-[32px] font-semibold leading-none tracking-tight", s.result && "text-win")}>{s.value}</dd>
            {s.note ? <dd className="text-[12px] text-text-3">{s.note}</dd> : null}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const RESULT_STEPS = new Set(["Meetings", "Won", "Purchases"]);
/**
 * One channel's funnel: a bar per step (blue = volume, green = result), the value, and the share kept
 * from the step before. `empty` says what to do when nothing has entered the funnel yet.
 */
export function StepFunnel({ title, steps, hours, empty, compact, action, footnote }: { title: string; steps: { label: string; value: number }[]; hours?: number | null; empty?: string; compact?: boolean; action?: React.ReactNode; footnote?: string }) {
  const t = useT();
  const tag = useDateTag();
  const max = Math.max(1, ...steps.map((s) => s.value));
  const isEmpty = !steps.some((s) => s.value > 0);
  return (
    <Panel>
      <PanelTitle action={action ?? (hours ? <span className="num text-[12px] text-text-3">{t("{h} h of work", { h: hours.toLocaleString(tag) })}</span> : null)}>{title}</PanelTitle>
      {isEmpty && empty ? <p className="text-sm text-text-2">{empty}</p> : (
        <>
          <ol className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2.5")}>
            {steps.map((s, i) => {
              const prev = steps[i - 1]?.value;
              const rate = i > 0 && prev ? Math.round((s.value / prev) * 100) : null;
              return (
                <li key={s.label} className="grid grid-cols-[minmax(110px,34%)_1fr_3.5rem_3rem] items-center gap-3 text-sm">
                  <span className="truncate text-text-2">{t(s.label)}</span>
                  <span className={cn("overflow-hidden rounded-full bg-subtle", compact ? "h-2" : "h-2.5")}><span className={cn("block h-full rounded-full", RESULT_STEPS.has(s.label) ? "bg-win" : "bg-sales")} style={{ width: `${(s.value / max) * 100}%`, minWidth: s.value ? 4 : 0 }} /></span>
                  <span className="num text-right font-semibold">{s.value.toLocaleString(tag)}</span>
                  <span className="num text-right text-[12px] text-text-3">{rate === null || rate > 100 ? "" : `${rate}%`}</span>
                </li>
              );
            })}
          </ol>
          {!compact ? <p className="mt-3 text-[12px] text-text-3">{footnote ?? t("The % is the share kept from the step before.")}</p> : null}
        </>
      )}
    </Panel>
  );
}

/** "12 %" or "—" when there is no denominator. */
export const pctOf = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
