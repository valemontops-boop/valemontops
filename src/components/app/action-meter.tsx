"use client";
import { cn } from "@/lib/utils";
import { TONE_BAR, type Tone } from "@/lib/tones";
import { useT } from "@/i18n/react";

/**
 * Signature component (DESIGN.md): one tick per action up to the target. Filled = confirmed by the server,
 * hollow = saving, hatched = remaining. Above 60 it falls back to a continuous bar.
 */
export function ActionMeter({ label, actual, target, pending = 0, onLog, tone = "sales" }: { label: string; actual: number; target: number; pending?: number; onLog?: () => void; tone?: Tone }) {
  const t = useT();
  const done = Math.min(actual, target);
  const extra = Math.max(0, actual - target);
  const pend = Math.min(pending, Math.max(0, target - done));
  const fill = actual >= target ? "bg-win" : TONE_BAR[tone]; // the target reached turns green
  return (
    <div className={cn("grid items-center gap-x-4 gap-y-2 py-3", onLog ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1")}>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{label}</span>
        <span className="num text-sm text-text-2">
          {actual}/{target}
          {extra > 0 ? ` (+${extra})` : ""}
        </span>
        {pending > 0 ? <span className="text-[12px] text-text-3">{t("saving…")}</span> : null}
      </div>
      {onLog ? (
        <button type="button" onClick={onLog} className="row-span-2 h-11 min-w-16 rounded-full border border-control px-4 text-sm font-medium hover:bg-subtle" aria-label={t("Log {what}", { what: label.toLowerCase() })}>
          {t("+ Log")}
        </button>
      ) : null}
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={actual} className="min-w-0">
        {target <= 60 ? (
          <div className="flex flex-wrap gap-[3px]">
            {Array.from({ length: target }, (_, i) => (
              <span key={i}
                className={cn("h-4 w-[10px] rounded-[3px]",
                  i < done ? cn("tick-fill", fill) : i < done + pend ? "border-2 border-ink bg-transparent" : "hatch")} />
            ))}
          </div>
        ) : (
          <div className="relative h-4 overflow-hidden rounded-full">
            <div className="hatch absolute inset-0" />
            <div className={cn("absolute inset-y-0 left-0 transition-[width]", fill)}  style={{ width: `${(done / target) * 100}%` }} />
            <div className="absolute inset-y-0 border-2 border-ink" style={{ left: `${(done / target) * 100}%`, width: `${(pend / target) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
