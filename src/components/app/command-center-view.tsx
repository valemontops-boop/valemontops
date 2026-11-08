"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { ErrorState, Panel, PanelTitle, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { BRAND_LABELS, FOUNDER_NAMES, METRIC_LABELS, type Metric } from "@/domain/constants";
import { api } from "@/lib/api";
import { formatEur } from "@/lib/utils";
import type { commandCenter } from "@/server/services/insights";
import { BigNumber, ProgressBar, fmtDateTime } from "./bits";
import { useMe } from "./providers";
import { AudienceSummary } from "./marketing-view";

type CC = Awaited<ReturnType<typeof commandCenter>>;
type Tab = "now" | "sales" | "money" | "content";

export function CommandCenterView() {
  const [tab, setTab] = React.useState<Tab>("now");
  const q = useQuery({ queryKey: ["command-center"], queryFn: () => api<CC>("/api/command-center") });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-text-2">Team view · {q.data ? `week of ${q.data.weekStart}` : "loading"}</p>
        </div>
        <SegmentedSwitch label="Section" value={tab} onChange={setTab} options={[{ value: "now", label: "Now" }, { value: "sales", label: "Sales" }, { value: "money", label: "Money" }, { value: "content", label: "Content" }]} />
      </div>
      {q.isPending ? <Skeleton className="h-96" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : tab === "now" ? <Now d={q.data} /> : tab === "sales" ? <Sales d={q.data} /> : tab === "money" ? <Money d={q.data} /> : <AudienceSummary />}
    </div>
  );
}

