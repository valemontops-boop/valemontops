"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import { Bars, Columns } from "./charts";
import { InboxList } from "./inbox-panel";
import { StatStrip, StepFunnel, addCosts, pctOf, useCostStat, useFunnels, type GrowthFilter } from "./growth-common";
import type { EmailBenchmarks, Rate } from "@/domain/email";
import { EMAIL_TEMPLATE_LABELS } from "@/domain/playbook";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDateTag, useT } from "@/i18n/react";
import type { T } from "@/i18n";

type SendRow = { id: string; version: number; account_name: string; to_address: string; channel: "email" | "whatsapp"; template_key: string; language: string | null; sent_at: string | null; reply_kind: "positive" | "neutral" | "negative" | "bounce" | null; context: string };
const pct = (n: number | null, d = 1) => (n === null ? "—" : `${(n * 100).toFixed(d).replace(/\.0$/, "")}%`);
const REPLY_LABEL = { positive: "Interested", neutral: "Replied", negative: "Not interested", bounce: "Bounced" } as const;
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon" (server key) → the founder's short weekday name. 2023-01-01 was a Sunday. */
const weekdayName = (key: string, tag: string) => {
  const i = WEEKDAY_KEYS.indexOf(key);
  return i < 0 ? key : new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + i)));
};

/** Growth › Messages: email and WhatsApp numbers for the period → both funnels → what we still have to reply to → who still owes a reply → are our emails good. */
export function MessagesTab({ filter }: { filter: GrowthFilter }) {
  const t = useT();
  const tag = useDateTag();
  const f = useFunnels(filter);
  const status = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean; mode: string }>("/api/email/status") });
  const b = useQuery({ queryKey: ["email-benchmarks"], queryFn: () => api<EmailBenchmarks>("/api/email/benchmarks") });
  const qc = useQueryClient();
  const disconnect = useMutation({ mutationFn: () => api("/api/email/status", { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["gmail-status"] }) });
  const email = f.data?.all.find((c) => c.key === "email");
  const wa = f.data?.all.find((c) => c.key === "whatsapp");
  const v = (c: typeof email, i: number) => c?.steps[i]?.value ?? 0;
  const n = (x: number) => (f.data ? x.toLocaleString(tag) : "…");
  const costStat = useCostStat(); // round 9 (D072): CAC of email + WhatsApp
  return (
    <div className="flex flex-col gap-5">
      {f.isError ? <ErrorState error={f.error} onRetry={() => f.refetch()} /> : (
        <>
          <StatStrip stats={[
            { label: t("Emails sent"), value: n(v(email, 0)), note: t("{n} replies · {pct} reply rate", { n: v(email, 1), pct: pctOf(v(email, 1), v(email, 0)) }) },
            { label: t("WhatsApp sent"), value: n(v(wa, 0)), note: t("{n} replies · {pct} reply rate", { n: v(wa, 1), pct: pctOf(v(wa, 1), v(wa, 0)) }) },
            { label: t("Interested replies"), value: n(v(email, 2) + v(wa, 2)), note: t("marked “Interested” below") },
            { label: t("Meetings"), value: n((email?.meetings ?? 0) + (wa?.meetings ?? 0)), note: t("credited to email or WhatsApp (last touch)"), result: true },
            costStat(addCosts(f.data?.costs?.email, f.data?.costs?.whatsapp)),
          ]} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <StepFunnel title={t("Email")} steps={email?.steps ?? []} hours={email?.hours} empty={t("No email sent in this period. Send follow-ups from Call mode (key E or P).")} />
            <StepFunnel title="WhatsApp" steps={wa?.steps ?? []} hours={wa?.hours} empty={t("No WhatsApp message in this period. Send them from Call mode › Messages.")} />
          </div>
        </>
      )}
      <InboxList />
      <SendsList />
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <p className="font-medium">Gmail <span className={cn("ml-1 text-[13px] font-normal", status.data?.connected ? "text-good" : "text-text-3")}>{status.data?.connected ? t("connected") : t("not connected")}</span></p>
          <p className="text-[13px] text-text-2">{t("Send-only access")} (<code>gmail.send</code>): {t("Valemont OS sends the follow-ups you write from call mode and never reads your inbox. Mark replies here with one tap. The connection lasts about an hour; reconnect when asked.")}</p>
        </div>
        {status.data?.connected ? <Button variant="ghost" onClick={() => disconnect.mutate()}>{t("Disconnect")}</Button> : <Button asChild variant="outline"><a href="/api/auth/google/gmail?back=/marketing">{t("Connect Gmail")}</a></Button>}
      </Panel>
      {b.isPending ? <Skeleton className="h-64" /> : b.isError ? <ErrorState error={b.error} onRetry={() => b.refetch()} /> : b.data.overall.sent === 0 ? (
        <EmptyState title={t("No email sent yet")}>{t("Send a follow-up from call mode (key E or P). Benchmarks appear here as soon as emails go out.")}</EmptyState>
      ) : <Benchmarks d={b.data} />}
    </div>
  );
}

