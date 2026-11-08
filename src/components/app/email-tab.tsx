"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import type { EmailBenchmarks, Rate } from "@/domain/email";
import { EMAIL_TEMPLATE_LABELS } from "@/domain/playbook";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type SendRow = { id: string; version: number; account_name: string; to_address: string; channel: "email" | "whatsapp"; template_key: string; language: string | null; sent_at: string | null; reply_kind: "positive" | "neutral" | "negative" | "bounce" | null; context: string };
const pct = (n: number | null, d = 1) => (n === null ? "—" : `${(n * 100).toFixed(d).replace(/\.0$/, "")}%`);
const REPLY_LABEL = { positive: "Interested", neutral: "Replied", negative: "Not interested", bounce: "Bounced" } as const;

export function EmailTab() {
  const status = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean; mode: string }>("/api/email/status") });
  const b = useQuery({ queryKey: ["email-benchmarks"], queryFn: () => api<EmailBenchmarks>("/api/email/benchmarks") });
  const qc = useQueryClient();
  const disconnect = useMutation({ mutationFn: () => api("/api/email/status", { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["gmail-status"] }) });
  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xl">
          <p className="font-medium">Gmail {status.data?.connected ? <span className="ml-1 rounded-full bg-subtle px-2 py-0.5 text-[12px] font-medium text-good">connected</span> : null}</p>
          <p className="text-sm text-text-2">Send-only access (<code>gmail.send</code>): Valemont OS sends the follow-ups you write from call mode and never reads your inbox. Mark replies here with one tap. The connection lasts about an hour; reconnect when asked.</p>
        </div>
        {status.data?.connected ? <Button variant="ghost" onClick={() => disconnect.mutate()}>Disconnect</Button> : <Button asChild variant="primary"><a href="/api/auth/google/gmail?back=/marketing">Connect Gmail</a></Button>}
      </Panel>
      {b.isPending ? <Skeleton className="h-64" /> : b.isError ? <ErrorState error={b.error} onRetry={() => b.refetch()} /> : b.data.overall.sent === 0 ? (
        <EmptyState title="No email sent yet">Send a follow-up from call mode (key E or P). Benchmarks appear here as soon as emails go out.</EmptyState>
      ) : <Benchmarks d={b.data} />}
      <SendsList />
    </div>
  );
}

function Benchmarks({ d }: { d: EmailBenchmarks }) {
  const ext = d.external;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Emails sent" value={String(d.overall.sent)} note={`${d.whatsapp.sent} WhatsApp too`} />
        <Kpi label="Reply rate" value={pct(d.overall.rate)} note={`${d.overall.replied} replies ÷ sent`} ink />
        <Kpi label="Interested replies" value={pct(d.overall.positiveRate)} note={`${d.overall.positive} prospects`} />
        <Kpi label="Bounce rate" value={pct(d.bounceRate)} note="keep under 2%" />
      </div>
      <Panel>
        <PanelTitle>Are our emails good?</PanelTitle>
        <p className="mb-4 text-sm text-text-2">Reply rate per segment against public cold-email ranges (replies ÷ emails sent). Emails sent after a call are warm: they should beat the cold ranges by far. Below {d.minSample} emails a segment is marked “not enough data”.</p>
        <RangeChart rows={[
          { label: "After a call (warm)", r: d.afterCall },
          { label: "Cold", r: d.cold },
          ...d.byTemplate.map((t) => ({ label: EMAIL_TEMPLATE_LABELS[t.key as keyof typeof EMAIL_TEMPLATE_LABELS] ?? t.key, r: t })),
          ...d.byLanguage.map((t) => ({ label: t.key === "FR" ? "French" : t.key === "ES" ? "Spanish" : t.key, r: t })),
        ]} typical={[ext.coldTypical.low, ext.coldTypical.high]} strong={[ext.coldStrong.low, ext.coldStrong.high]} />
        <Verdict d={d} />
      </Panel>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel>
          <PanelTitle>By weekday</PanelTitle>
          <SegTable rows={d.byWeekday} />
        </Panel>
        <Panel>
          <PanelTitle>By niche</PanelTitle>
          <SegTable rows={d.byNiche} />
        </Panel>
      </div>
      <Panel>
        <PanelTitle>Sources for the ranges</PanelTitle>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-2">{ext.sources.map((s) => <li key={s.url}><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a></li>)}</ul>
        <p className="mt-2 text-[12px] text-text-3">Public figures mix methods (some divide by delivered or opened emails). Use them as a range, and trust your own trend over time first.</p>
      </Panel>
    </>
  );
}

function Verdict({ d }: { d: EmailBenchmarks }) {
  const tips: string[] = [];
  const v = d.cold.verdict;
  if (d.cold.sent > 0) {
    if (v === "not_enough_data") tips.push(`Cold emails: ${d.cold.sent} sent, not enough to judge yet.`);
    else if (v === "below") tips.push("Cold emails reply below 1%: shorten the email, name a concrete problem of the niche, and send to smaller, better-targeted lists.");
    else if (v === "typical") tips.push("Cold emails are in the typical 1–5% range. Test one change at a time (subject, first line, call to action).");
    else tips.push("Cold emails beat 5%: keep the template and scale the list carefully.");
  }
  if (d.afterCall.enough && d.afterCall.rate !== null && d.afterCall.rate < 0.2) tips.push("Fewer than 1 in 5 people reply after a call: send the email during or right after the call, and say on the phone that it is coming.");
  const bestDay = [...d.byWeekday].filter((w) => w.enough).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  if (bestDay) tips.push(`Best day so far: ${bestDay.key} (${pct(bestDay.rate)} replies).`);
  if (d.bounceRate !== null && d.bounceRate > 0.02) tips.push("Bounces are above 2%: check addresses before sending, bounces hurt your Gmail reputation.");
  if (!tips.length) return null;
  return <ul className="mt-4 flex flex-col gap-1.5 text-sm">{tips.map((t) => <li key={t} className="rounded-[10px] bg-subtle px-3 py-2">{t}</li>)}</ul>;
}