function Now({ d }: { d: CC }) {
  const me = useMe();
  return (
    <>
      <div data-testid="primary-numbers" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {d.now.numbers.map((n) => (
          <BigNumber key={n.key} label={n.label} dark={n.key === "contacted"} muted={n.value === null}
            value={n.value === null ? n.display : "money" in n && n.money ? formatEur(n.value) : <>{n.value}{"target" in n && n.target ? <span className="text-xl font-medium opacity-70"> / {n.target}</span> : null}</>}
            note={n.note} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel aria-labelledby="att" className="xl:col-span-2">
          <PanelTitle action={d.now.attentionTotal > 5 ? <span className="text-[13px] text-text-3">5 of {d.now.attentionTotal}</span> : null}><span id="att">Needs attention</span></PanelTitle>
          {d.now.attention.length === 0 ? <p className="text-sm text-text-2">Nothing overdue. Every open deal has a dated next step.</p> : (
            <ul className="flex flex-col">
              {d.now.attention.map((a, i) => (
                <li key={i} className="border-t border-hairline first:border-t-0">
                  <Link href={a.href} className="flex flex-col py-2.5 hover:bg-subtle/50"><span className="font-medium">{a.title}</span><span className="text-[13px] text-text-2">{a.detail}</span></Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel aria-labelledby="next3">
          <PanelTitle><span id="next3">Next on the calendar</span></PanelTitle>
          {d.now.nextEvents.length === 0 ? <p className="text-sm text-text-2">Nothing in the next 7 days, or calendars are not connected (<Link className="underline" href="/settings">Settings › Calendars</Link>).</p> : (
            <ul className="flex flex-col gap-2">
              {d.now.nextEvents.map((e) => <li key={e.id} className="text-sm"><p className="font-medium">{e.title}</p><p className="num text-[13px] text-text-2">{fmtDateTime(e.start)}{e.kind === "other_busy" ? " · other founder" : ""}</p></li>)}
            </ul>
          )}
        </Panel>
      </div>
      {d.now.sprint ? (
        <Panel aria-labelledby="sprint">
          <PanelTitle action={<span className="text-[13px] text-text-3">{d.now.sprint.sprint.start_date} → {d.now.sprint.sprint.end_date} · {d.now.sprint.daysLeft} days left</span>}><span id="sprint">{d.now.sprint.sprint.name}</span></PanelTitle>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {(["theo", "pablo"] as const).map((f) => {
              const p = d.now.sprint!.perFounder[f];
              return (
                <div key={f} className="flex flex-col gap-3">
                  <p className="font-medium">{FOUNDER_NAMES[f]}{f === me.founder ? " (you)" : ""}</p>
                  {(["contacted", "replies", "demos", "pilots"] as const).map((k) => (
                    <div key={k} className="grid grid-cols-[140px_1fr_64px] items-center gap-3 text-sm">
                      <span className="text-text-2">{{ contacted: "Businesses contacted", replies: "Qualified replies", demos: "Demos", pilots: "Pilot clients" }[k]}</span>
                      <ProgressBar value={p[k]} target={p.target[k]} label={`${FOUNDER_NAMES[f]} ${k}`} />
                      <span className="num text-right">{p[k]}/{p.target[k]}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-5 border-t border-hairline pt-4">
            <p className="mb-2 text-[13px] font-medium text-text-2">Effort by brand (outreach with a brand: {d.now.sprint.outreachWithBrand} of {d.now.sprint.outreachTotal})</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {Object.entries(d.now.sprint.brandSplit).map(([b, v]) => (
                <span key={b}><span className="font-medium">{BRAND_LABELS[b as "local"]}</span> <span className="num">{v.actual === null ? "—" : `${Math.round(v.actual * 100)}%`}</span> <span className="text-text-3">target {Math.round(v.target * 100)}%</span></span>
              ))}
            </div>
          </div>
        </Panel>
      ) : (
        <Panel><p className="text-sm text-text-2">No active sprint. <Link className="underline" href="/settings">Start one in Settings › Sprint</Link>.</p></Panel>
      )}
    </>
  );
}

const pct = (r: { num: number; den: number; pct: number | null }) => (r.pct === null ? `${r.num}/${r.den} (not enough data)` : `${Math.round(r.pct * 100)}% (${r.num}/${r.den})`);

function Sales({ d }: { d: CC }) {
  const metrics: Metric[] = ["calls", "field_visits", "dms", "invitations", "inmails", "cold_emails", "follow_ups"];
  return (
    <>
      <Panel className="overflow-x-auto">
        <PanelTitle>{d.sales.sinceLabel}: outreach per founder</PanelTitle>
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium">Count</th>{(["theo", "pablo"] as const).map((f) => <th key={f} className="text-right font-medium">{FOUNDER_NAMES[f]}</th>)}</tr></thead>
          <tbody>
            {metrics.map((m) => <tr key={m} className="border-t border-hairline"><td className="py-1.5">{METRIC_LABELS[m]}</td>{(["theo", "pablo"] as const).map((f) => <td key={f} className="num text-right">{d.sales.perFounder[f].byMetric[m] ?? 0}</td>)}</tr>)}
            <tr className="border-t border-hairline font-medium"><td className="py-1.5">New businesses contacted</td>{(["theo", "pablo"] as const).map((f) => <td key={f} className="num text-right">{d.sales.perFounder[f].newBusinesses}</td>)}</tr>
            {(["attempted", "conversations", "demos", "meetingsBooked", "meetingsHeld", "proposals", "sales"] as const).map((k) => (
              <tr key={k} className="border-t border-hairline"><td className="py-1.5">{{ attempted: "Contact attempts", conversations: "Conversations held", demos: "Demos shown", meetingsBooked: "Meetings booked", meetingsHeld: "Meetings held", proposals: "Proposals sent", sales: "Deals won" }[k]}</td>{(["theo", "pablo"] as const).map((f) => <td key={f} className="num text-right">{d.sales.perFounder[f].funnel[k]}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[13px] text-text-2">Conversation rate: Théo {pct({ num: d.sales.perFounder.theo.funnel.conversations, den: d.sales.perFounder.theo.funnel.attempted, pct: d.sales.perFounder.theo.funnel.attempted >= 20 ? d.sales.perFounder.theo.funnel.conversations / d.sales.perFounder.theo.funnel.attempted : null })} · Pablo {pct({ num: d.sales.perFounder.pablo.funnel.conversations, den: d.sales.perFounder.pablo.funnel.attempted, pct: d.sales.perFounder.pablo.funnel.attempted >= 20 ? d.sales.perFounder.pablo.funnel.conversations / d.sales.perFounder.pablo.funnel.attempted : null })}</p>
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel className="overflow-x-auto">
          <PanelTitle>France vs Spain this week</PanelTitle>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium" /><th className="text-right font-medium">France</th><th className="text-right font-medium">Spain</th></tr></thead>
            <tbody>{(["attempted", "conversations", "demos", "meetingsBooked"] as const).map((k) => <tr key={k} className="border-t border-hairline"><td className="py-1.5">{{ attempted: "Attempts", conversations: "Conversations", demos: "Demos", meetingsBooked: "Meetings booked" }[k]}</td><td className="num text-right">{d.sales.market.FR[k]}</td><td className="num text-right">{d.sales.market.ES[k]}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel>
          <PanelTitle>Outreach by brand this week</PanelTitle>
          <ul className="flex flex-col gap-2 text-sm">{Object.entries(d.sales.brands).map(([b, n]) => <li key={b} className="flex justify-between"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: `var(--brand-${b})` }} />{BRAND_LABELS[b as "local"]}</span><span className="num">{n}</span></li>)}</ul>
        </Panel>
      </div>
    </>
  );
}

function Money({ d }: { d: CC }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BigNumber label="Pipeline value (open)" value={formatEur(d.money.pipelineValue)} note="Sum of open deal values, not revenue" />
        <BigNumber label="Weighted pipeline" value={formatEur(d.money.weighted)} note="Value × stage probability; never added to revenue" />
        <BigNumber label="Won this month" value={formatEur(d.money.wonThisMonth.valueMinor)} note={`${d.money.wonThisMonth.count} deal(s)`} />
      </div>
      <Panel className="overflow-x-auto">
        <PanelTitle>Opportunities by stage</PanelTitle>
        <table className="w-full min-w-[420px] text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1.5 font-medium">Stage</th><th className="text-right font-medium">Deals</th><th className="text-right font-medium">Value</th></tr></thead>
          <tbody>{d.money.byStage.map((s) => <tr key={s.stage} className="border-t border-hairline"><td className="py-1.5">{s.label}</td><td className="num text-right">{s.count}</td><td className="num text-right">{formatEur(s.valueMinor)}</td></tr>)}</tbody>
        </table>
      </Panel>
      <Panel>
        <PanelTitle>Not tracked yet</PanelTitle>
        <p className="text-sm text-text-2">These arrive with Finance (Stage 3) and are never shown as zero before then: {d.money.notTracked.join(", ")}.</p>
      </Panel>
    </>
  );
}
