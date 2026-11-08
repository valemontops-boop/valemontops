"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, SkipForward } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Skeleton } from "@/components/ui/form";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome, type CallStats } from "@/domain/calls";
import { OBJECTIONS, OBJECTION_LABELS } from "@/domain/constants";
import { addDays } from "@/domain/time";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Bars } from "./charts";

type ListRow = { list: { id: string; name: string; niche: string; market: string | null }; total: number; called: number; reached: number; positive: number; meetings: number; remaining: number };
type QueueItem = { accountId: string; name: string; phone: string; city: string; niche: string; country: "FR" | "ES" | null; why: string; contactName: string };
type Summary = { session: { id: string; started_at: string; ended_at: string | null; list_id: string }; stats: CallStats; previous: { sessions: number; pickupRate: number | null; positiveRate: number | null; dials: number | null } };
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
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
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
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
                    <div className="bg-ink" style={{ width: `${l.total ? (l.called / l.total) * 100 : 0}%` }} />
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

function useElapsed(since: string | undefined) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!since) return "0:00";
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ActiveSession({ id, listId, onEnd }: { id: string; listId: string; onEnd: () => void }) {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`) });
  const queue = useQuery({ queryKey: ["call-queue", listId], queryFn: () => api<{ remaining: number; queue: QueueItem[] }>(`/api/calls/queue?list_id=${listId}`), enabled: Boolean(listId) });
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const current = queue.data?.queue.find((q) => !skipped.includes(q.accountId)) ?? null;
  const [phone, setPhone] = React.useState("");
  const [market, setMarket] = React.useState<"FR" | "ES">("FR");
  const [pending, setPending] = React.useState<CallOutcome | null>(null); // outcome waiting for objection or details
  const [key, setKey] = React.useState(() => crypto.randomUUID()); // one idempotency key per call, reused on retry
  const elapsed = useElapsed(summary.data?.session.started_at);
  const end = useMutation({ mutationFn: () => api("/api/calls/sessions", { method: "PATCH", body: { id } }), onSuccess: () => { qc.invalidateQueries(); onEnd(); } });
  const log = useMutation({
    mutationKey: ["log-activity"],
    mutationFn: (b: Record<string, unknown>) => api<{ duplicate: boolean; opportunityId: string | null }>("/api/calls", { body: { idempotency_key: key, session_id: id, account_id: current?.accountId ?? "", phone: listId ? "" : phone, market: listId ? current?.country ?? null : market, ...b } }),
    onSuccess: (r, b) => {
      const o = b.outcome as CallOutcome;
      toast(r.opportunityId ? `${CALL_OUTCOME_LABELS[o]}: added to your pipeline` : CALL_OUTCOME_LABELS[o]);
      setPending(null); setPhone(""); setKey(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: ["call-summary", id] });
      qc.invalidateQueries({ queryKey: ["call-queue", listId] });
      qc.invalidateQueries({ queryKey: ["my-day"] });
    },
    onError: (e) => toast(e instanceof ApiError && e.isBlocked ? e.message : `Error: ${(e as Error).message}. Tap again to retry (it won't count twice).`),
  });
  const tap = (o: CallOutcome) => {
    if (log.isPending) return;
    if (o === "not_interested" || o === "call_back" || o === "interested" || o === "meeting") return setPending(o);
    log.mutate({ outcome: o });
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || pending) return;
      const n = Number(e.key);
      if (n >= 1 && n <= CALL_OUTCOMES.length) { e.preventDefault(); tap(CALL_OUTCOMES[n - 1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const s = summary.data?.stats;
  const done = listId && queue.isSuccess && !current;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">Calling</h1><p className="num text-sm text-text-2">{elapsed} · {listId ? `${queue.data?.remaining ?? "…"} left in list` : "free dialling"}</p></div>
        <Button variant="outline" onClick={() => end.mutate()} disabled={end.isPending}>End session</Button>
      </div>
      <div className="grid grid-cols-4 gap-2" aria-live="polite">
        {[["Dials", s?.dials], ["Picked up", s?.pickedUp], ["Yes", s ? s.interested + s.callBacks : undefined], ["Meetings", s?.meetings]].map(([l, v], i) => (
          <div key={String(l)} className={cn("rounded-[12px] p-3 text-center", i === 3 ? "bg-ink text-panel" : "bg-panel")}>
            <p className="num text-[28px] font-semibold leading-none">{v ?? 0}</p>
            <p className={cn("mt-1 text-[12px]", i === 3 ? "text-panel/80" : "text-text-2")}>{l}</p>
          </div>
        ))}
      </div>

      <Panel className="flex flex-col gap-4">
        {listId ? (
          queue.isPending ? <Skeleton className="h-20" /> : done ? (
            <EmptyState title="List finished" action={<Button variant="primary" size="sm" onClick={() => end.mutate()}>See the session summary</Button>}>Everyone in this list has been called today.</EmptyState>
          ) : current ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-text-2">{current.why}{current.niche ? ` · ${current.niche}` : ""}{current.city ? ` · ${current.city}` : ""}</p>
                <p className="truncate text-2xl font-semibold tracking-tight">{current.name}</p>
                {current.contactName ? <p className="text-sm text-text-2">Ask for {current.contactName}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button asChild variant="primary" size="lg"><a href={`tel:${current.phone}`}><Phone /> <span className="num">{current.phone}</span></a></Button>
                <Button variant="ghost" size="lg" aria-label="Skip this number" onClick={() => setSkipped((x) => [...x, current.accountId])}><SkipForward /></Button>
              </div>
            </div>
          ) : null
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Number (optional, never stored for a refusal)" htmlFor="cm-phone" className="min-w-56 flex-1"><Input id="cm-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33…" className="num h-12 text-lg" /></Field>
            <SegmentedSwitch label="Country" value={market} onChange={setMarket} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
          </div>
        )}

        {!done ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CALL_OUTCOMES.map((o, i) => (
              <button key={o} type="button" onClick={() => tap(o)} disabled={log.isPending || (Boolean(listId) && !current)}
                className={cn("flex min-h-16 flex-col items-center justify-center rounded-[12px] border px-2 text-center text-[15px] font-medium transition-colors disabled:opacity-50",
                  o === "meeting" ? "border-ink bg-ink text-panel hover:bg-accent-hover" : o === "interested" || o === "call_back" ? "border-ink hover:bg-subtle" : "border-hairline bg-panel hover:bg-subtle",
                  pending === o && "ring-2 ring-ink ring-offset-2 ring-offset-panel", o === "meeting" && "col-span-2 sm:col-span-1")}>
                {CALL_OUTCOME_LABELS[o]}
                <span className={cn("text-[11px] font-normal", o === "meeting" ? "text-panel/70" : "text-text-3")}>key {i + 1}</span>
              </button>
            ))}
          </div>
        ) : null}

        {pending === "not_interested" ? (
          <div className="rounded-[12px] bg-subtle p-3">
            <p className="mb-2 text-sm font-medium">Why? (one tap)</p>
            <div className="flex flex-wrap gap-2">
              {OBJECTIONS.map((ob) => <button key={ob} type="button" onClick={() => log.mutate({ outcome: "not_interested", objection: ob })} className="min-h-11 rounded-full border border-control bg-panel px-4 text-sm hover:bg-subtle">{OBJECTION_LABELS[ob]}</button>)}
              <button type="button" onClick={() => log.mutate({ outcome: "not_interested" })} className="min-h-11 rounded-full px-4 text-sm text-text-2 underline">No reason</button>
            </div>
          </div>
        ) : pending ? <YesDetails key={pending} outcome={pending} needsName={!listId} busy={log.isPending} onCancel={() => setPending(null)} onSave={(b) => log.mutate({ outcome: pending, ...b })} /> : null}
      </Panel>
      <p className="text-[12px] text-text-3">Every tap counts in your day (calls, new businesses). Opening the phone link does not count; only the outcome you tap does.</p>
    </div>
  );
}

