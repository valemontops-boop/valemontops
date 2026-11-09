"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import { CHANNEL_LABELS, type ChannelFunnel } from "@/domain/funnels";
import { growthVerdicts } from "@/domain/verdicts";
import { VerdictPanel } from "./verdicts";
import { StatStrip, StepFunnel, useFunnels, type FunnelData, type GrowthFilter, type GrowthTab } from "./growth-common";
import { useDateTag, useT } from "@/i18n/react";

/** Where a row of "Channels compared" leads: its Growth tab, or Call mode for calls and visits. */
const TARGET: Record<ChannelFunnel["key"], GrowthTab | "/call"> = { phone: "/call", field: "/call", linkedin: "linkedin", email: "messages", whatsapp: "messages", inbound: "website" };

/** Growth › Overview: key numbers → what the numbers say → every channel compared → one funnel per active channel. */
export function GrowthOverviewTab({ filter, onOpen }: { filter: GrowthFilter; onOpen: (tab: GrowthTab) => void }) {
  const q = useFunnels(filter);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Body d={q.data} onOpen={onOpen} />;
}

function Body({ d, onOpen }: { d: FunnelData; onOpen: (tab: GrowthTab) => void }) {
  const t = useT();
  const tag = useDateTag();
  const rows = [...d.all, d.inbound];
  const active = rows.filter((c) => c.touches > 0);
  const touches = d.all.reduce((s, c) => s + c.touches, 0);
  const won = d.all.reduce((s, c) => s + c.won, 0);
  const hours = d.all.reduce((s, c) => s + (c.hours ?? 0), 0);
  const outMeetings = d.all.reduce((s, c) => s + c.meetings, 0);
  const maxMph = Math.max(0.01, ...d.all.map((c) => c.meetingsPerHour ?? 0));
  return (
    <div className="flex flex-col gap-5">
      <StatStrip stats={[
        { label: t("Touches"), value: touches.toLocaleString(tag), note: t("calls, visits, LinkedIn, emails and WhatsApp") },
        { label: t("Meetings"), value: d.totalMeetings, note: t("all channels, website included"), result: true },
        { label: t("Won"), value: won, note: t("deals won, credited to the last channel"), result: true },
        { label: t("Meetings per hour of work"), value: hours ? (Math.round((outMeetings / hours) * 100) / 100).toLocaleString(tag) : "—", note: hours ? t("{h} h of outreach in this period", { h: (Math.round(hours * 10) / 10).toLocaleString(tag) }) : t("no outreach logged yet") },
      ]} />
      {active.length === 0 ? (
        <EmptyState title={t("Nothing logged in this period yet")} action={<Button asChild size="sm" variant="primary"><Link href="/call">{t("Open Call mode")}</Link></Button>}>
          {t("Calls, emails, WhatsApp, LinkedIn and visits all show up here as soon as you log them. Website visits come from the GA4 import in the Website tab.")}
        </EmptyState>
      ) : (
        <VerdictPanel verdicts={growthVerdicts(d, (k) => t(CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS] ?? k))} />
      )}
      <Panel>
        <PanelTitle>{t("Channels compared")}</PanelTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="text-left text-[12px] text-text-3">
                <th className="py-1.5 font-medium">{t("Channel")}</th>
                <th className="text-right font-medium">{t("Touches")}</th>
                <th className="text-right font-medium">{t("Meetings")}</th>
                <th className="text-right font-medium">{t("Won")}</th>
                <th className="w-[30%] pl-6 font-medium">{t("Meetings per hour of work")}</th>
                <th className="w-8"><span className="sr-only">{t("Open")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const target = TARGET[c.key];
                const go = () => (target === "/call" ? undefined : onOpen(target));
                const label = t(CHANNEL_LABELS[c.key]);
                return (
                  <tr key={c.key} className={c.touches ? "border-t border-hairline hover:bg-subtle/60" : "border-t border-hairline text-text-3 hover:bg-subtle/60"}>
                    <td className="py-2.5 font-medium">
                      {target === "/call" ? <Link href="/call" className="hover:underline">{label}</Link> : <button type="button" onClick={go} className="text-left hover:underline">{label}</button>}
                      {d.best === c.key ? <span className="ml-2 text-[11px] font-normal text-win">{t("best")}</span> : null}
                    </td>
                    <td className="num text-right">{c.touches.toLocaleString(tag)}</td>
                    <td className={c.meetings ? "num text-right font-semibold text-win" : "num text-right"}>{c.meetings}</td>
                    <td className={c.won ? "num text-right font-semibold text-win" : "num text-right"}>{c.won}</td>
                    <td className="pl-6">
                      {c.meetingsPerHour === null ? <span className="text-[12px] text-text-3">{c.key === "inbound" ? t("no time cost") : "—"}</span> : (
                        <span className="flex items-center gap-2">
                          <span className="h-2 rounded-full bg-sales" style={{ width: `${(c.meetingsPerHour / maxMph) * 80}%`, minWidth: c.meetingsPerHour ? 4 : 0 }} />
                          <span className="num text-[12px]">{c.meetingsPerHour.toLocaleString(tag)}</span>
                        </span>
                      )}
                    </td>
                    <td className="text-right text-text-3">
                      {target === "/call" ? <Link href="/call" aria-label={t("Open Call mode")} className="inline-flex"><ChevronRight className="size-4" /></Link>
                        : <button type="button" onClick={go} aria-label={`${t("Open")} · ${label}`} className="inline-flex"><ChevronRight className="size-4" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-text-3">{t("Website & social: touches are website visits and won are 30/30 purchases. Click a channel to see its details.")}</p>
      </Panel>
      {active.length ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {active.map((c) => <StepFunnel key={c.key} compact title={t(CHANNEL_LABELS[c.key])} steps={c.steps} hours={c.hours} />)}
        </div>
      ) : null}
      <p className="text-[12px] text-text-3">{t("Meetings and deals are credited to the last channel that touched the business before them. Time comes from the minutes per action in Settings › Targets.")} {t("The % is the share kept from the step before.")}</p>
    </div>
  );
}
