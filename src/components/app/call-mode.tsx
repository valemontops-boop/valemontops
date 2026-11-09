"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { type CallStats } from "@/domain/calls";
import { ActiveSession, FollowUpComposer, type ObjectionReport, type Playbook } from "./call-live";
import { OBJECTION_GUIDE, guideOf, replySteps } from "@/domain/objections";
import { Modal } from "@/components/ui/overlay";
import { useDateTag, useLocale, useT } from "@/i18n/react";
import { EMAIL_TEMPLATE_LABELS, fill, findItem, type TemplateKey } from "@/domain/playbook";
import { Mail, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { OBJECTION_LABELS } from "@/domain/constants";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Bars, Funnel } from "./charts";

type ListRow = { list: { id: string; name: string; niche: string; market: string | null }; total: number; called: number; reached: number; positive: number; meetings: number; remaining: number };
type Summary = { session: { id: string; started_at: string; ended_at: string | null; list_id: string }; stats: CallStats; messages: number; previous: { sessions: number; pickupRate: number | null; positiveRate: number | null; dials: number | null } };
const SESSION_KEY = "vos-call-session";
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export function CallMode() {
  const [session, setSession] = React.useState<{ id: string; listId: string } | null>(() => {
    try { const v = typeof window !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null; return v ? JSON.parse(v) : null; } catch { return null; }
  });
  const [ended, setEnded] = React.useState<string | null>(null);
  const keep = (s: { id: string; listId: string } | null) => {
    setSession(s);
    try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* convenience only */ }
  };
  if (ended) return <SessionSummary id={ended} onNew={() => setEnded(null)} />;
  if (session) return <ActiveSession id={session.id} listId={session.listId} onEnd={() => { setEnded(session.id); keep(null); }} />;
  return <StartScreen onStart={(s) => keep(s)} />;
}

