"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import { CHANNEL_LABELS, type ChannelFunnel } from "@/domain/funnels";
import { costVerdicts, growthVerdicts } from "@/domain/verdicts";
import { CALL_BENCHMARKS, type BenchStatus } from "@/domain/cac";
import { formatEur } from "@/lib/utils";
import { VerdictPanel } from "./verdicts";
import { CostCell, CostExplainer, StatStrip, StepFunnel, useFunnels, useHours, type FunnelData, type GrowthFilter, type GrowthTab } from "./growth-common";
import { useDateTag, useT } from "@/i18n/react";

/** Where a row of "Channels compared" leads: its Growth tab, or Call mode for calls and visits. */
const TARGET: Record<ChannelFunnel["key"], GrowthTab | "/call"> = { phone: "/call", field: "/call", linkedin: "linkedin", email: "messages", whatsapp: "messages", web: "website", ai: "website", social: "instagram", inbound: "website" };

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
  // Inbound is split by source (round 8): web browser, AI engines, social networks; older payloads only have the total.
  const rows = [...d.all, ...(d.sources ?? [d.inbound])];
  const active = rows.filter((c) => c.touches > 0 || c.steps.some((s) => s.value > 0));
  const inboundKeys = new Set<string>(["web", "ai", "social", "inbound"]);
  const touches = d.all.reduce((s, c) => s + c.touches, 0);
  const won = d.all.reduce((s, c) => s + c.won, 0);
  const hours = d.all.reduce((s, c) => s + (c.hours ?? 0), 0);
  const outMeetings = d.all.reduce((s, c) => s + c.meetings, 0);
  const maxMph = Math.max(0.01, ...d.all.map((c) => c.meetingsPerHour ?? 0));
  const label = (k: string) => t(CHANNEL_LABELS[k as keyof typeof CHANNEL_LABELS] ?? k);
  const h = useHours();
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
          {t("Calls, emails, WhatsApp, LinkedIn and visits all show up here as soon as you log them. Website visits come from the GA4 import in the Web tab.")}
        </EmptyState>
      ) : (
        <VerdictPanel verdicts={[...growthVerdicts(d, label), ...(d.costs ? costVerdicts(d.costs, label, formatEur).map((v) => ({ ...v, vars: v.vars && Object.fromEntries(Object.entries(v.vars).map(([k, x]) => [k, typeof x === "number" ? x.toLocaleString(tag) : x])) })) : [])]} />
      )}
      <Panel>
        <PanelTitle>{t("Channels compared")}</PanelTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-[12px] text-text-3">
                <th className="py-1.5 font-medium">{t("Channel")}</th>
                <th className="text-right font-medium">{t("Touches")}</th>
                <th className="text-right font-medium">{t("Meetings")}</th>
                <th className="text-right font-medium">{t("Won")}</th>
                <th className="w-[22%] pl-6 font-medium">{t("Meetings per hour of work")}</th>
                <th className="text-right font-medium">{t("Hours")}</th>
                <th className="text-right font-medium">{t("Cost per meeting")}</th>
                <th className="text-right font-medium">{t("CAC")}</th>
                <th className="w-8"><span className="sr-only">{t("Open")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const target = TARGET[c.key];
                const go = () => (target === "/call" ? undefined : onOpen(target));
                const name = t(CHANNEL_LABELS[c.key]);
                const cost = d.costs?.[c.key];
                return (
                  <tr key={c.key} className={c.touches ? "border-t border-hairline hover:bg-subtle/60" : "border-t border-hairline text-text-3 hover:bg-subtle/60"}>
                    <td className="py-2.5 font-medium">
                      {target === "/call" ? <Link href="/call" className="hover:underline">{name}</Link> : <button type="button" onClick={go} className="text-left hover:underline">{name}</button>}
                      {d.best === c.key ? <span className="ml-2 text-[11px] font-normal text-win">{t("best")}</span> : null}
                    </td>
                    <td className="num text-right">{c.touches.toLocaleString(tag)}</td>
                    <td className={c.meetings ? "num text-right font-semibold text-win" : "num text-right"}>{c.meetings}</td>
                    <td className={c.won ? "num text-right font-semibold text-win" : "num text-right"}>{c.won}</td>
                    <td className="pl-6">
                      {c.meetingsPerHour === null ? <span className="text-[12px] text-text-3">{inboundKeys.has(c.key) ? t("no time logged yet") : "—"}</span> : (
                        <span className="flex items-center gap-2">
                          <span className="h-2 rounded-full bg-sales" style={{ width: `${(c.meetingsPerHour / maxMph) * 80}%`, minWidth: c.meetingsPerHour ? 4 : 0 }} />
                          <span className="num text-[12px]">{c.meetingsPerHour.toLocaleString(tag)}</span>
                        </span>
                      )}
                    </td>
                    <td className="num text-right text-text-2">{cost ? h(cost.minutes) : "—"}</td>
                    <td className="text-right"><CostCell minor={cost?.perMeetingMinor} low={cost?.lowSample} empty={cost ? t("no meeting yet") : "—"} /></td>
                    <td className="text-right"><CostCell minor={cost?.cacMinor} low={cost?.lowSample} empty={cost ? t("no client yet") : "—"} /></td>
                    <td className="text-right text-text-3">
                      {target === "/call" ? <Link href="/call" aria-label={t("Open Call mode")} className="inline-flex"><ChevronRight className="size-4" /></Link>
                        : <button type="button" onClick={go} aria-label={`${t("Open")} · ${name}`} className="inline-flex"><ChevronRight className="size-4" /></button>}
                    </td>
                  </tr>
                );
              })}
              {d.blended ? (
                <tr className="border-t-2 border-hairline font-medium">
                  <td className="py-2.5">{t("All channels, fully loaded")}</td>
                  <td /><td className="num text-right">{d.blended.meetings}</td><td className="num text-right">{d.blended.won}</td><td />
                  <td className="num text-right text-text-2">{h(d.blended.minutes)}</td>
                  <td className="text-right"><CostCell minor={d.blended.perMeetingMinor} low={d.blended.lowSample} empty={t("no meeting yet")} /></td>
                  <td className="text-right"><CostCell minor={d.blended.cacMinor} low={d.blended.lowSample} empty={t("no client yet")} /></td>
                  <td />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-text-3">{t("Web (browser), AI engines and social networks: touches are website visits from that source and won are 30/30 purchases. Click a channel to see its details.")} {d.costBasis ? t("Costs: founder time at {x} per hour + every expense in Money of the period. * = estimate, little data.", { x: formatEur(d.costBasis.hourCostEur * 100) }) : null}</p>
        <div className="mt-3"><CostExplainer d={d} /></div>
      </Panel>
      {d.calls && d.calls.dials > 0 ? <CallsEconomics d={d} /> : null}
      {active.length ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {active.map((c) => <StepFunnel key={c.key} compact title={t(CHANNEL_LABELS[c.key])} steps={c.steps} hours={c.hours} />)}
        </div>
      ) : null}
      <p className="text-[12px] text-text-3">{t("Meetings and deals are credited to the last channel that touched the business before them. Time comes from the minutes per action in Settings › Targets.")} {t("The % is the share kept from the step before.")}</p>
    </div>
  );
}