function Benchmarks({ d }: { d: EmailBenchmarks }) {
  const t = useT();
  const tag = useDateTag();
  const ext = d.external;
  return (
    <>
      <Panel>
        <PanelTitle action={<span className="num text-[12px] text-text-3">{t("all emails since the start · {n} sent", { n: d.overall.sent })}</span>}>{t("Are our emails good?")}</PanelTitle>
        <p className="mb-4 text-sm text-text-2">{t("Reply rate per segment against public cold-email ranges (replies ÷ emails sent). Emails sent after a call are warm: they should beat the cold ranges by far. Below {n} emails a segment is marked “not enough data”.", { n: d.minSample })}</p>
        <RangeChart rows={[
          { label: t("After a call (warm)"), r: d.afterCall },
          { label: t("Cold"), r: d.cold },
          ...d.byTemplate.map((x) => ({ label: EMAIL_TEMPLATE_LABELS[x.key as keyof typeof EMAIL_TEMPLATE_LABELS] ? t(EMAIL_TEMPLATE_LABELS[x.key as keyof typeof EMAIL_TEMPLATE_LABELS]) : x.key, r: x })),
          ...d.byLanguage.map((x) => ({ label: x.key === "FR" ? t("French") : x.key === "ES" ? t("Spanish") : x.key, r: x })),
        ]} typical={[ext.coldTypical.low, ext.coldTypical.high]} strong={[ext.coldStrong.low, ext.coldStrong.high]} />
        <Verdict d={d} />
        <p className="mt-4 text-[12px] text-text-3">
          {t("Bounce rate")}: <span className="num">{pct(d.bounceRate)}</span> ({t("keep under 2%")}) · {t("Sources for the ranges")}: {ext.sources.map((s, i) => <React.Fragment key={s.url}>{i ? ", " : ""}<a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a></React.Fragment>)}. {t("Public figures mix methods (some divide by delivered or opened emails). Use them as a range, and trust your own trend over time first.")}
        </p>
      </Panel>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel>
          <PanelTitle>{t("By weekday")}</PanelTitle>
          <Columns tone="sales" height={150} label={t("Reply rate by weekday")} data={d.byWeekday.map((w) => ({ key: w.key, label: weekdayName(w.key, tag), value: Math.round((w.rate ?? 0) * 100), display: `${Math.round((w.rate ?? 0) * 100)}%`, highlight: w.enough }))} />
          <p className="mt-2 text-[12px] text-text-3">{t("Reply rate per weekday · faded = fewer than {n} emails.", { n: d.minSample })}</p>
        </Panel>
        <Panel>
          <PanelTitle>{t("By niche")}</PanelTitle>
          <Bars tone="sales" max={100} data={d.byNiche.map((n) => ({ label: n.key, value: Math.round((n.rate ?? 0) * 100), sub: `${t("{replied}/{sent} replied", { replied: n.replied, sent: n.sent })}${n.enough ? "" : ` · ${t("not enough data")}`}` }))} />
          <p className="mt-2 text-[12px] text-text-3">{t("Reply rate in % per trade.")}</p>
        </Panel>
      </div>
    </>
  );
}

function Verdict({ d }: { d: EmailBenchmarks }) {
  const t: T = useT();
  const tag = useDateTag();
  const tips: string[] = [];
  const v = d.cold.verdict;
  if (d.cold.sent > 0) {
    if (v === "not_enough_data") tips.push(t("Cold emails: {n} sent, not enough to judge yet.", { n: d.cold.sent }));
    else if (v === "below") tips.push(t("Cold emails reply below 1%: shorten the email, name a concrete problem of the niche, and send to smaller, better-targeted lists."));
    else if (v === "typical") tips.push(t("Cold emails are in the typical 1–5% range. Test one change at a time (subject, first line, call to action)."));
    else tips.push(t("Cold emails beat 5%: keep the template and scale the list carefully."));
  }
  if (d.afterCall.enough && d.afterCall.rate !== null && d.afterCall.rate < 0.2) tips.push(t("Fewer than 1 in 5 people reply after a call: send the email during or right after the call, and say on the phone that it is coming."));
  const bestDay = [...d.byWeekday].filter((w) => w.enough).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  if (bestDay) tips.push(t("Best day so far: {day} ({pct} replies).", { day: weekdayName(bestDay.key, tag), pct: pct(bestDay.rate) }));
  if (d.bounceRate !== null && d.bounceRate > 0.02) tips.push(t("Bounces are above 2%: check addresses before sending, bounces hurt your Gmail reputation."));
  if (!tips.length) return null;
  return <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-sm">{tips.map((x) => <li key={x}>{x}</li>)}</ul>;
}

