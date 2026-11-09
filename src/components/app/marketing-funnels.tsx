"use client";
import * as React from "react";
import { Panel, PanelTitle } from "@/components/ui/form";
import { CALL_BENCHMARKS, type BenchStatus } from "@/domain/cac";
import { formatEur } from "@/lib/utils";
import type { FunnelData } from "./growth-common";
import { useDateTag, useT } from "@/i18n/react";

/** Growth › Calls drawer (round 10, D077): the calls economics; "Channels compared" lives in growth-dashboard.tsx. */
const BENCH_TONE: Record<BenchStatus, string> = { better: "text-win", within: "text-text-2", worse: "text-bad", too_few: "text-text-3" };
const BENCH_TEXT: Record<BenchStatus, string> = { better: "better than the benchmark", within: "within the benchmark", worse: "below the benchmark", too_few: "too few calls to compare" };

/** "What the calls bring": dials → picked up → yes → meetings → clients, calls needed, cost per call / meeting / client, vs researched benchmarks. */
export function CallsEconomics({ d }: { d: FunnelData }) {
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
