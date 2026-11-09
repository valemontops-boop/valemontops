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
import { Bars, Funnel } from "./charts";
import { cn } from "@/lib/utils";
import { useMe } from "./providers";
import { AudienceSummary } from "./marketing-view";
import { useT } from "@/i18n/react";

type CC = Awaited<ReturnType<typeof commandCenter>>;
type Tab = "now" | "sales" | "money" | "content";

export function CommandCenterView() {
  const t = useT();
  const [tab, setTab] = React.useState<Tab>("now");
  const q = useQuery({ queryKey: ["command-center"], queryFn: () => api<CC>("/api/command-center") });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Command Center")}</h1>
          <p className="text-sm text-text-2">{t("Team view")} · {q.data ? t("week of {date}", { date: q.data.weekStart }) : t("loading")}</p>
        </div>
        <SegmentedSwitch label={t("Section")} value={tab} onChange={setTab} options={[{ value: "now", label: t("Now") }, { value: "sales", label: t("Sales") }, { value: "money", label: t("Money") }, { value: "content", label: t("Content") }]} />
      </div>
      {q.isPending ? <Skeleton className="h-96" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : tab === "now" ? <Now d={q.data} /> : tab === "sales" ? <Sales d={q.data} /> : tab === "money" ? <Money d={q.data} /> : <AudienceSummary />}
    </div>
  );
}