/** One question: where does each segment's reply rate sit against the public ranges? Bands are hatched, our rate is the ink marker. */
function RangeChart({ rows, typical, strong }: { rows: { label: string; r: Rate }[]; typical: [number, number]; strong: [number, number] }) {
  const t = useT();
  const shown = rows.filter((x) => x.r.sent > 0);
  const max = Math.max(0.12, ...shown.map((x) => x.r.rate ?? 0)) * 1.1;
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div role="img" aria-label={t("Reply rate by segment against public cold-email ranges")}>
      <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-text-2">
        <span><span className="hatch mr-1 inline-block h-2.5 w-4 rounded-sm align-middle" />{t("typical cold 1–5%")}</span>
        <span><span className="hatch-strong mr-1 inline-block h-2.5 w-4 rounded-sm align-middle" />{t("strong 5–10%")}</span>
        <span><span className="mr-1 inline-block h-2.5 w-1 rounded-sm bg-win align-middle" />{t("our reply rate")}</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {shown.map(({ label, r }) => (
          <li key={label} className="grid grid-cols-[minmax(110px,30%)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-text-2">{label}</span>
            <span className="relative h-6 rounded-[6px] bg-subtle/70">
              <span className="hatch absolute inset-y-0" style={{ left: pos(typical[0]), width: `calc(${pos(typical[1])} - ${pos(typical[0])})` }} />
              <span className="hatch-strong absolute inset-y-0" style={{ left: pos(strong[0]), width: `calc(${pos(strong[1])} - ${pos(strong[0])})` }} />
              {r.rate !== null ? <span className={cn("absolute inset-y-[-3px] w-1.5 -translate-x-1/2 rounded-full ring-2 ring-panel", r.enough ? "bg-win" : "bg-control")} style={{ left: pos(r.rate) }} /> : null}
            </span>
            <span className="num w-36 text-right font-medium">{pct(r.rate)}<span className="block text-[11px] font-normal text-text-3">{r.enough ? t("{n} sent", { n: r.sent }) : `${t("{n} sent", { n: r.sent })} · ${t("not enough data")}`}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Waiting for an answer: one tap records the reply (the app has no inbox access). */
function SendsList() {
  const t = useT();
  const tag = useDateTag();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["email-sends"], queryFn: () => api<SendRow[]>("/api/email/sends") });
  const mark = useMutation({
    mutationFn: (b: { id: string; expected_version: number; reply_kind: SendRow["reply_kind"] }) => api("/api/email/sends", { method: "PATCH", body: b }),
    onSuccess: () => { for (const k of ["email-sends", "email-benchmarks", "funnels"]) qc.invalidateQueries({ queryKey: [k] }); toast(t("Saved")); },
    onError: (e) => toast((e as Error).message),
  });
  const [all, setAll] = React.useState(false);
  if (!q.data?.length) return null;
  const rows = all ? q.data : q.data.filter((r) => !r.reply_kind);
  return (
    <Panel>
      <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)}>{all ? t("Waiting only") : t("Show all")}</Button>}>{all ? t("All follow-ups") : t("Waiting for a reply")} <span className="num ml-1 font-normal text-text-3">{rows.length}</span></PanelTitle>
      {rows.length === 0 ? <p className="text-sm text-text-2">{t("Nothing waiting.")}</p> : (
        <ul className="flex flex-col divide-y divide-hairline">
          {rows.slice(0, all ? 50 : 5).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.account_name || r.to_address}</p>
                <p className="text-[12px] text-text-3">{r.channel === "email" ? t("Email") : "WhatsApp"} · {EMAIL_TEMPLATE_LABELS[r.template_key as keyof typeof EMAIL_TEMPLATE_LABELS] ? t(EMAIL_TEMPLATE_LABELS[r.template_key as keyof typeof EMAIL_TEMPLATE_LABELS]) : r.template_key} · {r.language ?? ""} · {r.sent_at ? new Date(r.sent_at).toLocaleDateString(tag, { day: "2-digit", month: "short" }) : ""}</p>
              </div>
              {(["positive", "neutral", "negative", "bounce"] as const).filter((k) => r.channel === "email" || k !== "bounce").map((k) => (
                <button key={k} type="button" aria-pressed={r.reply_kind === k} disabled={mark.isPending} onClick={() => mark.mutate({ id: r.id, expected_version: r.version, reply_kind: r.reply_kind === k ? null : k })}
                  className={cn("min-h-9 rounded-full border px-3 text-[13px]", r.reply_kind === k ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle")}>{t(REPLY_LABEL[k])}</button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