const BENCH_TONE: Record<BenchStatus, string> = { better: "text-win", within: "text-text-2", worse: "text-bad", too_few: "text-text-3" };
const BENCH_TEXT: Record<BenchStatus, string> = { better: "better than the benchmark", within: "within the benchmark", worse: "below the benchmark", too_few: "too few calls to compare" };

/** "What the calls bring": dials → picked up → yes → meetings → clients, calls needed, cost per call / meeting / client, vs researched benchmarks. */
function CallsEconomics({ d }: { d: FunnelData }) {
  const t = useT();
  const tag = useDateTag();
  const c = d.calls;
  const pct = (x: number | null) => (x === null ? "—" : `${(Math.round(x * 1000) / 10).toLocaleString(tag)} %`);
  const e = d.economics;
  const rows: { label: string; value: string; bench?: BenchStatus; range?: string }[] = [
    { label: t("Picked up per dial"), value: pct(c.connectRate), bench: c.bench.connectRate, range: `${CALL_BENCHMARKS.connectRate.low * 100}–${CALL_BENCHMARKS.connectRate.high * 100} %` },
    { label: t("Meetings per call picked up"), value: pct(c.meetingPerConversation), bench: c.bench.meetingPerConversation, range: `${CALL_BENCHMARKS.meetingPerConversation.low * 100}–${CALL_BENCHMARKS.meetingPerConversation.high * 100} %` },
    { label: t("Calls per meeting"), value: c.dialsPerMeeting === null ? t("no meeting yet") : c.dialsPerMeeting.toLocaleString(tag), bench: c.bench.dialsPerMeeting, range: `${CALL_BENCHMARKS.dialsPerMeeting.low}–${CALL_BENCHMARKS.dialsPerMeeting.high}` },
    { label: t("Calls per client"), value: c.dialsPerClient === null ? t("no client yet") : c.dialsPerClient.toLocaleString(tag) },
    { label: t("Cost per call"), value: c.costPerDialMinor === null ? "—" : formatEur(c.costPerDialMinor) },
    { label: t("Cost per meeting from calls"), value: c.costPerMeetingMinor === null ? t("no meeting yet") : formatEur(c.costPerMeetingMinor) },
    { label: t("Cost per client from calls"), value: c.costPerClientMinor === null ? t("no client yet") : formatEur(c.costPerClientMinor) },
  ];
  return (
    <Panel>
      <PanelTitle>{t("What the calls bring")}</PanelTitle>
      <p className="mb-3 text-sm text-text-2">{t("{d} calls → {p} picked up → {y} yes → {m} meetings → {w} clients", { d: c.dials, p: c.picked, y: c.yes, m: c.meetings, w: c.won })}{c.lowSample ? ` · ${t("estimate, little data")}` : ""}</p>
      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        <ul className="flex flex-col divide-y divide-hairline text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-text-2">{r.label}</span>
              <span className="text-right"><span className="num font-semibold">{r.value}</span>{r.bench ? <span className={`block text-[11px] ${BENCH_TONE[r.bench]}`}>{t(BENCH_TEXT[r.bench])} ({r.range})</span> : null}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 text-sm max-md:mt-3">
          <p className="font-medium">{t("Is a client worth what it costs?")}</p>
          <p className="text-text-2">{e.blended.consultingLtvToCac === null ? t("No Valemont deal won yet in this period: the payback appears with the first one ({x} of costs so far).", { x: formatEur(d.dealsCost.totalMinor) }) : t("Fully loaded CAC of a Valemont deal: {c}. A Consulting deal ({v}) is worth {r}× this CAC (target ≥ 3).", { c: formatEur(d.dealsCost.cacMinor), v: formatEur(e.offers.consulting), r: e.blended.consultingLtvToCac.toLocaleString(tag) })}</p>
          {e.blended.localPaybackMonths !== null ? <p className="text-text-2">{t("A Local client ({v} per month) pays back the CAC in {n} months (healthy: under 12).", { v: formatEur(e.offers.local), n: e.blended.localPaybackMonths.toLocaleString(tag) })}</p> : null}
          <p className="text-[12px] text-text-3">{t("Benchmarks: general B2B cold calling (Belkins, Gong, Cognism, Skipcall); none specific to trades in France or Spain was found. Margin = price: no delivery cost is recorded.")}</p>
        </div>
      </div>
    </Panel>
  );
}
