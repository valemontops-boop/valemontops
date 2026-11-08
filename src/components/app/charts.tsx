"use client";
import { cn } from "@/lib/utils";

/** Horizontal bars with direct labels; one question per chart, values always printed (DESIGN.md). */
type Tone = "ink" | "muted" | "volume" | "yes";
const TONE: Record<Tone, string> = { ink: "bg-ink", muted: "bg-control", volume: "bg-viz-volume", yes: "bg-viz-yes" };
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
            <span className={cn("absolute inset-y-0 left-0 rounded-[6px]", TONE[d.tone ?? tone])} style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="num min-w-12 text-right font-medium">{d.value}{showShare && first > 0 && d !== data[0] ? <span className="ml-1 text-[12px] font-normal text-text-3">{Math.round((d.value / first) * 100)}%</span> : null}{d.sub ? <span className="block text-[11px] font-normal text-text-3">{d.sub}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns for a daily series (solid = done, hatched = target remaining). */
export function Columns({ data, height = 140, label }: { data: { key: string; label: string; value: number; target?: number; highlight?: boolean }[]; height?: number; label: string }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.target ?? 0)));
  return (
    <div role="img" aria-label={label}>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d) => (
          <div key={d.key} className="relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${d.value}${d.target ? ` / ${d.target}` : ""}`}>
            {d.target && d.target > d.value ? <div className="hatch absolute inset-x-0 bottom-0 rounded-t-[4px]" style={{ height: `${(d.target / max) * 100}%` }} /> : null}
            <div className={cn("relative rounded-t-[4px]", d.highlight ? "bg-ink" : "bg-ink/80")} style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">{data.map((d, i) => <span key={d.key} className="num flex-1 text-center text-[10px] text-text-3">{i % Math.ceil(data.length / 10) === 0 ? d.label : ""}</span>)}</div>
    </div>
  );
}

/** KPI tile. `tone` ties the tile to its chart series with a soft tint and a colored key; values stay in text ink. */
export function Kpi({ label, value, delta, note, dark, tone }: { label: string; value: string; delta?: number | null; note?: string; dark?: boolean; tone?: "volume" | "yes" }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-[20px] p-4", dark ? "bg-ink text-panel" : tone === "volume" ? "bg-viz-volume-soft" : tone === "yes" ? "bg-viz-yes-soft" : "bg-panel")}>
      <p className={cn("flex items-center gap-1.5 text-[13px]", dark ? "text-panel/80" : "text-text-2")}>{tone ? <span aria-hidden className={cn("size-2.5 rounded-full", tone === "volume" ? "bg-viz-volume" : "bg-viz-yes")} /> : null}{label}</p>
      <p className="num text-[32px] font-semibold leading-none tracking-tight">{value}</p>
      <p className={cn("text-[12px]", dark ? "text-panel/75" : "text-text-3")}>
        {delta !== undefined && delta !== null ? <span className={cn("mr-1 rounded-full px-1.5 py-0.5 font-medium", dark ? "bg-panel/15" : delta >= 0 ? "bg-[#e6f2ec] text-good" : "bg-[#fbeceb] text-bad")}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span> : null}
        {note}
      </p>
    </div>
  );
}
