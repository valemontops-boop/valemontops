"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { type CallStats } from "@/domain/calls";
import { ActiveSession, FollowUpComposer, type ObjectionReport, type Playbook } from "./call-live";
import { OBJECTION_GUIDE, REPLY_STEPS, guideOf, replySteps } from "@/domain/objections";
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
  const lists = useQuery({ queryKey: ["call-lists"], queryFn: () => api<ListRow[]>("/api/call-lists") });
  const sessions = useQuery({ queryKey: ["call-sessions"], queryFn: () => api<{ session: { id: string; started_at: string }; stats: CallStats }[]>("/api/calls/sessions") });
  const start = useMutation({
    mutationFn: (listId: string) => { const id = crypto.randomUUID(); return api("/api/calls/sessions", { body: { id, list_id: listId } }).then(() => ({ id, listId })); },
    onSuccess: onStart,
  });
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Call mode</h1>
        <p className="text-sm text-text-2">Tap one box per call. Refusals are only counted; people who say yes go straight into your pipeline.</p>
      </div>
      <Panel>
        <PanelTitle>Call from a list</PanelTitle>
        {lists.isPending ? <Skeleton className="h-24" /> : lists.isError ? <ErrorState error={lists.error} onRetry={() => lists.refetch()} /> : lists.data.length === 0 ? (
          <EmptyState title="No call list yet" action={<Button asChild size="sm" variant="outline"><Link href="/crm/import">Import a list</Link></Button>}>Import a CSV of businesses; it becomes a list you call through.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.data.map((l) => (
              <li key={l.list.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.list.name}</p>
                  <div className="mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <div className="bg-win" style={{ width: `${l.total ? (l.positive / l.total) * 100 : 0}%` }} />
                    <div className="bg-sales" style={{ width: `${l.total ? ((l.called - l.positive) / l.total) * 100 : 0}%` }} />
                  </div>
                  <p className="num mt-1 text-[12px] text-text-2">{l.called}/{l.total} called · {l.reached} reached · {l.positive} yes · {l.meetings} meetings · {l.remaining} left</p>
                </div>
                <Button variant="primary" disabled={start.isPending || l.remaining === 0} onClick={() => start.mutate(l.list.id)}>Start calling</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">Free dialling</p><p className="text-sm text-text-2">Your own numbers. Type the number if you want, or just tap outcomes.</p></div>
        <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate("")}><Phone /> Start free session</Button>
      </Panel>
      {start.isError ? <ErrorState error={start.error} onRetry={() => start.reset()} /> : null}
      <MessageQueue />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ObjectionsPanel />
        <ObjectionDrill />
      </div>
      {sessions.data?.length ? (
        <Panel>
          <PanelTitle>Recent sessions</PanelTitle>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">Started</th><th className="text-right font-medium">Dials</th><th className="text-right font-medium">Picked up</th><th className="text-right font-medium">Yes</th><th className="text-right font-medium">Meetings</th></tr></thead>
            <tbody>{sessions.data.slice(0, 5).map((s) => <tr key={s.session.id} className="border-t border-hairline"><td className="py-1.5">{new Date(s.session.started_at).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="num text-right">{s.stats.dials}</td><td className="num text-right">{pct(s.stats.pickupRate)}</td><td className="num text-right">{s.stats.interested + s.stats.callBacks}</td><td className="num text-right">{s.stats.meetings}</td></tr>)}</tbody>
          </table>
        </Panel>
      ) : null}
    </div>
  );
}

function SessionSummary({ id, onNew }: { id: string; onNew: () => void }) {
  const q = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { stats: s, previous: p } = q.data;
  const yes = s.interested + s.callBacks + s.meetings;
  const delta = (cur: number | null, prev: number | null) => (cur === null || prev === null ? null : Math.round((cur - prev) * 100));
  const d1 = delta(s.pickupRate, p.pickupRate);
  const d2 = delta(s.positiveRate, p.positiveRate);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold tracking-tight">Session summary</h1><Button variant="primary" onClick={onNew}>New session</Button></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Dials", String(s.dials), s.minutes !== null ? `${s.minutes} min${s.dialsPerHour ? ` · ${s.dialsPerHour}/h` : ""}` : ""], ["Pick-up rate", pct(s.pickupRate), d1 === null ? `${s.pickedUp} picked up` : `${d1 >= 0 ? "+" : ""}${d1} pts vs your average`], ["Yes rate", pct(s.positiveRate), d2 === null ? "of people reached" : `${d2 >= 0 ? "+" : ""}${d2} pts vs your average`], ["Meetings", String(s.meetings), `${yes} yes in total`]].map(([l, v, n], i) => (
          <div key={l} className={cn("rounded-[20px] p-4", i === 3 ? "bg-ink text-panel" : i === 2 ? "bg-win-soft" : "bg-sales-soft")}><p className={cn("text-[13px]", i === 3 ? "text-panel/80" : "text-text-2")}>{l}</p><p className="num text-[36px] font-semibold leading-tight">{v}</p><p className={cn("text-[12px]", i === 3 ? "text-panel/75" : "text-text-3")}>{n}</p></div>
        ))}
      </div>
      <Panel>
        <PanelTitle>Funnel</PanelTitle>
        <Funnel steps={[{ label: "Dials", value: s.dials, tone: "sales" }, { label: "Picked up", value: s.pickedUp, tone: "sales" }, { label: "Decision-maker", value: s.decisionMakerReached, tone: "sales" }, { label: "Yes", value: yes, tone: "win" }, { label: "Meetings", value: s.meetings, tone: "win" }]} />
        {q.data.messages ? <p className="mt-3 text-[13px] text-text-2"><b className="num text-ink">{q.data.messages}</b> messages sent during this session.</p> : null}
      </Panel>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Panel><PanelTitle>Objections</PanelTitle>{s.objections.length ? <ObjectionRows rows={s.objections} /> : <p className="text-sm text-text-2">No objection recorded.</p>}</Panel>
        <Panel><PanelTitle>By hour</PanelTitle>{s.byHour.length ? <Bars tone="sales" data={s.byHour.map((h) => ({ label: `${h.hour}:00`, value: h.dials, sub: `${h.pickedUp} picked up` }))} /> : <p className="text-sm text-text-2">No call.</p>}</Panel>
      </div>
    </div>
  );
}

