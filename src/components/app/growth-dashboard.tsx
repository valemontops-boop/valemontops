"use client";
import { ChevronRight, MessageSquareReply, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { CHANNEL_LABELS, type ChannelFunnel } from "@/domain/funnels";
import { growthHref, keyNumbers, orderVerdicts, panelOf, readGrowthState, rowValue, type GrowthState, type GrowthView } from "@/domain/growth-dashboard";
import { costVerdicts, growthVerdicts, type Verdict, type VerdictKind } from "@/domain/verdicts";
import { useDateTag, useT } from "@/i18n/react";
import { cn, formatEur } from "@/lib/utils";
import { CostExplainer, StatStrip, useFunnels, useHours, type FunnelData, type GrowthFilter } from "./growth-common";
import { GrowthDrawer } from "./growth-drawer";
import { useInbox } from "./inbox-panel";

/**
 * Growth as ONE dashboard (round 10, D077, founder feedback "trop de dashboards qui se répètent"): ≤ 5 key numbers →
 * every channel compared in one visual with three views of the same data (volume, results, cost) → what the numbers
 * say (3 items) + "To reply" and Content. A channel or a number drills down; every number appears once here.
 */
export function GrowthDashboard({ filter }: { filter: GrowthFilter }) {
  const params = useSearchParams();
  const router = useRouter();
  const state = readGrowthState(params);
  const go = (patch: Partial<GrowthState>) => router.replace(growthHref({ ...state, ...patch }), { scroll: false });
  const q = useFunnels(filter);
  return (
    <>
      {q.isPending ? <div className="flex flex-col gap-5"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : <Body d={q.data} view={state.view} go={go} />}
      <GrowthDrawer panel={state.panel} tab={state.tab} filter={filter} onTab={(tab) => go({ tab })} onClose={() => go({ panel: null, tab: null })} />
    </>
  );
}

function Body({ d, view, go }: { d: FunnelData; view: GrowthView; go: (p: Partial<GrowthState>) => void }) {
  const t = useT();
  const tag = useDateTag();
  const k = keyNumbers(d);
  const b = d.blended;
  const chartRef = React.useRef<HTMLDivElement>(null);
  const show = (v: GrowthView) => { go({ view: v }); chartRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
  const label = (key: string) => t(CHANNEL_LABELS[key as keyof typeof CHANNEL_LABELS] ?? key);
  const verdicts = orderVerdicts([
    ...growthVerdicts(d, label),
    ...(d.costs ? costVerdicts(d.costs, label, formatEur).map((v) => ({ ...v, vars: v.vars && Object.fromEntries(Object.entries(v.vars).map(([n, x]) => [n, typeof x === "number" ? x.toLocaleString(tag) : x])) })) : []),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <StatStrip stats={[
        { label: t("Touches"), value: k.touches.toLocaleString(tag), note: t("calls, visits, LinkedIn, emails and WhatsApp"), onClick: () => show("volume"), pressed: view === "volume" },
        { label: t("Meetings"), value: k.meetings.toLocaleString(tag), note: t("all channels, website included"), result: true, onClick: () => show("results"), pressed: view === "results" },
        { label: t("Clients"), value: k.clients.toLocaleString(tag), note: t("{d} deals won · {p} 30/30 purchases", { d: k.deals, p: k.purchases }), result: true, onClick: () => show("results") },
        { label: t("Cost per meeting"), value: b?.perMeetingMinor == null ? "—" : `${formatEur(b.perMeetingMinor)}${b.lowSample ? "*" : ""}`, note: !b ? "…" : b.cacMinor === null ? t("all channels, fully loaded · no client yet") : t("CAC {x} · all channels, fully loaded", { x: formatEur(b.cacMinor) }), onClick: () => show("cost"), pressed: view === "cost" },
        { label: t("Meetings per hour of work"), value: k.perHour === null ? "—" : k.perHour.toLocaleString(tag), note: k.hours ? t("{h} h of outreach in this period", { h: (Math.round(k.hours * 10) / 10).toLocaleString(tag) }) : t("no outreach logged yet"), onClick: () => show("results") },
      ]} />
      <div ref={chartRef} className="scroll-mt-4"><ChannelsCompared d={d} view={view} go={go} /></div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><VerdictBrief verdicts={verdicts} /></div>
        <Shortcuts go={go} />
      </div>
    </div>
  );
}

const VIEW_TEXT: Record<GrowthView, string> = {
  volume: "Touches per channel. For web, AI engines and social networks: website visits from that source.",
  results: "Meetings per channel, credited to the last channel that touched the business.",
  cost: "Cost per meeting per channel: founder time + money of the period. Shorter bar = cheaper.",
};

/** The one main visual: a bar per channel; the view switch changes the measure, never the channels or their order. */
function ChannelsCompared({ d, view, go }: { d: FunnelData; view: GrowthView; go: (p: Partial<GrowthState>) => void }) {
  const t = useT();
  const tag = useDateTag();
  const h = useHours();
  const rows: ChannelFunnel[] = [...d.all, ...(d.sources ?? [d.inbound])];
  const active = rows.some((c) => c.touches > 0 || c.steps.some((s) => s.value > 0));
  const values = rows.map((c) => rowValue(view, c, d.costs?.[c.key]));
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <Panel>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold tracking-tight">{t("Channels compared")}</h2>
        <SegmentedSwitch size="sm" label={t("View")} value={view} onChange={(v) => go({ view: v })} options={[{ value: "volume", label: t("Volume") }, { value: "results", label: t("Results") }, { value: "cost", label: t("Cost") }]} />
      </div>
      <p className="mb-4 text-[13px] text-text-2">{t(VIEW_TEXT[view])}</p>
      {!active ? (
        <EmptyState title={t("Nothing logged in this period yet")} action={<Button asChild size="sm" variant="primary"><Link href="/call">{t("Open Call mode")}</Link></Button>}>
          {t("Calls, emails, WhatsApp, LinkedIn and visits all show up here as soon as you log them. Website visits come from the GA4 import in the Web tab.")}
        </EmptyState>
      ) : (
        <ul className="flex flex-col" aria-label={t("Channels compared")}>
          {rows.map((c, i) => {
            const cost = d.costs?.[c.key];
            const v = values[i];
            const name = t(CHANNEL_LABELS[c.key]);
            const shown = view === "cost" ? (v === null ? null : `${formatEur(v)}${cost?.lowSample ? "*" : ""}`) : (v ?? 0).toLocaleString(tag);
            const second = view === "volume" ? (cost ? t("{h} h of work", { h: h(cost.minutes) }) : "")
              : view === "results" ? [t("{n} won", { n: c.won }), c.meetingsPerHour !== null ? t("{x} meetings per hour", { x: c.meetingsPerHour.toLocaleString(tag) }) : null].filter(Boolean).join(" · ")
              : !cost ? "" : [v === null ? t("no meeting yet") : null, cost.cacMinor !== null ? t("CAC {x}", { x: formatEur(cost.cacMinor) }) : v === null ? null : t("no client yet"), t("{x} in total", { x: formatEur(cost.totalMinor) })].filter(Boolean).join(" · ");
            const tip = [`${name}`, `${t("Touches")} ${c.touches.toLocaleString(tag)}`, `${t("Meetings")} ${c.meetings}`, `${t("Won")} ${c.won}`, cost ? t("{h} h of work", { h: h(cost.minutes) }) : null].filter(Boolean).join(" · ");
            return (
              <li key={c.key} className="border-t border-hairline first:border-t-0">
                <button type="button" data-channel={c.key} title={tip} onClick={() => go({ panel: panelOf(c.key), tab: null })}
                  className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1.5 rounded-[12px] px-2 py-2.5 text-left text-sm hover:bg-subtle/60 sm:grid-cols-[13.5rem_minmax(0,1fr)_6.5rem_minmax(0,13rem)_1rem]">
                  <span className={cn("min-w-0 truncate font-medium", !c.touches && !c.meetings && "text-text-3")}>
                    {name}{d.best === c.key ? <span className="ml-2 text-[11px] font-normal text-win">{t("best")}</span> : null}
                  </span>
                  <span className="order-last col-span-3 h-2.5 overflow-hidden rounded-full bg-subtle sm:order-none sm:col-span-1" aria-hidden>
                    {v ? <span className={cn("block h-full rounded-full", view === "results" ? "bg-win" : "bg-sales")} style={{ width: `${(v / max) * 100}%`, minWidth: 4 }} /> : null}
                  </span>
                  <span className={cn("num text-right", shown === null ? "text-[12px] text-text-3" : "font-semibold", view === "results" && v ? "text-win" : null)}>{shown ?? "—"}</span>
                  <span className="order-last col-span-3 truncate text-[12px] text-text-3 sm:order-none sm:col-span-1">{second}</span>
                  <ChevronRight className="size-4 text-text-3 max-sm:row-start-1 max-sm:col-start-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-text-3">{t("Click a channel to see its funnel, its cost and its details.")} {view === "cost" && d.costBasis ? t("Costs: founder time at {x} per hour + every expense in Money of the period. * = estimate, little data.", { x: formatEur(d.costBasis.hourCostEur * 100) }) : t("Meetings and deals are credited to the last channel that touched the business before them. Time comes from the minutes per action in Settings › Targets.")}</p>
      {view === "cost" ? <div className="mt-3"><CostExplainer d={d} /></div> : null}
    </Panel>
  );
}

const TITLE: Record<VerdictKind, string> = { fix: "To improve", watch: "To watch", good: "What works" };
const DOT: Record<VerdictKind, string> = { fix: "bg-bad", watch: "bg-control", good: "bg-win" };

/** "What the numbers say": the 3 most useful readings first (to improve → to watch → what works), "See all" for the rest. */
function VerdictBrief({ verdicts }: { verdicts: Verdict[] }) {
  const t = useT();
  const [all, setAll] = React.useState(false);
  const tv = (v?: Record<string, string | number>) => (v ? Object.fromEntries(Object.entries(v).map(([n, x]) => [n, typeof x === "string" ? t(x) : x])) : undefined);
  const shown = all ? verdicts : verdicts.slice(0, 3);
  return (
    <Panel className="h-full">
      <PanelTitle action={verdicts.length > 3 ? <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)}>{all ? t("Show less") : t("See all {n}", { n: verdicts.length })}</Button> : null}>{t("What the numbers say")}</PanelTitle>
      {verdicts.length === 0 ? <p className="text-sm text-text-2">{t("Not enough data yet to draw conclusions. Keep logging.")}</p> : (
        <ul className="flex flex-col gap-3">
          {shown.map((v, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-snug">
              <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[v.kind])} aria-hidden />
              <div>
                <p><span className="sr-only">{t(TITLE[v.kind])} : </span><span className="font-medium">{t(v.key, tv(v.vars))}</span></p>
                {v.action ? <p className="mt-0.5 text-text-2">→ {t(v.action.key, tv(v.action.vars))}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** "To reply" (count → the list) and Content (week plan and goals) open in the same drawer as the channels. */
function Shortcuts({ go }: { go: (p: Partial<GrowthState>) => void }) {
  const t = useT();
  const inbox = useInbox("team");
  const n = inbox.data?.count;
  const item = "flex min-h-11 w-full items-center gap-3 rounded-[12px] px-2 py-3 text-left hover:bg-subtle/60";
  return (
    <Panel className="flex h-full flex-col gap-1">
      <button type="button" data-shortcut="inbox" className={item} onClick={() => go({ panel: "inbox", tab: null })}>
        <MessageSquareReply className="size-5 shrink-0 text-text-2" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block font-medium">{t("To reply")}</span><span className="block text-[12px] text-text-3">{t("comments, messages, replies and website leads")}</span></span>
        <span className="num text-lg font-semibold">{n === undefined ? "…" : n}</span>
        <ChevronRight className="size-4 text-text-3" aria-hidden />
      </button>
      <button type="button" data-shortcut="content" className={cn(item, "border-t border-hairline")} onClick={() => go({ panel: "content", tab: null })}>
        <CalendarDays className="size-5 shrink-0 text-text-2" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block font-medium">{t("Content")}</span><span className="block text-[12px] text-text-3">{t("plan of the week and content goals")}</span></span>
        <ChevronRight className="size-4 text-text-3" aria-hidden />
      </button>
    </Panel>
  );
}
