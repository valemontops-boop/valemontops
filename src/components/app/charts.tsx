"use client";
import { cn } from "@/lib/utils";

/** Horizontal bars with direct labels; one question per chart, values always printed (DESIGN.md). */
export function Bars({ data, showShare, max: forcedMax, tone = "ink" }: { data: { label: string; value: number; sub?: string; hatched?: number }[]; showShare?: boolean; max?: number; tone?: "ink" | "muted" }) {
  const max = forcedMax ?? Math.max(1, ...data.map((d) => Math.max(d.value, d.hatched ?? 0)));
  const first = data[0]?.value || 0;
  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(84px,30%)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-text-2">{d.label}</span>
          <span className="relative h-6 overflow-hidden rounded-[6px] bg-subtle/70">
            {d.hatched ? <span className="hatch absolute inset-y-0 left-0" style={{ width: `${(d.hatched / max) * 100}%` }} /> : null}
            <span className={cn("absolute inset-y-0 left-0 rounded-[6px]", tone === "ink" ? "bg-ink" : "bg-control")} style={{ width: `${(d.value / max) * 100}%` }} />
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

export function Kpi({ label, value, delta, note, dark }: { label: string; value: string; delta?: number | null; note?: string; dark?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-[20px] p-4", dark ? "bg-ink text-panel" : "bg-panel")}>
      <p className={cn("text-[13px]", dark ? "text-panel/80" : "text-text-2")}>{label}</p>
      <p className="num text-[32px] font-semibold leading-none tracking-tight">{value}</p>
      <p className={cn("text-[12px]", dark ? "text-panel/75" : "text-text-3")}>
        {delta !== undefined && delta !== null ? <span className={cn("mr-1 rounded-full px-1.5 py-0.5 font-medium", dark ? "bg-panel/15" : delta >= 0 ? "bg-[#e6f2ec] text-good" : "bg-[#fbeceb] text-bad")}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span> : null}
        {note}
      </p>
    </div>
  );
}