/** One question: where does each segment's reply rate sit against the public ranges? Bands are hatched, our rate is the ink marker. */
function RangeChart({ rows, typical, strong }: { rows: { label: string; r: Rate }[]; typical: [number, number]; strong: [number, number] }) {
  const shown = rows.filter((x) => x.r.sent > 0);
  const max = Math.max(0.12, ...shown.map((x) => x.r.rate ?? 0)) * 1.1;
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div role="img" aria-label="Reply rate by segment against public cold-email ranges">
      <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-text-2">
        <span><span className="hatch mr-1 inline-block h-2.5 w-4 rounded-sm align-middle" />typical cold 1–5%</span>
        <span><span className="hatch-strong mr-1 inline-block h-2.5 w-4 rounded-sm align-middle" />strong 5–10%</span>
        <span><span className="mr-1 inline-block h-2.5 w-1 rounded-sm bg-ink align-middle" />our reply rate</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {shown.map(({ label, r }) => (
          <li key={label} className="grid grid-cols-[minmax(110px,30%)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-text-2">{label}</span>
            <span className="relative h-6 rounded-[6px] bg-subtle/70">
              <span className="hatch absolute inset-y-0" style={{ left: pos(typical[0]), width: `calc(${pos(typical[1])} - ${pos(typical[0])})` }} />
              <span className="hatch-strong absolute inset-y-0" style={{ left: pos(strong[0]), width: `calc(${pos(strong[1])} - ${pos(strong[0])})` }} />
              {r.rate !== null ? <span className={cn("absolute inset-y-[-3px] w-1.5 -translate-x-1/2 rounded-full ring-2 ring-panel", r.enough ? "bg-ink" : "bg-control")} style={{ left: pos(r.rate) }} /> : null}
            </span>
            <span className="num w-36 text-right font-medium">{pct(r.rate)}<span className="block text-[11px] font-normal text-text-3">{r.enough ? `${r.sent} sent` : `${r.sent} sent · not enough data`}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SegTable({ rows }: { rows: ({ key: string } & Rate)[] }) {
  if (!rows.length) return <p className="text-sm text-text-2">No data yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium" /><th className="text-right font-medium">Sent</th><th className="text-right font-medium">Replies</th><th className="text-right font-medium">Rate</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-hairline"><td className="py-1.5">{r.key}</td><td className="num text-right">{r.sent}</td><td className="num text-right">{r.replied}</td><td className={cn("num text-right", !r.enough && "text-text-3")}>{pct(r.rate)}</td></tr>)}</tbody>
    </table>
  );
}

function Kpi({ label, value, note, ink }: { label: string; value: string; note: string; ink?: boolean }) {
  return (
    <div className={cn("rounded-[20px] p-4", ink ? "bg-ink text-panel" : "bg-panel")}>
      <p className={cn("text-[13px]", ink ? "text-panel/80" : "text-text-2")}>{label}</p>
      <p className="num text-[32px] font-semibold leading-tight">{value}</p>
      <p className={cn("text-[12px]", ink ? "text-panel/75" : "text-text-3")}>{note}</p>
    </div>
  );
}

/** Waiting for an answer: one tap records the reply (the app has no inbox access). */
function SendsList() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["email-sends"], queryFn: () => api<SendRow[]>("/api/email/sends") });
  const mark = useMutation({
    mutationFn: (b: { id: string; expected_version: number; reply_kind: SendRow["reply_kind"] }) => api("/api/email/sends", { method: "PATCH", body: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["email-sends"] }); qc.invalidateQueries({ queryKey: ["email-benchmarks"] }); toast("Saved"); },
    onError: (e) => toast((e as Error).message),
  });
  const [all, setAll] = React.useState(false);
  if (!q.data?.length) return null;
  const rows = all ? q.data : q.data.filter((r) => !r.reply_kind);
  return (
    <Panel>
      <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)}>{all ? "Waiting only" : "Show all"}</Button>}>{all ? "All follow-ups" : "Waiting for a reply"}</PanelTitle>
      {rows.length === 0 ? <p className="text-sm text-text-2">Nothing waiting.</p> : (
        <ul className="flex flex-col divide-y divide-hairline">
          {rows.slice(0, all ? 50 : 10).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.account_name || r.to_address}</p>
                <p className="text-[12px] text-text-3">{r.channel === "email" ? "Email" : "WhatsApp"} · {EMAIL_TEMPLATE_LABELS[r.template_key as keyof typeof EMAIL_TEMPLATE_LABELS] ?? r.template_key} · {r.language ?? ""} · {r.sent_at ? new Date(r.sent_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : ""}</p>
              </div>
              {(["positive", "neutral", "negative", "bounce"] as const).filter((k) => r.channel === "email" || k !== "bounce").map((k) => (
                <button key={k} type="button" aria-pressed={r.reply_kind === k} disabled={mark.isPending} onClick={() => mark.mutate({ id: r.id, expected_version: r.version, reply_kind: r.reply_kind === k ? null : k })}
                  className={cn("min-h-9 rounded-full border px-3 text-[13px]", r.reply_kind === k ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle")}>{REPLY_LABEL[k]}</button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
