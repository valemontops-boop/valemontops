"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { TONE_BAR, TONE_SOFT, TONE_VAR, type Tone } from "@/lib/tones";

/**
 * Shared dashboard pieces, one color system (D044): blue = sales activity, green = results,
 * violet = marketing, teal = ops, ink = the one headline. Values always printed, never color alone.
 */

/** Horizontal bars with direct labels. Each row may carry its own tone. */
export function Bars({ data, showShare, max: forcedMax, tone = "ink" }: { data: { label: string; value: number; sub?: string; hatched?: number; tone?: Tone }[]; showShare?: boolean; max?: number; tone?: Tone }) {
  const max = forcedMax ?? Math.max(1, ...data.map((d) => Math.max(d.value, d.hatched ?? 0)));
  const first = data[0]?.value || 0;
  const hasSub = data.some((d) => d.sub);
  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((d) => (
        <li key={d.label} className={cn("grid items-center gap-3 text-sm", hasSub ? "grid-cols-[minmax(84px,30%)_1fr_8rem]" : "grid-cols-[minmax(84px,30%)_1fr_4.5rem]")}>
          <span className="truncate text-text-2">{d.label}</span>
          <span className="relative h-6 overflow-hidden rounded-[6px] bg-subtle/70">
            {d.hatched ? <span className="hatch absolute inset-y-0 left-0" style={{ width: `${(d.hatched / max) * 100}%` }} /> : null}
            <span className={cn("absolute inset-y-0 left-0 rounded-[6px] transition-[width] duration-300", TONE_BAR[d.tone ?? tone])} style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="num text-right font-medium">{d.value}{showShare && first > 0 && d !== data[0] ? <span className="ml-1 text-[12px] font-normal text-text-3">{Math.round((d.value / first) * 100)}%</span> : null}{d.sub ? <span className="block text-[11px] font-normal text-text-3">{d.sub}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns for a short series (solid = done, hatched = target remaining). */
export function Columns({ data, height = 140, label, tone = "ink" }: { data: { key: string; label: string; value: number; target?: number; highlight?: boolean; display?: string }[]; height?: number; label: string; tone?: Tone }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target ?? 0)));
  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((d) => (
          <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${d.display ?? d.value}${d.target ? ` / ${d.target}` : ""}`}>
            {d.target && d.target > d.value ? <div className="hatch absolute inset-x-0 bottom-0 rounded-t-[4px]" style={{ height: `${(d.target / max) * 100}%` }} /> : null}
            <span className="num pointer-events-none mb-1 text-center text-[11px] font-medium text-text-2">{d.value ? d.display ?? d.value : ""}</span>
            <div className={cn("relative rounded-t-[5px]", TONE_BAR[tone], d.highlight === false && "opacity-45")} style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">{data.map((d, i) => <span key={d.key} className="num flex-1 text-center text-[10px] text-text-3">{i % Math.ceil(data.length / 12) === 0 ? d.label : ""}</span>)}</div>
    </div>
  );
}

/** Tiny line for a KPI tile: the trend at a glance, no axis. */
export function Spark({ values, tone = "ink", className }: { values: number[]; tone?: Tone; className?: string }) {
  if (values.length < 2) return null;
  const w = 100, h = 28;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={TONE_VAR[tone]} opacity={0.12} />
      <path d={d} fill="none" stroke={TONE_VAR[tone]} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * KPI tile: tinted by its tone, big value, change vs the previous period, optional trend line or
 * progress toward a target. `dark` = the page's one ink headline.
 */
export function Kpi({ label, value, delta, note, dark, tone, spark, progress }: { label: string; value: React.ReactNode; delta?: number | null; note?: React.ReactNode; dark?: boolean; tone?: Tone; spark?: number[]; progress?: { value: number; target: number } }) {
  const t = tone ?? "ink";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[20px] p-4", dark ? "bg-ink text-panel" : tone ? TONE_SOFT[t] : "bg-panel")}>
      <p className={cn("flex items-center gap-1.5 text-[13px] font-medium", dark ? "text-panel/80" : "text-text-2")}>{tone && !dark ? <span aria-hidden className={cn("size-2.5 rounded-full", TONE_BAR[t])} /> : null}{label}</p>
      <p className="num text-[32px] font-semibold leading-none tracking-tight">{value}</p>
      {progress ? (
        <div className={cn("mt-1 h-1.5 overflow-hidden rounded-full", dark ? "bg-panel/20" : "bg-panel/80")} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={progress.value}>
          <div className={cn("h-full rounded-full", dark ? "bg-panel" : TONE_BAR[t])} style={{ width: `${Math.min(100, progress.target ? (progress.value / progress.target) * 100 : 0)}%` }} />
        </div>
      ) : null}
      {spark ? <Spark values={spark} tone={dark ? "muted" : t} className="mt-1" /> : null}
      {delta !== undefined || note ? (
        <p className={cn("text-[12px]", dark ? "text-panel/75" : "text-text-3")}>
          {delta !== undefined && delta !== null ? <span className={cn("mr-1 rounded-full px-1.5 py-0.5 font-medium", dark ? "bg-panel/15" : delta >= 0 ? "bg-panel text-good" : "bg-panel text-bad")}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span> : null}
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Funnel read left to right: each step a bar sized by volume, with the conversion from the previous
 * step in a pill between them. Easier to read than a list of numbers.
 */
export function Funnel({ steps }: { steps: { label: string; value: number; tone?: Tone }[] }) {
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s, i) => {
        const prev = steps[i - 1]?.value;
        const conv = i > 0 && prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label}>
            {i > 0 ? <p className="num my-0.5 pl-3 text-[11px] text-text-3">↓ {conv === null ? "—" : `${conv}%`}</p> : null}
            <div className="grid grid-cols-[minmax(90px,28%)_1fr_3.5rem] items-center gap-3 text-sm">
              <span className="truncate font-medium">{s.label}</span>
              <span className="relative h-8 overflow-hidden rounded-[8px] bg-subtle/70">
                <span className={cn("absolute inset-y-0 left-0 rounded-[8px]", TONE_BAR[s.tone ?? "ink"])} style={{ width: `${Math.max(s.value ? 2 : 0, (s.value / max) * 100)}%` }} />
              </span>
              <span className="num text-right text-[18px] font-semibold">{s.value}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Progress ring for one score (e.g. today's attainment). */
export function Ring({ value, size = 64, tone = "win", label }: { value: number | null; size?: number; tone?: Tone; label: string }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(v * 100)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--subtle)" strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TONE_VAR[tone]} strokeWidth={7} strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} />
      </svg>
      <span className="num absolute text-[15px] font-semibold">{value === null ? "—" : `${Math.round(v * 100)}%`}</span>
    </div>
  );
}

/** Section heading with its color key. */
export function ToneTitle({ tone, children, id, className }: { tone: Tone; children: React.ReactNode; id?: string; className?: string }) {
  return <h2 id={id} className={cn("flex items-center gap-2 text-lg font-semibold", className)}><span aria-hidden className={cn("h-5 w-1.5 rounded-full", TONE_BAR[tone])} />{children}</h2>;
}

/** Stacked share bar (e.g. won vs lost) with labels underneath. */
export function SplitBar({ parts, label }: { parts: { label: string; value: number; tone: Tone }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {parts.map((p) => <span key={p.label} className={TONE_BAR[p.tone]} style={{ width: `${(p.value / total) * 100}%` }} />)}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-4 text-[12px] text-text-2">{parts.map((p) => <span key={p.label} className="flex items-center gap-1"><span className={cn("size-2 rounded-full", TONE_BAR[p.tone])} />{p.label} <b className="num font-medium text-ink">{p.value}</b></span>)}</p>
    </div>
  );
}
