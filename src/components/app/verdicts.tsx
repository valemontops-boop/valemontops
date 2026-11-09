"use client";
import * as React from "react";
import { Panel, PanelTitle } from "@/components/ui/form";
import type { Verdict, VerdictKind } from "@/domain/verdicts";
import { useT } from "@/i18n/react";
import { cn } from "@/lib/utils";

const ORDER: VerdictKind[] = ["fix", "watch", "good"];
const TITLE: Record<VerdictKind, string> = { fix: "To improve", watch: "To watch", good: "What works" };
const DOT: Record<VerdictKind, string> = { fix: "bg-bad", watch: "bg-control", good: "bg-win" };

/** Reading of the numbers: what to improve first (with the next step), what to watch, what works. */
export function VerdictPanel({ verdicts, title = "What the numbers say", empty }: { verdicts: Verdict[]; title?: string; empty?: string }) {
  const t = useT();
  const tv = (v?: Record<string, string | number>) => (v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? t(x) : x])) : undefined);
  const groups = ORDER.map((k) => ({ k, items: verdicts.filter((v) => v.kind === k) })).filter((g) => g.items.length);
  return (
    <Panel>
      <PanelTitle>{t(title)}</PanelTitle>
      {groups.length === 0 ? <p className="text-sm text-text-2">{t(empty ?? "Not enough data yet to draw conclusions. Keep logging.")}</p> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {groups.map((g) => (
            <section key={g.k} aria-label={t(TITLE[g.k])}>
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-text-2"><span className={cn("size-2.5 rounded-full", DOT[g.k])} />{t(TITLE[g.k])}</h3>
              <ul className="flex flex-col gap-2.5">
                {g.items.map((v, i) => (
                  <li key={i} className="text-sm leading-snug">
                    <p className="font-medium">{t(v.key, tv(v.vars))}</p>
                    {v.action ? <p className="mt-0.5 text-text-2">→ {t(v.action.key, tv(v.action.vars))}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