function YesDetails({ outcome, needsName, busy, onCancel, onSave }: { outcome: CallOutcome; needsName: boolean; busy: boolean; onCancel: () => void; onSave: (b: Record<string, string>) => void }) {
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = React.useState(outcome === "meeting" ? addDays(today, 3) : outcome === "interested" ? addDays(today, 1) : addDays(today, 2));
  const [business, setBusiness] = React.useState("");
  const [contact, setContact] = React.useState("");
  return (
    <form className="flex flex-col gap-3 rounded-[12px] bg-subtle p-3" onSubmit={(e) => { e.preventDefault(); onSave({ follow_up_date: date, business_name: business, contact_name: contact }); }}>
      <p className="text-sm font-medium">{outcome === "meeting" ? "Meeting date" : "When to call back"}</p>
      <div className="flex flex-wrap gap-2">
        {[["Today", 0], ["Tomorrow", 1], ["In 2 days", 2], ["Next week", 7]].map(([l, d]) => { const v = addDays(today, d as number); return <button key={String(l)} type="button" aria-pressed={date === v} onClick={() => setDate(v)} className={cn("min-h-10 rounded-full border px-3 text-sm", date === v ? "border-ink bg-ink text-panel" : "border-control bg-panel")}>{l}</button>; })}
        <Input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-40" />
      </div>
      {needsName ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input aria-label="Business name" required autoFocus placeholder="Business name (required)" value={business} onChange={(e) => setBusiness(e.target.value)} />
          <Input aria-label="Contact name" placeholder="Who you spoke to (optional)" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || (needsName && !business.trim())}>{busy ? "Saving…" : `Save · ${CALL_OUTCOME_LABELS[outcome]}`}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
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
          <div key={l} className={cn("rounded-[20px] p-4", i === 3 ? "bg-ink text-panel" : "bg-panel")}><p className={cn("text-[13px]", i === 3 ? "text-panel/80" : "text-text-2")}>{l}</p><p className="num text-[36px] font-semibold leading-tight">{v}</p><p className={cn("text-[12px]", i === 3 ? "text-panel/75" : "text-text-3")}>{n}</p></div>
        ))}
      </div>
      <Panel>
        <PanelTitle>Funnel</PanelTitle>
        <Bars data={[{ label: "Dials", value: s.dials }, { label: "Picked up", value: s.pickedUp }, { label: "Decision-maker", value: s.decisionMakerReached }, { label: "Yes", value: yes }, { label: "Meetings", value: s.meetings }]} showShare />
      </Panel>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Panel><PanelTitle>Objections</PanelTitle>{s.objections.length ? <Bars data={s.objections.map((o) => ({ label: OBJECTION_LABELS[o.key as keyof typeof OBJECTION_LABELS] ?? o.key, value: o.count }))} /> : <p className="text-sm text-text-2">No objection recorded.</p>}</Panel>
        <Panel><PanelTitle>By hour</PanelTitle>{s.byHour.length ? <Bars data={s.byHour.map((h) => ({ label: `${h.hour}:00`, value: h.dials, sub: `${h.pickedUp} picked up` }))} /> : <p className="text-sm text-text-2">No call.</p>}</Panel>
      </div>
    </div>
  );
}
