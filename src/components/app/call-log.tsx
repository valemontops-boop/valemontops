"use client";
import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { EmptyState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import { CALL_OUTCOME_LABELS, type CallOutcome } from "@/domain/calls";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { EMAIL_TEMPLATE_LABELS, type TemplateKey } from "@/domain/playbook";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CsvExportButton } from "./csv-tools";

type Row = { id: string; at: string; date: string; outcome: CallOutcome; objections: Objection[]; duration_sec: number | null; name: string; niche: string; phone: string; accountId: string; contact: string; message: { channel: "email" | "whatsapp"; template: string; at: string | null } | null; next_action: string; next_action_due: string | null; offer?: "local" | "thirty" | null; offered?: string[] };
const YES: CallOutcome[] = ["meeting", "interested", "call_back"];
const dur = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

/** Every call, one line: when, who, outcome, objections, length, message sent after, next step. */
export function CallLog({ sessionId, days = 14, title }: { sessionId?: string; days?: number; title?: string }) {
  const t = useT();
  const tag = useDateTag();
  const q = useQuery({ queryKey: ["call-log", sessionId ?? "", days], queryFn: () => api<Row[]>(`/api/calls/log?session_id=${sessionId ?? ""}&days=${days}`) });
  const time = (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long" });
  const rows = q.data ?? [];
  const groups = sessionId ? [{ d: "", rows }] : [...new Set(rows.map((r) => r.date))].map((d) => ({ d, rows: rows.filter((r) => r.date === d) }));
  return (
    <Panel>
      <PanelTitle action={rows.length ? <span className="flex items-center gap-2"><span className="num text-[13px] text-text-2">{rows.length === 1 ? t("1 call") : t("{n} calls", { n: rows.length })}</span>{sessionId ? null : <CsvExportButton list="calls" />}</span> : null}>{t(title ?? "Call log")}</PanelTitle>
      {q.isPending ? <Skeleton className="h-24" /> : rows.length === 0 ? <EmptyState title={t("No call yet")}>{t("Each call you log appears here with its outcome, objections and the message sent after.")}</EmptyState> : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.d || "s"}>
              {g.d ? <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-text-3 first-letter:uppercase">{day(g.d)}</h3> : null}
              <ul className="flex flex-col divide-y divide-hairline">
                {g.rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[3.2rem_1fr_auto] items-start gap-x-3 py-2 text-sm">
                    <span className="num pt-0.5 text-[12px] text-text-3">{time(r.at)}</span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        {r.accountId ? <Link href="/crm" className="truncate font-medium hover:underline">{r.name}</Link> : <span className="font-medium text-text-2">{t("Free number")}</span>}
                        {r.contact ? <span className="text-[12px] text-text-3">{r.contact}</span> : null}
                      </span>
                      {r.objections.length ? <span className="block text-[12px] text-text-2">{r.objections.map((o) => t(OBJECTION_LABELS[o] ?? o)).join(" · ")}</span> : null}
                      {r.next_action ? <span className="block text-[12px] text-text-3">→ {t(r.next_action)}{r.next_action_due ? ` · ${new Date(`${r.next_action_due}T12:00:00Z`).toLocaleDateString(tag, { day: "2-digit", month: "short" })}` : ""}</span> : null}
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", r.outcome === "meeting" ? "bg-win text-panel" : YES.includes(r.outcome) ? "border border-win text-win" : "bg-subtle text-text-2")}>{r.offer ? t(r.offer === "local" ? "Yes Local" : "Yes 30/30") : t(CALL_OUTCOME_LABELS[r.outcome])}</span>
                      {!r.offer && r.offered?.length ? <span className="text-[11px] text-text-3">{t("Offered:")} {r.offered.map((o) => (o === "local" ? "Local" : "30/30")).join(", ")}</span> : null}
                      <span className="flex items-center gap-1.5 text-[11px] text-text-3">
                        {dur(r.duration_sec)}
                        {r.message ? <span className="flex items-center gap-0.5" title={t(EMAIL_TEMPLATE_LABELS[r.message.template as TemplateKey] ?? r.message.template)}>{r.message.channel === "email" ? <Mail className="size-3" /> : <MessageCircle className="size-3" />}{t("sent")}</span> : null}
                      </span>
                    </span>
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
