"use client";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { ErrorState, Panel, PanelTitle, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { CHANNEL_LABELS, type Funnels } from "@/domain/funnels";
import { growthVerdicts } from "@/domain/verdicts";
import { VerdictPanel } from "./verdicts";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Data = Funnels & { from: string; to: string };

/** Every channel side by side: what goes in, what comes out, and meetings per hour of work. */
export function FunnelsTab() {
  const t = useT();
  const [days, setDays] = React.useState<"7" | "30" | "90">("30");
  const [scope, setScope] = React.useState<"team" | "me">("team");
  const q = useQuery({ queryKey: ["funnels", days, scope], queryFn: () => api<Data>(`/api/marketing/funnels?days=${days}&scope=${scope}`) });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedSwitch size="sm" label={t("Period")} value={days} onChange={setDays} options={[{ value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }, { value: "90", label: t("90 days") }]} />
        <SegmentedSwitch size="sm" label={t("Scope")} value={scope} onChange={setScope} options={[{ value: "team", label: t("Team") }, { value: "me", label: t("Me") }]} />
      </div>
      {q.isPending ? <Skeleton className="h-96" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Body d={q.data} />}
    </div>
  );
}

function Body({ d }: { d: Data }) {
  const t = useT();
  const rows = [...d.all.filter((c) => c.touches > 0), ...(d.inbound.touches ? [d.inbound] : [])];
  const maxMph = Math.max(0.01, ...d.channels.map((c) => c.meetingsPerHour ?? 0));
  if (!rows.length) return <Panel><p className="text-sm text-text-2">{t("Nothing logged in this period yet. Calls, emails, WhatsApp, LinkedIn and visits all show up here.")}</p></Panel>;
  return (
    <>
      <VerdictPanel verdicts={growthVerdicts(d, (k) => t(CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS] ?? k))} />
      <Panel>
        <PanelTitle action={<span className="num text-[13px] text-text-2">{t("{n} meetings in total", { n: d.totalMeetings })}</span>}>{t("Channels compared")}</PanelTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[12px] text-text-3">
                <th className="py-1.5 font-medium">{t("Channel")}</th>
                <th className="text-right font-medium">{t("Touches")}</th>
                <th className="text-right font-medium">{t("Meetings")}</th>
                <th className="text-right font-medium">{t("Won")}</th>
                <th className="text-right font-medium">{t("Touches per meeting")}</th>
                <th className="w-[30%] pl-4 font-medium">{t("Meetings per hour of work")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.key} className="border-t border-hairline">
                  <td className="py-2.5 font-medium">{t(CHANNEL_LABELS[c.key])}{d.best === c.key ? <span className="ml-2 text-[11px] font-normal text-win">{t("best")}</span> : null}</td>
                  <td className="num text-right">{c.touches}</td>
                  <td className="num text-right font-semibold">{c.meetings}</td>
                  <td className="num text-right">{c.won}</td>
                  <td className="num text-right text-text-2">{c.touchesPerMeeting ?? "—"}</td>
                  <td className="pl-4">
                    {c.meetingsPerHour === null ? <span className="text-[12px] text-text-3">{c.key === "inbound" ? t("no time cost") : "—"}</span> : (
                      <span className="flex items-center gap-2">
                        <span className="h-2 rounded-full bg-sales" style={{ width: `${(c.meetingsPerHour / maxMph) * 80}%`, minWidth: c.meetingsPerHour ? 4 : 0 }} />
                        <span className="num text-[12px]">{c.meetingsPerHour}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.insights.length ? <ul className="mt-4 flex flex-col gap-1 text-[13px] text-text-2">{d.insights.map((x) => <li key={x}>{t(x)}</li>)}</ul> : null}
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {rows.map((c) => <FunnelCard key={c.key} label={t(CHANNEL_LABELS[c.key])} steps={c.steps} hours={c.hours} />)}
      </div>
      <p className="text-[12px] text-text-3">{t("Meetings and deals are credited to the last channel that touched the business before them. Time comes from the minutes per action in Settings › Targets.")}</p>
    </>
  );
}

/** One channel's funnel in a single line of steps, with the % kept at each step. */
function FunnelCard({ label, steps, hours }: { label: string; steps: { label: string; value: number }[]; hours: number | null }) {
  const t = useT();
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <Panel>
      <PanelTitle action={hours !== null ? <span className="num text-[12px] text-text-3">{t("{h} h of work", { h: hours })}</span> : null}>{label}</PanelTitle>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const prev = steps[i - 1]?.value;
          const rate = i > 0 && prev ? Math.round((s.value / prev) * 100) : null;
          const result = s.label === "Meetings" || s.label === "Won" || s.label === "Purchases";
          return (
            <li key={s.label} className="grid grid-cols-[minmax(110px,34%)_1fr_3rem_3rem] items-center gap-3 text-sm">
              <span className="truncate text-text-2">{t(s.label)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-subtle"><span className={cn("block h-full rounded-full", result ? "bg-win" : "bg-sales")} style={{ width: `${(s.value / max) * 100}%`, minWidth: s.value ? 4 : 0 }} /></span>
              <span className="num text-right font-semibold">{s.value}</span>
              <span className="num text-right text-[12px] text-text-3">{rate === null ? "" : `${rate}%`}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