function Now({ d }: { d: CC }) {
  const t = useT();
  const me = useMe();
  return (
    <>
      <div data-testid="primary-numbers" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {d.now.numbers.map((n) => (
          <BigNumber key={n.key} label={t(n.label)} dark={n.key === "contacted"} muted={n.value === null} tone={n.key === "weighted" ? "win" : n.key === "meetings" ? "win" : n.key === "cash" || n.key === "mrr" ? "win" : "sales"}
            value={n.value === null ? t(n.display) : "money" in n && n.money ? formatEur(n.value) : <>{n.value}{"target" in n && n.target ? <span className="text-xl font-medium opacity-70"> / {n.target}</span> : null}</>}
            note={n.note ? t(n.note) : undefined} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel aria-labelledby="att" className="xl:col-span-2">
          <PanelTitle action={d.now.attentionTotal > 5 ? <span className="text-[13px] text-text-3">{t("5 of {n}", { n: d.now.attentionTotal })}</span> : null}><span id="att">{t("Needs attention")}</span></PanelTitle>
          {d.now.attention.length === 0 ? <p className="text-sm text-text-2">{t("Nothing overdue. Every open deal has a dated next step.")}</p> : (
            <ul className="flex flex-col">
              {d.now.attention.map((a, i) => (
                <li key={i} className="border-t border-hairline first:border-t-0">
                  <Link href={a.href} className="flex flex-col py-2.5 hover:bg-subtle/50"><span className="font-medium">{t(a.title)}</span><span className="text-[13px] text-text-2">{t(a.detail)}</span></Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel aria-labelledby="next3">
          <PanelTitle><span id="next3">{t("Next on the calendar")}</span></PanelTitle>
          {d.now.nextEvents.length === 0 ? <p className="text-sm text-text-2">{t("Nothing in the next 7 days, or calendars are not connected")} (<Link className="underline" href="/settings">{t("Settings › Calendars")}</Link>).</p> : (
            <ul className="flex flex-col gap-2">
              {d.now.nextEvents.map((e) => <li key={e.id} className="text-sm"><p className="font-medium">{t(e.title)}</p><p className="num text-[13px] text-text-2">{fmtDateTime(e.start)}{e.kind === "other_busy" ? ` · ${t("other founder")}` : ""}</p></li>)}
            </ul>
          )}
        </Panel>
      </div>
      {d.now.sprint ? (
        <Panel aria-labelledby="sprint">
          <PanelTitle action={<span className="text-[13px] text-text-3">{d.now.sprint.sprint.start_date} → {d.now.sprint.sprint.end_date} · {t("{n} days left", { n: d.now.sprint.daysLeft })}</span>}><span id="sprint">{d.now.sprint.sprint.name}</span></PanelTitle>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {(["theo", "pablo"] as const).map((f) => {
              const p = d.now.sprint!.perFounder[f];
              return (
                <div key={f} className="flex flex-col gap-3">
                  <p className="font-medium">{FOUNDER_NAMES[f]}{f === me.founder ? ` ${t("(you)")}` : ""}</p>
                  {(["contacted", "replies", "demos", "pilots"] as const).map((k) => (
                    <div key={k} className="grid grid-cols-[140px_1fr_64px] items-center gap-3 text-sm">
                      <span className="text-text-2">{t({ contacted: "Businesses contacted", replies: "Qualified replies", demos: "Demos", pilots: "Pilot clients" }[k])}</span>
                      <ProgressBar value={p[k]} target={p.target[k]} label={`${FOUNDER_NAMES[f]} ${t({ contacted: "Businesses contacted", replies: "Qualified replies", demos: "Demos", pilots: "Pilot clients" }[k])}`} />
                      <span className="num text-right">{p[k]}/{p.target[k]}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-5 border-t border-hairline pt-4">
            <p className="mb-2 text-[13px] font-medium text-text-2">{t("Effort by brand (outreach with a brand: {n} of {total})", { n: d.now.sprint.outreachWithBrand, total: d.now.sprint.outreachTotal })}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {Object.entries(d.now.sprint.brandSplit).map(([b, v]) => (
                <span key={b}><span className="font-medium">{t(BRAND_LABELS[b as "local"])}</span> <span className="num">{v.actual === null ? "—" : `${Math.round(v.actual * 100)}%`}</span> <span className="text-text-3">{t("target {pct}%", { pct: Math.round(v.target * 100) })}</span></span>
              ))}
            </div>
          </div>
        </Panel>
      ) : (
        <Panel><p className="text-sm text-text-2">{t("No active sprint.")} <Link className="underline" href="/settings">{t("Start one in Settings › Sprint")}</Link>.</p></Panel>
      )}
    </>
  );
}


/** Two founders side by side on one scale: Théo in ink, Pablo in grey, values printed. */
function PairBars({ rows, a, b }: { rows: { label: string; a: number; b: number; tone?: "sales" | "win" }[]; a: string; b: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  return (
    <div>
      <p className="mb-2 flex gap-4 text-[12px] text-text-2"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-ink" />{a}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-control" />{b}</span></p>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(110px,32%)_1fr] items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 truncate text-text-2">{r.tone ? <span className={cn("size-2 shrink-0 rounded-full", r.tone === "win" ? "bg-win" : "bg-sales")} /> : null}{r.label}</span>
            <span className="flex flex-col gap-1">
              {([["a", r.a, "bg-ink"], ["b", r.b, "bg-control"]] as const).map(([k, v, cls]) => (
                <span key={k} className="flex items-center gap-2"><span className={cn("h-2.5 rounded-full", cls)} style={{ width: `${(v / max) * 85}%`, minWidth: v ? 4 : 0 }} /><span className="num text-[12px] font-medium">{v}</span></span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sales({ d }: { d: CC }) {
  const t = useT();
  const metrics: Metric[] = ["calls", "field_visits", "dms", "invitations", "inmails", "cold_emails", "follow_ups"];
  const th = d.sales.perFounder.theo, p = d.sales.perFounder.pablo;
  const fun = (f: typeof th) => [
    { label: t("Attempts"), value: f.funnel.attempted, tone: "sales" as const }, { label: t("Conversations"), value: f.funnel.conversations, tone: "sales" as const },
    { label: t("Meetings booked"), value: f.funnel.meetingsBooked, tone: "win" as const }, { label: t("Proposals"), value: f.funnel.proposals, tone: "win" as const }, { label: t("Won"), value: f.funnel.sales, tone: "win" as const },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {([["theo", th], ["pablo", p]] as const).map(([f, x]) => (
          <Panel key={f}>
            <PanelTitle action={<span className="num text-[13px] text-text-2">{t("{n} new businesses", { n: x.newBusinesses })}</span>}>{FOUNDER_NAMES[f]} · {t(d.sales.sinceLabel).toLowerCase()}</PanelTitle>
            <Funnel steps={fun(x)} />
          </Panel>
        ))}
      </div>
      <Panel>
        <PanelTitle>{t("Outreach by channel")}</PanelTitle>
        <PairBars a={FOUNDER_NAMES.theo} b={FOUNDER_NAMES.pablo} rows={metrics.filter((m) => (th.byMetric[m] ?? 0) + (p.byMetric[m] ?? 0) > 0).map((m) => ({ label: t(METRIC_LABELS[m]), a: th.byMetric[m] ?? 0, b: p.byMetric[m] ?? 0, tone: "sales" as const }))} />
      </Panel>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>{t("France vs Spain this week")}</PanelTitle>
          <PairBars a={t("France")} b={t("Spain")} rows={(["attempted", "conversations", "demos", "meetingsBooked"] as const).map((k) => ({ label: t({ attempted: "Attempts", conversations: "Conversations", demos: "Demos", meetingsBooked: "Meetings booked" }[k]), a: d.sales.market.FR[k], b: d.sales.market.ES[k], tone: k === "meetingsBooked" || k === "demos" ? ("win" as const) : ("sales" as const) }))} />
        </Panel>
        <Panel>
          <PanelTitle>{t("Outreach by brand this week")}</PanelTitle>
          <Bars tone="sales" data={Object.entries(d.sales.brands).map(([b, n]) => ({ label: t(BRAND_LABELS[b as "local"]), value: n as number }))} />
        </Panel>
      </div>
    </>
  );
}

function Money({ d }: { d: CC }) {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BigNumber tone="sales" label={t("Pipeline value (open)")} value={formatEur(d.money.pipelineValue)} note={t("Sum of open deal values, not revenue")} />
        <BigNumber tone="sales" label={t("Weighted pipeline")} value={formatEur(d.money.weighted)} note={t("Value × stage probability; never added to revenue")} />
        <BigNumber dark label={t("Won this month")} value={formatEur(d.money.wonThisMonth.valueMinor)} note={t("{n} deal(s)", { n: d.money.wonThisMonth.count })} />
      </div>
      <Panel className="overflow-x-auto">
        <PanelTitle>{t("Opportunities by stage")}</PanelTitle>
        <Bars data={d.money.byStage.map((s) => ({ label: t(s.label), value: s.count, sub: formatEur(s.valueMinor), tone: s.stage === "won" ? ("win" as const) : ("sales" as const) }))} />
      </Panel>
      <Panel>
        <PanelTitle>{t("Not tracked yet")}</PanelTitle>
        <p className="text-sm text-text-2">{t("These arrive with Finance (Stage 3) and are never shown as zero before then: {items}.", { items: d.money.notTracked.map((x) => t(x)).join(", ") })}</p>
      </Panel>
    </>
  );
}