function StartScreen({ onStart }: { onStart: (s: { id: string; listId: string }) => void }) {
  const t = useT();
  const dt = useDateTag();
  const [tab, setTab] = React.useState<"call" | "messages" | "objections">("call");
  const queueCount = useQuery({ queryKey: ["email-queue"], queryFn: () => api<{ items: unknown[] }>("/api/email/queue") }).data?.items.length ?? 0;
  const lists = useQuery({ queryKey: ["call-lists"], queryFn: () => api<ListRow[]>("/api/call-lists") });
  const sessions = useQuery({ queryKey: ["call-sessions"], queryFn: () => api<{ session: { id: string; started_at: string }; stats: CallStats }[]>("/api/calls/sessions") });
  const start = useMutation({
    mutationFn: (listId: string) => { const id = crypto.randomUUID(); return api("/api/calls/sessions", { body: { id, list_id: listId } }).then(() => ({ id, listId })); },
    onSuccess: onStart,
  });
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Call mode")}</h1>
        <SegmentedSwitch label={t("Section")} value={tab} onChange={setTab} options={[{ value: "call", label: t("Call") }, { value: "messages", label: queueCount ? `${t("Messages")} · ${queueCount}` : t("Messages") }, { value: "objections", label: t("Objections") }]} />
      </div>
      {tab === "messages" ? <MessageQueue /> : tab === "objections" ? <><ObjectionsPanel /><ObjectionDrill /></> : <>
      <Panel>
        <PanelTitle>{t("Call from a list")}</PanelTitle>
        {lists.isPending ? <Skeleton className="h-24" /> : lists.isError ? <ErrorState error={lists.error} onRetry={() => lists.refetch()} /> : lists.data.length === 0 ? (
          <EmptyState title={t("No call list yet")} action={<Button asChild size="sm" variant="outline"><Link href="/crm/import">{t("Import a list")}</Link></Button>}>{t("Import a CSV of businesses; it becomes a list you call through.")}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.data.map((l) => (
              <li key={l.list.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.list.name}</p>
                  <div className="mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <div className="bg-win" style={{ width: `${l.total ? (l.positive / l.total) * 100 : 0}%` }} />
                    <div className="bg-ink/70" style={{ width: `${l.total ? ((l.called - l.positive) / l.total) * 100 : 0}%` }} />
                  </div>
                  <p className="num mt-1 text-[12px] text-text-2">{t("{called}/{total} called · {reached} reached · {yes} yes · {meetings} meetings · {left} left", { called: l.called, total: l.total, reached: l.reached, yes: l.positive, meetings: l.meetings, left: l.remaining })}</p>
                </div>
                <Button variant="primary" disabled={start.isPending || l.remaining === 0} onClick={() => start.mutate(l.list.id)}>{t("Start calling")}</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">{t("Free dialling")}</p><p className="text-sm text-text-2">{t("Your own numbers. Type the number if you want, or just tap outcomes.")}</p></div>
        <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate("")}><Phone /> {t("Start free session")}</Button>
      </Panel>
      {start.isError ? <ErrorState error={start.error} onRetry={() => start.reset()} /> : null}
      {sessions.data?.length ? (
        <Panel>
          <PanelTitle>{t("Recent sessions")}</PanelTitle>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Started")}</th><th className="text-right font-medium">{t("Dials")}</th><th className="text-right font-medium">{t("Picked up")}</th><th className="text-right font-medium">{t("Yes")}</th><th className="text-right font-medium">{t("Meetings")}</th></tr></thead>
            <tbody>{sessions.data.slice(0, 5).map((s) => <tr key={s.session.id} className="border-t border-hairline"><td className="py-1.5">{new Date(s.session.started_at).toLocaleString(dt, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="num text-right">{s.stats.dials}</td><td className="num text-right">{pct(s.stats.pickupRate)}</td><td className="num text-right">{s.stats.interested + s.stats.callBacks}</td><td className="num text-right">{s.stats.meetings}</td></tr>)}</tbody>
          </table>
        </Panel>
      ) : null}
      </>}
    </div>
  );
}

function SessionSummary({ id, onNew }: { id: string; onNew: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { stats: s, previous: p } = q.data;
  const yes = s.interested + s.callBacks + s.meetings;
  const delta = (cur: number | null, prev: number | null) => (cur === null || prev === null ? null : Math.round((cur - prev) * 100));
  const d1 = delta(s.pickupRate, p.pickupRate);
  const d2 = delta(s.positiveRate, p.positiveRate);
  const vs = (d: number) => t("{d} pts vs your average", { d: `${d >= 0 ? "+" : ""}${d}` });
  const tiles: [string, string, string][] = [
    [t("Dials"), String(s.dials), s.minutes !== null ? `${s.minutes} min${s.dialsPerHour ? ` · ${s.dialsPerHour}/h` : ""}` : ""],
    [t("Pick-up rate"), pct(s.pickupRate), d1 === null ? t("{n} picked up", { n: s.pickedUp }) : vs(d1)],
    [t("Yes rate"), pct(s.positiveRate), d2 === null ? t("of people reached") : vs(d2)],
    [t("Meetings"), String(s.meetings), t("{n} yes in total", { n: yes })],
  ];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold tracking-tight">{t("Session summary")}</h1><Button variant="primary" onClick={onNew}>{t("New session")}</Button></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([l, v, n], i) => (
          <div key={l} className={cn("rounded-[20px] p-4", i === 3 ? "bg-ink text-panel" : "bg-panel")}><p className={cn("text-[13px]", i === 3 ? "text-panel/80" : "text-text-2")}>{l}</p><p className="num text-[36px] font-semibold leading-tight">{v}</p><p className={cn("text-[12px]", i === 3 ? "text-panel/75" : "text-text-3")}>{n}</p></div>
        ))}
      </div>
      <Panel>
        <PanelTitle>{t("Funnel")}</PanelTitle>
        <Funnel steps={[{ label: t("Dials"), value: s.dials, tone: "sales" }, { label: t("Picked up"), value: s.pickedUp, tone: "sales" }, { label: t("Decision-maker"), value: s.decisionMakerReached, tone: "sales" }, { label: t("Yes"), value: yes, tone: "win" }, { label: t("Meetings"), value: s.meetings, tone: "win" }]} />
        {q.data.messages ? <p className="mt-3 text-[13px] text-text-2">{t("{n} messages sent during this session.", { n: q.data.messages })}</p> : null}
      </Panel>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Panel><PanelTitle>{t("Objections")}</PanelTitle>{s.objections.length ? <ObjectionRows rows={s.objections} /> : <p className="text-sm text-text-2">{t("No objection recorded.")}</p>}</Panel>
        <Panel><PanelTitle>{t("By hour")}</PanelTitle>{s.byHour.length ? <Bars tone="sales" data={s.byHour.map((h) => ({ label: `${h.hour}:00`, value: h.dials, sub: t("{n} picked up", { n: h.pickedUp }) }))} /> : <p className="text-sm text-text-2">{t("No call.")}</p>}</Panel>
      </div>
    </div>
  );
}

type ObjRow = { key: string; count: number; won: number; wonRate: number | null };
/** Each objection: how often it came up (bar) and how often the call still ended in a yes (green part). */
export function ObjectionRows({ rows }: { rows: ObjRow[] }) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const g = guideOf(r.key);
        return (
          <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-sm">{t(OBJECTION_LABELS[r.key as keyof typeof OBJECTION_LABELS] ?? r.key)}{g?.type === "brush_off" ? <span className="text-[11px] text-text-3">{t("brush-off")}</span> : null}</span>
            <span className="num text-right text-[12px] text-text-2">{t("{n} heard · {won} won over", { n: r.count, won: r.won })}{r.wonRate !== null ? ` (${Math.round(r.wonRate * 100)}%)` : ""}</span>
            <div className="col-span-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <div className="rounded-full bg-win" style={{ width: `${(r.won / max) * 100}%` }} />
              <div className="rounded-full bg-control/60" style={{ width: `${((r.count - r.won) / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ObjectionsPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ["call-objections"], queryFn: () => api<ObjectionReport>("/api/calls/objections") });
  if (!q.data?.team.length) return <Panel><PanelTitle>{t("Objections")}</PanelTitle><p className="text-sm text-text-2">{t("Tick objections during calls: this page shows which ones you hear most and which replies turn them into a yes.")}</p></Panel>;
  const d = q.data;
  const worst = d.team.filter((o) => o.count >= 3).sort((a, b) => (a.wonRate ?? 0) - (b.wonRate ?? 0))[0];
  return (
    <Panel>
      <PanelTitle action={<span className="num text-[13px] text-text-2">{t("{n} heard · {p} brush-offs", { n: d.heard, p: d.brushOffShare === null ? "—" : `${Math.round(d.brushOffShare * 100)}%` })}</span>}>{t("Objections, last {n} days", { n: d.days })}</PanelTitle>
      <ObjectionRows rows={d.team.slice(0, 8)} />
      {worst ? <p className="mt-4 text-[13px] text-text-2">{t("To work on: {name}. Practise it below and try the other reply during calls (← →).", { name: t(OBJECTION_LABELS[worst.key as keyof typeof OBJECTION_LABELS]) })}</p> : null}
    </Panel>
  );
}

/** Two-minute practice: the prospect's line, you answer out loud, then reveal the best reply. */
function ObjectionDrill() {
  const t = useT();
  const loc = useLocale();
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const rep = useQuery({ queryKey: ["call-objections"], queryFn: () => api<ObjectionReport>("/api/calls/objections") });
  const [lang, setLang] = React.useState<"FR" | "ES">(loc === "es" ? "ES" : "FR");
  const [i, setI] = React.useState(0);
  const [shown, setShown] = React.useState(false);
  const [score, setScore] = React.useState({ good: 0, total: 0 });
  // Most frequent objections come up first, then the rest.
  const order = React.useMemo(() => {
    const count = (k: string) => rep.data?.team.find((x) => x.key === k)?.count ?? 0;
    return [...OBJECTION_GUIDE].sort((a, b) => count(b.key) - count(a.key));
  }, [rep.data]);
  const g = order[i % order.length];
  const v = rep.data?.picks[g.key] ?? 1;
  const item = pb.data ? findItem(pb.data.items, "objection", `${g.key}#${v}`, lang) : null;
  const vars = { founder: pb.data?.founderName, calendly: pb.data?.links.calendly, deck: lang === "ES" ? pb.data?.links.deckES : pb.data?.links.deckFR };
  const next = (good: boolean) => { setScore((s) => ({ good: s.good + (good ? 1 : 0), total: s.total + 1 })); setShown(false); setI((x) => x + 1); };
  return (
    <Panel className="flex flex-col gap-3">
      <PanelTitle action={<SegmentedSwitch size="sm" label={t("Language")} value={lang} onChange={setLang} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />}>{t("Practice")}</PanelTitle>
      <p className="text-xl font-semibold">« {g.say[lang]} »</p>
      {shown && item ? (
        <ol className="flex flex-col gap-1.5 text-[15px] leading-snug">{replySteps(fill(item.body, vars)).map((line, k) => <li key={k} className={cn(k === 2 && "font-medium")}>{line}</li>)}</ol>
      ) : <p className="text-[13px] text-text-3">{t("Answer out loud, then check the reply.")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!shown ? <Button variant="primary" onClick={() => setShown(true)}>{t("Show the reply")}</Button> : (
          <>
            <Button variant="primary" onClick={() => next(true)}>{t("I had it")}</Button>
            <Button variant="outline" onClick={() => next(false)}>{t("Not yet")}</Button>
          </>
        )}
        <span className="num ml-auto text-[12px] text-text-2">{score.total ? t("{good}/{total} right", score) : ""}</span>
      </div>
    </Panel>
  );
}

type QItem = { key: string; accountId: string; name: string; contact: string; email: string; phone: string; market: "FR" | "ES"; template: TemplateKey; reason: "talked" | "no_answer" | "no_reply"; outcome: string; at: string; context: "after_call" | "cold" };
const REASON: Record<QItem["reason"], string> = { talked: "Talked on the phone", no_answer: "Did not pick up today", no_reply: "No reply after 3 days" };

/**
 * Everyone who should get a message and has not: one click each, or send every email at once by Gmail.
 * The founder reviews the list first; WhatsApp still opens one by one and counts after "Yes, sent".
 */
function MessageQueue() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["email-queue"], queryFn: () => api<{ items: QItem[]; sentToday: number }>("/api/email/queue") });
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean }>("/api/email/status") });
  const [keys] = React.useState(() => new Map<string, string>());
  const [open, setOpen] = React.useState<{ item: QItem; channel: "email" | "whatsapp" } | null>(null);
  const idemFor = (k: string) => { if (!keys.has(k)) keys.set(k, crypto.randomUUID()); return keys.get(k)!; };
  const textFor = (it: QItem) => {
    const tp = pb.data ? findItem(pb.data.items, "email", it.template, it.market) : null;
    const v = { business: it.name, contact: it.contact, founder: pb.data?.founderName, calendly: pb.data?.links.calendly, deck: it.market === "ES" ? pb.data?.links.deckES : pb.data?.links.deckFR };
    return { subject: fill(tp?.subject ?? "", v), body: fill(tp?.body ?? "", v) };
  };
  const emailable = (q.data?.items ?? []).filter((it) => it.email);
  const batch = useMutation({
    mutationFn: () => api<{ sent: number; failed: number; results: { idempotency_key: string; ok: boolean; message?: string }[] }>("/api/email/batch", {
      body: { items: emailable.map((it) => ({ idempotency_key: idemFor(it.key), channel: "email", via: "gmail", context: it.context, account_id: it.accountId, to: it.email, ...textFor(it), template_key: it.template, language: it.market, market: it.market })) },
    }),
    onSuccess: (r) => { toast(r.failed ? t("{sent} emails sent, {failed} skipped (see why on each line)", { sent: r.sent, failed: r.failed }) : t("{sent} emails sent", { sent: r.sent })); qc.invalidateQueries({ queryKey: ["email-queue"] }); qc.invalidateQueries({ queryKey: ["my-day"] }); qc.invalidateQueries({ queryKey: ["email-benchmarks"] }); },
    onError: (e) => toast(e instanceof ApiError && e.body.error === "consent_required" ? t("Connect Gmail first") : (e as Error).message),
  });
  if (!q.data) return null;
  const items = q.data.items;
  const failed = new Map((batch.data?.results ?? []).filter((r) => !r.ok).map((r) => [r.idempotency_key, r.message ?? ""]));
  return (
    <Panel>
      <PanelTitle action={<span className="num text-[13px] text-text-2">{t("{n} sent today", { n: q.data.sentToday })}</span>}>{t("Messages to send")} <span className="num text-text-3">{items.length}</span></PanelTitle>
      {items.length === 0 ? <p className="text-sm text-text-2">{t("Everyone you reached has had a message. Each call adds one here.")}</p> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {gmail.data?.connected ? (
              <Button variant="primary" disabled={batch.isPending || emailable.length === 0} onClick={() => batch.mutate()}><Send /> {batch.isPending ? t("Sending…") : t("Send {n} emails by Gmail", { n: emailable.length })}</Button>
            ) : <Button asChild variant="primary"><a href="/api/auth/google/gmail?back=/call">{t("Connect Gmail to send all at once")}</a></Button>}
          </div>
          <ul className="flex flex-col divide-y divide-hairline">
            {items.slice(0, 25).map((it) => (
              <li key={it.key} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.name} <span className="font-normal text-text-3">· {it.market}</span></p>
                  <p className="text-[12px] text-text-3">{t(REASON[it.reason])} · {t(EMAIL_TEMPLATE_LABELS[it.template])}{failed.has(keys.get(it.key) ?? "") ? <span className="text-bad"> · {failed.get(keys.get(it.key)!)}</span> : null}</p>
                </div>
                {it.email ? <Button size="sm" variant="outline" onClick={() => setOpen({ item: it, channel: "email" })}><Mail /> {t("Email")}</Button> : null}
                {it.phone ? <Button size="sm" variant="outline" onClick={() => setOpen({ item: it, channel: "whatsapp" })}><MessageCircle /> WhatsApp</Button> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal open={Boolean(open && pb.data)} onOpenChange={(o) => { if (!o) setOpen(null); }} title={open?.item.name ?? ""}>
        {open && pb.data ? (
          <FollowUpComposer key={open.item.key + open.channel} channel={open.channel} template={open.item.template} sendKey={open.channel === "email" ? idemFor(open.item.key) : undefined} gmailConnected={Boolean(gmail.data?.connected)} playbook={pb.data}
            target={{ accountId: open.item.accountId, name: open.item.name, contact: open.item.contact, email: open.item.email, phone: open.item.phone, market: open.item.market }} onClose={() => setOpen(null)} />
        ) : null}
      </Modal>
    </Panel>
  );
}