type ObjRow = { key: string; count: number; won: number; wonRate: number | null };
/** Each objection: how often it came up (bar) and how often the call still ended in a yes (green part). */
export function ObjectionRows({ rows }: { rows: ObjRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const g = guideOf(r.key);
        return (
          <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-sm">{OBJECTION_LABELS[r.key as keyof typeof OBJECTION_LABELS] ?? r.key}{g ? <span className={cn("rounded-full px-1.5 py-px text-[10px] font-medium", g.type === "brush_off" ? "bg-subtle text-text-2" : "bg-mkt-soft text-mkt")}>{g.type === "brush_off" ? "brush-off" : "real"}</span> : null}</span>
            <span className="num text-right text-[12px] text-text-2">{r.count} heard · <b className="font-medium text-win">{r.won} won over</b>{r.wonRate !== null ? ` (${Math.round(r.wonRate * 100)}%)` : ""}</span>
            <div className="col-span-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <div className="rounded-full bg-win" style={{ width: `${(r.won / max) * 100}%` }} />
              <div className="rounded-full bg-sales/35" style={{ width: `${((r.count - r.won) / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ObjectionsPanel() {
  const q = useQuery({ queryKey: ["call-objections"], queryFn: () => api<ObjectionReport>("/api/calls/objections") });
  if (!q.data?.team.length) return <Panel><PanelTitle>Objections</PanelTitle><p className="text-sm text-text-2">Tick objections during calls (keys A…T): this panel shows which ones you hear most and which replies turn them into a yes.</p></Panel>;
  const d = q.data;
  const best = d.team.filter((o) => o.count >= 3).sort((a, b) => (b.wonRate ?? 0) - (a.wonRate ?? 0))[0];
  const worst = d.team.filter((o) => o.count >= 3).sort((a, b) => (a.wonRate ?? 0) - (b.wonRate ?? 0))[0];
  return (
    <Panel>
      <PanelTitle>Objections, last {d.days} days</PanelTitle>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-[12px] bg-sales-soft p-3"><p className="num text-[24px] font-semibold leading-none">{d.heard}</p><p className="mt-1 text-[12px] text-text-2">objections heard</p></div>
        <div className="rounded-[12px] bg-subtle p-3"><p className="num text-[24px] font-semibold leading-none">{d.brushOffShare === null ? "—" : `${Math.round(d.brushOffShare * 100)}%`}</p><p className="mt-1 text-[12px] text-text-2">are brush-offs: test them, don’t argue</p></div>
      </div>
      <ObjectionRows rows={d.team.slice(0, 8)} />
      {best || worst ? (
        <ul className="mt-4 flex flex-col gap-1.5 text-[13px]">
          {best ? <li className="rounded-[10px] bg-win-soft px-3 py-2">Best handled: <b>{OBJECTION_LABELS[best.key as keyof typeof OBJECTION_LABELS]}</b> ({Math.round((best.wonRate ?? 0) * 100)}% still say yes).</li> : null}
          {worst && worst.key !== best?.key ? <li className="rounded-[10px] bg-subtle px-3 py-2">To work on: <b>{OBJECTION_LABELS[worst.key as keyof typeof OBJECTION_LABELS]}</b>. Practise it in the drill and try the other reply (← → during a call).</li> : null}
        </ul>
      ) : null}
      {d.byMarket.length > 1 ? (
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-[12px]">
          {d.byMarket.map((m) => <div key={m.key}><p className="mb-1 font-medium">{m.key === "FR" ? "France" : m.key === "ES" ? "Spain" : m.key}</p>{m.top.map((t) => <p key={t.key} className="text-text-2">{OBJECTION_LABELS[t.key as keyof typeof OBJECTION_LABELS] ?? t.key} <span className="num text-text-3">{t.count}</span></p>)}</div>)}
        </div>
      ) : null}
    </Panel>
  );
}

/** Two-minute practice: the prospect's line, you answer out loud, then reveal the best reply. */
function ObjectionDrill() {
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const rep = useQuery({ queryKey: ["call-objections"], queryFn: () => api<ObjectionReport>("/api/calls/objections") });
  const [lang, setLang] = React.useState<"FR" | "ES">("FR");
  const [i, setI] = React.useState(0);
  const [shown, setShown] = React.useState(false);
  const [score, setScore] = React.useState({ good: 0, total: 0 });
  // Most frequent objections come up first, then the rest.
  const order = React.useMemo(() => {
    const count = (k: string) => rep.data?.team.find((t) => t.key === k)?.count ?? 0;
    return [...OBJECTION_GUIDE].sort((a, b) => count(b.key) - count(a.key));
  }, [rep.data]);
  const g = order[i % order.length];
  const v = rep.data?.picks[g.key] ?? 1;
  const item = pb.data ? findItem(pb.data.items, "objection", `${g.key}#${v}`, lang) : null;
  const vars = { founder: pb.data?.founderName, calendly: pb.data?.links.calendly, deck: lang === "ES" ? pb.data?.links.deckES : pb.data?.links.deckFR };
  const next = (good: boolean) => { setScore((s) => ({ good: s.good + (good ? 1 : 0), total: s.total + 1 })); setShown(false); setI((x) => x + 1); };
  return (
    <Panel className="flex flex-col gap-3">
      <PanelTitle action={<SegmentedSwitch size="sm" label="Drill language" value={lang} onChange={setLang} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />}>Objection drill</PanelTitle>
      <p className="text-[13px] text-text-2">Answer out loud, then check the reply. Two minutes before a session warms you up.</p>
      <div className="rounded-[14px] bg-mkt-soft p-4">
        <p className="text-[12px] font-medium text-mkt">The prospect says</p>
        <p className="mt-1 text-xl font-semibold">« {g.say[lang]} »</p>
        <p className="mt-1 text-[12px] text-text-2">{OBJECTION_LABELS[g.key]} · {g.type === "brush_off" ? "brush-off" : "real objection"}</p>
      </div>
      {shown && item ? (
        <ol className="flex flex-col gap-2">
          {replySteps(fill(item.body, vars)).map((line, k) => (
            <li key={k} className="grid grid-cols-[5.5rem_1fr] gap-2 text-[15px] leading-snug"><span className={cn("pt-0.5 text-[11px] font-semibold uppercase tracking-wide", ["text-sales", "text-mkt", "text-win"][k])}>{REPLY_STEPS[k]}</span><span>{line}</span></li>
          ))}
        </ol>
      ) : <p className="text-[13px] text-text-3">{g.meaning}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!shown ? <Button variant="primary" onClick={() => setShown(true)}>Show the reply</Button> : (
          <>
            <Button variant="primary" onClick={() => next(true)}>I had it</Button>
            <Button variant="outline" onClick={() => next(false)}>Not yet</Button>
          </>
        )}
        <span className="num ml-auto text-[12px] text-text-2">{score.total ? `${score.good}/${score.total} right` : `${order.length} objections`}</span>
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
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["email-queue"], queryFn: () => api<{ items: QItem[]; sentToday: number }>("/api/email/queue") });
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean }>("/api/email/status") });
  const [keys] = React.useState(() => new Map<string, string>());
  const [open, setOpen] = React.useState<{ item: QItem; channel: "email" | "whatsapp" } | null>(null);
  const idemFor = (k: string) => { if (!keys.has(k)) keys.set(k, crypto.randomUUID()); return keys.get(k)!; };
  const textFor = (it: QItem) => {
    const t = pb.data ? findItem(pb.data.items, "email", it.template, it.market) : null;
    const v = { business: it.name, contact: it.contact, founder: pb.data?.founderName, calendly: pb.data?.links.calendly, deck: it.market === "ES" ? pb.data?.links.deckES : pb.data?.links.deckFR };
    return { subject: fill(t?.subject ?? "", v), body: fill(t?.body ?? "", v) };
  };
  const emailable = (q.data?.items ?? []).filter((it) => it.email);
  const batch = useMutation({
    mutationFn: () => api<{ sent: number; failed: number; results: { idempotency_key: string; ok: boolean; message?: string }[] }>("/api/email/batch", {
      body: { items: emailable.map((it) => ({ idempotency_key: idemFor(it.key), channel: "email", via: "gmail", context: it.context, account_id: it.accountId, to: it.email, ...textFor(it), template_key: it.template, language: it.market, market: it.market })) },
    }),
    onSuccess: (r) => { toast(`${r.sent} emails sent${r.failed ? `, ${r.failed} skipped (see why on each line)` : ""}`); qc.invalidateQueries({ queryKey: ["email-queue"] }); qc.invalidateQueries({ queryKey: ["my-day"] }); qc.invalidateQueries({ queryKey: ["email-benchmarks"] }); },
    onError: (e) => toast(e instanceof ApiError && e.body.error === "consent_required" ? "Connect Gmail first" : (e as Error).message),
  });
  if (!q.data) return null;
  const items = q.data.items;
  const failed = new Map((batch.data?.results ?? []).filter((r) => !r.ok).map((r) => [r.idempotency_key, r.message ?? ""]));
  return (
    <Panel>
      <PanelTitle action={<span className="num text-[13px] text-text-2"><b className="text-ink">{q.data.sentToday}</b> sent today</span>}>Messages to send <span className="num ml-1 rounded-full bg-sales px-2 py-0.5 text-[12px] text-panel">{items.length}</span></PanelTitle>
      {items.length === 0 ? <p className="text-sm text-text-2">Everyone you reached has had a message. Calls create new ones: thank-you, Calendly, deck, confirmation, “tried to reach you”, and a nudge after 3 days without a reply.</p> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {gmail.data?.connected ? (
              <Button variant="primary" disabled={batch.isPending || emailable.length === 0} onClick={() => batch.mutate()}><Send /> {batch.isPending ? "Sending…" : `Send ${emailable.length} emails by Gmail`}</Button>
            ) : <Button asChild variant="primary"><a href="/api/auth/google/gmail?back=/call">Connect Gmail to send all at once</a></Button>}
            <span className="text-[12px] text-text-3">Each email uses its template in the prospect’s language. Check the list first: sending is one click, not automatic.</span>
          </div>
          <ul className="flex flex-col divide-y divide-hairline">
            {items.slice(0, 25).map((it) => (
              <li key={it.key} className="flex flex-wrap items-center gap-2 py-2">
                <span className={cn("size-2 rounded-full", it.reason === "talked" ? "bg-win" : it.reason === "no_answer" ? "bg-sales" : "bg-mkt")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.name} <span className="font-normal text-text-3">· {it.market}</span></p>
                  <p className="text-[12px] text-text-3">{REASON[it.reason]} · {EMAIL_TEMPLATE_LABELS[it.template]}{failed.has(keys.get(it.key) ?? "") ? <span className="text-bad"> · {failed.get(keys.get(it.key)!)}</span> : null}</p>
                </div>
                {it.email ? <Button size="sm" variant="outline" onClick={() => setOpen({ item: it, channel: "email" })}><Mail /> Email</Button> : null}
                {it.phone ? <Button size="sm" variant="outline" onClick={() => setOpen({ item: it, channel: "whatsapp" })}><MessageCircle /> WhatsApp</Button> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {open && pb.data ? (
        <div className="mt-3">
          <FollowUpComposer key={open.item.key + open.channel} channel={open.channel} template={open.item.template} sendKey={open.channel === "email" ? idemFor(open.item.key) : undefined} gmailConnected={Boolean(gmail.data?.connected)} playbook={pb.data}
            target={{ accountId: open.item.accountId, name: open.item.name, contact: open.item.contact, email: open.item.email, phone: open.item.phone, market: open.item.market }} onClose={() => setOpen(null)} />
        </div>
      ) : null}
    </Panel>
  );
}
