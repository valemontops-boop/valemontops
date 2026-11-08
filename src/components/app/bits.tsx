"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Dot matrix (DESIGN.md): one dot per day; shape as well as color encodes the status. */
export function DayDots({ days, label }: { days: { date: string; status: string; attainment: number | null }[]; label: string }) {
  const shape = (s: string) =>
    s === "perfect" ? "size-3 rounded-full bg-ink ring-2 ring-ink ring-offset-1 ring-offset-panel"
      : s === "passed" ? "size-3 rounded-full bg-ink"
        : s === "missed" ? "size-3 rounded-full border-2 border-bad"
          : s === "in_progress" ? "size-3 rounded-full border-2 border-ink"
            : "h-0.5 w-3 rounded bg-control/60";
  const word = (s: string) => ({ perfect: "Perfect", passed: "Passed", missed: "Missed", in_progress: "In progress", off: "Off", scheduled: "Scheduled" }[s] ?? s);
  return (
    <div>
      <ul aria-label={label} className="flex flex-wrap items-center gap-[7px]">
        {days.map((d) => (
          <li key={d.date} title={`${d.date}: ${word(d.status)}${d.attainment !== null ? ` · ${Math.round(d.attainment * 100)}%` : ""}`} className="flex size-3 items-center justify-center">
            <span className={shape(d.status)} />
            <span className="sr-only">{`${d.date} ${word(d.status)}`}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-text-3">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-ink" />Passed</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-ink ring-2 ring-ink ring-offset-1 ring-offset-panel" />Perfect</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full border-2 border-bad" />Missed</span>
        <span className="flex items-center gap-1"><span className="h-0.5 w-2.5 rounded bg-control/60" />Off</span>
      </p>
    </div>
  );
}

/** Solid = recorded fact, hatched = remaining target (DESIGN.md). */
export function ProgressBar({ value, target, label }: { value: number; target: number; label: string }) {
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={value} className="relative h-2.5 overflow-hidden rounded-full">
      <div className="hatch absolute inset-0" />
      <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export function BigNumber({ label, value, note, dark, muted }: { label: string; value: React.ReactNode; note?: React.ReactNode; dark?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[20px] p-5", dark ? "bg-ink text-panel" : "bg-panel")}>
      <p className={cn("text-[13px] font-medium", dark ? "text-panel/80" : "text-text-2")}>{label}</p>
      <p className={cn("num font-semibold tracking-tight", muted ? "text-lg leading-[2.5rem] text-text-3" : "text-[40px] leading-none")}>{value}</p>
      {note ? <p className={cn("text-[12px]", dark ? "text-panel/75" : "text-text-3")}>{note}</p> : null}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "bad" | "good" | "dark" }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium",
      tone === "bad" ? "bg-[#fbeceb] text-bad" : tone === "good" ? "bg-[#e6f2ec] text-good" : tone === "dark" ? "bg-ink text-panel" : "bg-subtle text-text-2")}>{children}</span>
  );
}

export function fmtDateTime(iso: string, tz?: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}
export function fmtDay(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}
