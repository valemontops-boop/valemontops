"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, MessageCircle, Phone, Presentation, SkipForward, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Input, Panel, SegmentedSwitch, Skeleton, Textarea } from "@/components/ui/form";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome, type CallStats } from "@/domain/calls";
import { LIVE_OBJECTIONS, OBJECTION_KEYS, OBJECTION_LABELS, type Objection } from "@/domain/constants";
import {
  EMAIL_TEMPLATES, fill, findItem, hasMissingLink, mailtoLink, suggestedFollowUp, whatsappLink, type ComposerKind, type Lang, type PlaybookItem,
} from "@/domain/playbook";
import { addDays } from "@/domain/time";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

type QueueItem = { accountId: string; name: string; phone: string; city: string; niche: string; country: "FR" | "ES" | null; why: string; contactName: string; email: string };
type Summary = { session: { id: string; started_at: string; ended_at: string | null; list_id: string }; stats: CallStats };
type Playbook = { items: PlaybookItem[]; links: { calendly: string; deckFR: string; deckES: string }; founderName: string };
/** Who a follow-up goes to: the person on the line, or the one just called. */
export type Target = { accountId: string; name: string; contact: string; email: string; phone: string; market: Lang };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function useNow(active = true) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);

export function ActiveSession({ id, listId, onEnd }: { id: string; listId: string; onEnd: () => void }) {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`) });
  const queue = useQuery({ queryKey: ["call-queue", listId], queryFn: () => api<{ remaining: number; queue: QueueItem[] }>(`/api/calls/queue?list_id=${listId}`), enabled: Boolean(listId) });
  const playbook = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean }>("/api/email/status") });
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const current = queue.data?.queue.find((q) => !skipped.includes(q.accountId)) ?? null;
  const [phone, setPhone] = React.useState("");
  const [market, setMarket] = React.useState<Lang>("FR");
  const [objs, setObjs] = React.useState<Objection[]>([]);
  const [lastObj, setLastObj] = React.useState<Objection | null>(null);
  const [dialAt, setDialAt] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState<CallOutcome | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID()); // one idempotency key per call, reused on retry
  const [after, setAfter] = React.useState<{ target: Target; suggestion: ComposerKind | null; outcome: CallOutcome } | null>(null);
  const [composer, setComposer] = React.useState<{ kind: ComposerKind; target: Target } | null>(null);
  const now = useNow();
  const sessionSec = summary.data ? Math.max(0, Math.floor((now - Date.parse(summary.data.session.started_at)) / 1000)) : 0;
  const callSec = dialAt ? Math.max(0, Math.floor((now - dialAt) / 1000)) : null;
  const lang: Lang = listId ? current?.country ?? "FR" : market;
  const liveTarget: Target | null = listId
    ? current ? { accountId: current.accountId, name: current.name, contact: current.contactName, email: current.email, phone: current.phone, market: current.country ?? "FR" } : null
    : { accountId: "", name: "", contact: "", email: "", phone, market };
  const followTarget = after?.target ?? liveTarget;

  const end = useMutation({ mutationFn: () => api("/api/calls/sessions", { method: "PATCH", body: { id } }), onSuccess: () => { qc.invalidateQueries(); onEnd(); } });
  const log = useMutation({
    mutationKey: ["log-activity"],
    mutationFn: (b: Record<string, unknown>) => api<{ duplicate: boolean; opportunityId: string | null; event: { account_id: string } }>("/api/calls", {
      body: { idempotency_key: key, session_id: id, account_id: current?.accountId ?? "", phone: listId ? "" : phone, market: listId ? current?.country ?? null : market, objections: objs, duration_sec: callSec, ...b },
    }),
    onSuccess: (r, b) => {
      const o = b.outcome as CallOutcome;
      toast(r.opportunityId ? `${CALL_OUTCOME_LABELS[o]}: added to your pipeline` : CALL_OUTCOME_LABELS[o]);
      const suggestion = suggestedFollowUp(o, objs);
      // Keep the person just called as the follow-up target, so E / P / W still work after the queue moves on.
      if (suggestion && liveTarget) {
        const name = (b.business_name as string) || liveTarget.name;
        setAfter({ outcome: o, suggestion, target: { ...liveTarget, accountId: r.event?.account_id || liveTarget.accountId, name, contact: (b.contact_name as string) || liveTarget.contact } });
      } else setAfter(null);
      setPending(null); setPhone(""); setObjs([]); setLastObj(null); setDialAt(null); setKey(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: ["call-summary", id] });
      qc.invalidateQueries({ queryKey: ["call-queue", listId] });
      qc.invalidateQueries({ queryKey: ["my-day"] });
    },
    onError: (e) => toast(e instanceof ApiError && e.isBlocked ? e.message : `Error: ${(e as Error).message}. Tap again to retry (it won't count twice).`),
  });

  const tap = (o: CallOutcome) => {
    if (log.isPending) return;
    if (o === "call_back" || o === "interested" || o === "meeting") return setPending(o);
    log.mutate({ outcome: o });
  };
  const toggleObj = (o: Objection) => {
    setObjs((x) => (x.includes(o) ? x.filter((y) => y !== o) : [...x, o]));
    setLastObj((l) => (objs.includes(o) && l === o ? null : o));
    if (!dialAt) setDialAt(Date.now()); // an objection means someone picked up
  };
  const dial = () => {
    if (!dialAt) setDialAt(Date.now());
    const n = listId ? current?.phone : phone;
    if (n) window.location.href = `tel:${n}`;
  };
  const open = (kind: ComposerKind) => {
    if (!followTarget) return;
    setComposer({ kind, target: followTarget });
  };
  const copyCalendly = async () => {
    const link = playbook.data?.links.calendly;
    if (!link) return toast("Add your Calendly link in Settings › Workspace");
    try { await navigator.clipboard.writeText(link); toast("Calendly link copied"); } catch { toast(link); }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (composer) setComposer(null); else if (pending) setPending(null); else if (after) setAfter(null); return; }
      if (isTyping(e.target) || pending || composer || e.metaKey || e.ctrlKey || e.altKey) return;
      // Digits by physical key: works on AZERTY (no Shift needed) and QWERTY alike.
      const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2];
      if (digit && Number(digit) <= CALL_OUTCOMES.length) { e.preventDefault(); tap(CALL_OUTCOMES[Number(digit) - 1]); return; }
      const k = e.key.toLowerCase();
      const oi = (OBJECTION_KEYS as readonly string[]).indexOf(k);
      if (oi >= 0) { e.preventDefault(); toggleObj(LIVE_OBJECTIONS[oi]); return; }
      if (k === "enter") { e.preventDefault(); dial(); return; }
      if (k === "e") { e.preventDefault(); open(after?.suggestion === "confirm" ? "confirm" : "calendly"); return; }
      if (k === "p") { e.preventDefault(); open("deck"); return; }
      if (k === "w") { e.preventDefault(); open("whatsapp"); return; }
      if (k === "c") { e.preventDefault(); void copyCalendly(); return; }
      if (k === "n" && listId && current) { e.preventDefault(); setSkipped((x) => [...x, current.accountId]); setObjs([]); setLastObj(null); setDialAt(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const s = summary.data?.stats;
  const done = listId && queue.isSuccess && !current;
  const pb = playbook.data;
  const vars = { business: liveTarget?.name, contact: liveTarget?.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: lang === "ES" ? pb?.links.deckES : pb?.links.deckFR };
  const opener = pb ? findItem(pb.items, "opener", "default", lang) : null;
  const reply = pb && lastObj ? findItem(pb.items, "objection", lastObj, lang) : null;

  return (
    <div data-call-live className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">Calling</h1><p className="num text-sm text-text-2">{fmt(sessionSec)} · {listId ? `${queue.data?.remaining ?? "…"} left in list` : "free dialling"}{s?.avgTalkSec ? ` · avg talk ${fmt(s.avgTalkSec)}` : ""}</p></div>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Panel className="flex flex-col gap-4">
          {listId ? (
            queue.isPending ? <Skeleton className="h-20" /> : done ? (
              <EmptyState title="List finished" action={<Button variant="primary" size="sm" onClick={() => end.mutate()}>See the session summary</Button>}>Everyone in this list has been called today.</EmptyState>
            ) : current ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-text-2">{current.why}{current.niche ? ` · ${current.niche}` : ""}{current.city ? ` · ${current.city}` : ""} · <span className="rounded bg-subtle px-1.5 py-0.5">{lang}</span></p>
                  <p className="truncate text-2xl font-semibold tracking-tight">{current.name}</p>
                  {current.contactName ? <p className="text-sm text-text-2">Ask for {current.contactName}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  {callSec !== null ? <span className="num rounded-full bg-subtle px-3 py-1 text-sm font-medium" aria-label="Call timer">{fmt(callSec)}</span> : null}
                  <Button variant="primary" size="lg" onClick={dial}><Phone /> <span className="num">{current.phone}</span><Kbd dark>↵</Kbd></Button>
                  <Button variant="ghost" size="lg" aria-label="Skip this number (N)" onClick={() => { setSkipped((x) => [...x, current.accountId]); setObjs([]); setLastObj(null); setDialAt(null); }}><SkipForward /></Button>
                </div>
              </div>
            ) : null
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Number (optional, never stored for a refusal)" htmlFor="cm-phone" className="min-w-56 flex-1"><Input id="cm-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33…" className="num h-12 text-lg" /></Field>
              <SegmentedSwitch label="Country" value={market} onChange={setMarket} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
              <Button variant="primary" size="lg" onClick={dial}><Phone /> {callSec !== null ? <span className="num">{fmt(callSec)}</span> : "Dial"}</Button>
            </div>
          )}

          {!done ? (
            <>
              {opener && !dialAt ? <p className="rounded-[12px] border-l-4 border-ink bg-subtle p-3 text-[15px] leading-relaxed"><span className="mb-1 block text-[12px] font-medium text-text-2">Opener · {lang}</span>{fill(opener.body, vars)}</p> : null}
              <div>
                <p className="mb-2 text-sm font-medium">Objections heard <span className="font-normal text-text-3">(tick during the call, any outcome)</span></p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {LIVE_OBJECTIONS.map((o, i) => {
                    const on = objs.includes(o);
                    return (
                      <button key={o} type="button" aria-pressed={on} onClick={() => toggleObj(o)}
                        className={cn("flex min-h-11 items-center justify-between gap-2 rounded-[10px] border px-3 text-left text-sm transition-colors", on ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle")}>
                        <span>{OBJECTION_LABELS[o]}</span><Kbd dark={on}>{OBJECTION_KEYS[i].toUpperCase()}</Kbd>
                      </button>
                    );
                  })}
                </div>
                {reply ? (
                  <div className="mt-3 rounded-[12px] border border-ink p-3" aria-live="polite">
                    <p className="mb-1 text-[12px] font-medium text-text-2">Reply · {OBJECTION_LABELS[lastObj!]} · {lang}</p>
                    <p className="text-[15px] leading-relaxed">{fill(reply.body, vars)}</p>
                  </div>
                ) : null}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Outcome <span className="font-normal text-text-3">(one tap = one call)</span></p>
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
              </div>
            </>
          ) : null}
          {pending ? <YesDetails key={pending} outcome={pending} needsName={!listId} busy={log.isPending} onCancel={() => setPending(null)} onSave={(b) => log.mutate({ outcome: pending, ...b })} /> : null}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Follow-up</p>
              {gmail.data ? <span className="text-[12px] text-text-2">{gmail.data.connected ? "Gmail connected" : <a className="underline" href="/api/auth/google/gmail?back=/call">Connect Gmail</a>}</span> : null}
            </div>
            {after ? (
              <div className="flex items-start justify-between gap-2 rounded-[10px] bg-subtle p-2 text-sm">
                <p>For <b>{after.target.name || "the last call"}</b> ({CALL_OUTCOME_LABELS[after.outcome].toLowerCase()})</p>
                <button type="button" aria-label="Clear follow-up target" onClick={() => setAfter(null)} className="text-text-3"><X className="size-4" /></button>
              </div>
            ) : <p className="text-[12px] text-text-3">Sends to the person on the line. After a yes, it targets them until you clear it.</p>}
            {[
              { k: "calendly" as const, label: after?.suggestion === "confirm" ? "Confirmation email" : "Email + Calendly", key: "E", icon: <Mail />, kind: (after?.suggestion === "confirm" ? "confirm" : "calendly") as ComposerKind },
              { k: "deck" as const, label: "Send the deck", key: "P", icon: <Presentation />, kind: "deck" as ComposerKind },
              { k: "whatsapp" as const, label: "WhatsApp", key: "W", icon: <MessageCircle />, kind: "whatsapp" as ComposerKind },
            ].map((a) => {
              const suggested = after?.suggestion === a.kind || (a.k === "calendly" && after?.suggestion === "confirm");
              return (
                <button key={a.k} type="button" disabled={!followTarget} onClick={() => open(a.kind)}
                  className={cn("flex min-h-12 items-center gap-3 rounded-[12px] border px-3 text-left text-[15px] font-medium transition-colors disabled:opacity-50 [&_svg]:size-4", suggested ? "border-ink bg-ink text-panel hover:bg-accent-hover" : "border-control bg-panel hover:bg-subtle")}>
                  {a.icon}<span className="flex-1">{a.label}{suggested ? <span className="ml-2 text-[11px] font-normal opacity-80">suggested</span> : null}</span><Kbd dark={suggested}>{a.key}</Kbd>
                </button>
              );
            })}
            <button type="button" onClick={() => void copyCalendly()} className="flex min-h-10 items-center gap-3 rounded-[12px] px-3 text-left text-sm text-text-2 hover:bg-subtle [&_svg]:size-4"><Copy /><span className="flex-1">Copy my Calendly link</span><Kbd>C</Kbd></button>
          </Panel>
          {composer && pb ? (
            <FollowUpComposer key={`${composer.kind}-${composer.target.accountId}-${composer.target.name}`} kind={composer.kind} target={composer.target} playbook={pb} gmailConnected={Boolean(gmail.data?.connected)} sessionId={id} onClose={() => setComposer(null)} />
          ) : null}
        </div>
      </div>
      <p className="text-[12px] text-text-3"><Kbd>↵</Kbd> dial · <Kbd>1</Kbd>–<Kbd>7</Kbd> outcome · <Kbd>A</Kbd>–<Kbd>L</Kbd> objections · <Kbd>E</Kbd> email · <Kbd>P</Kbd> deck · <Kbd>W</Kbd> WhatsApp · <Kbd>C</Kbd> copy link · <Kbd>N</Kbd> skip · <Kbd>Esc</Kbd> close. Opening a link never counts as sent: only your confirmation does.</p>
    </div>
  );
}

const SHORT_TPL = { calendly: "Calendly", deck: "Deck", confirm: "Confirm" } as const;

function Kbd({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <kbd className={cn("inline-flex min-w-5 items-center justify-center rounded-[5px] border px-1 font-sans text-[11px] font-medium leading-4", dark ? "border-panel/40 text-panel/80" : "border-hairline bg-panel text-text-3")}>{children}</kbd>;
}

function YesDetails({ outcome, needsName, busy, onCancel, onSave }: { outcome: CallOutcome; needsName: boolean; busy: boolean; onCancel: () => void; onSave: (b: Record<string, string>) => void }) {
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = React.useState(outcome === "meeting" ? addDays(today, 3) : outcome === "interested" ? addDays(today, 1) : addDays(today, 2));
  const [business, setBusiness] = React.useState("");
  const [contact, setContact] = React.useState("");
  return (
    <form className="flex flex-col gap-3 rounded-[12px] bg-subtle p-3" onSubmit={(e) => { e.preventDefault(); onSave({ follow_up_date: date, business_name: business, contact_name: contact }); }}>
      <p className="text-sm font-medium">{outcome === "meeting" ? "Meeting date" : "When to call back"} <span className="font-normal text-text-3">(Enter saves, Esc cancels)</span></p>
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
        <Button type="submit" variant="primary" autoFocus={!needsName} disabled={busy || (needsName && !business.trim())}>{busy ? "Saving…" : `Save · ${CALL_OUTCOME_LABELS[outcome]}`}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * Prepares the follow-up from the playbook in the prospect's language. Gmail sends directly (send-only grant);
 * the mail app and WhatsApp open prefilled and only count once the founder confirms it was sent.
 */
export function FollowUpComposer({ kind, target, playbook, gmailConnected, sessionId, onClose, context = "after_call" }: { kind: ComposerKind; target: Target; playbook: Playbook; gmailConnected: boolean; sessionId?: string; onClose: () => void; context?: "after_call" | "cold" }) {
  const qc = useQueryClient();
  const isWa = kind === "whatsapp";
  const [lang, setLang] = React.useState<Lang>(target.market);
  const [tpl, setTpl] = React.useState<string>(isWa ? "calendly" : kind);
  const [to, setTo] = React.useState(isWa ? target.phone : target.email);
  const [business, setBusiness] = React.useState(target.name);
  const [idem] = React.useState(() => crypto.randomUUID());
  const [opened, setOpened] = React.useState(false);
  const vars = { business, contact: target.contact, founder: playbook.founderName, calendly: playbook.links.calendly, deck: lang === "ES" ? playbook.links.deckES : playbook.links.deckFR };
  const item = findItem(playbook.items, isWa ? "whatsapp" : "email", tpl, lang);
  const [subject, setSubject] = React.useState(() => fill(item?.subject ?? "", vars));
  const [body, setBody] = React.useState(() => fill(item?.body ?? "", vars));
  const reload = (l: Lang, t: string) => {
    const it = findItem(playbook.items, isWa ? "whatsapp" : "email", t, l);
    const v = { ...vars, deck: l === "ES" ? playbook.links.deckES : playbook.links.deckFR };
    setSubject(fill(it?.subject ?? "", v));
    setBody(fill(it?.body ?? "", v));
  };
  const payload = (via: "gmail" | "mail_app" | "whatsapp", checkOnly = false) => ({
    idempotency_key: idem, channel: isWa ? "whatsapp" : "email", via, context, account_id: target.accountId, call_session_id: sessionId ?? "", to: to.trim(), subject, body,
    template_key: tpl, language: lang, market: target.market, business_name: target.accountId ? "" : business.trim(), contact_name: target.contact, check_only: checkOnly,
  });
  const send = useMutation({
    mutationFn: (via: "gmail" | "mail_app" | "whatsapp") => api("/api/email/send", { body: payload(via) }),
    onSuccess: () => { toast(isWa ? "WhatsApp logged" : "Email sent and logged"); qc.invalidateQueries({ queryKey: ["call-summary"] }); qc.invalidateQueries({ queryKey: ["my-day"] }); qc.invalidateQueries({ queryKey: ["email-sends"] }); onClose(); },
  });
  const check = useMutation({
    mutationFn: (via: "mail_app" | "whatsapp") => api("/api/email/send", { body: payload(via, true) }).then(() => via),
    onSuccess: (via) => {
      window.open(via === "whatsapp" ? whatsappLink(to, body) : mailtoLink(to, subject, body), "_blank", "noopener");
      setOpened(true);
    },
  });
  const err = send.error ?? check.error;
  const consent = err instanceof ApiError && err.body.error === "consent_required";
  const missing = hasMissingLink(body);
  const needsName = !target.accountId && !business.trim();
  const blocked = missing || needsName || !to.trim();
  return (
    <Panel className="flex flex-col gap-3" aria-label="Follow-up composer">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{isWa ? "WhatsApp" : "Email"}{target.name ? ` · ${target.name}` : ""}</p>
        <Button size="icon" variant="ghost" aria-label="Close (Esc)" onClick={onClose}><X /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <SegmentedSwitch size="sm" label="Language" value={lang} onChange={(l) => { setLang(l); reload(l, tpl); }} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
        <SegmentedSwitch size="sm" label="Template" value={tpl} onChange={(t) => { setTpl(t); reload(lang, t); }} options={isWa ? [{ value: "calendly", label: "Calendly" }, { value: "deck", label: "Deck" }] : EMAIL_TEMPLATES.map((t) => ({ value: t, label: SHORT_TPL[t] }))} />
      </div>
      {!target.accountId ? <Input aria-label="Business name" placeholder="Business name (required to follow up)" value={business} onChange={(e) => setBusiness(e.target.value)} /> : null}
      <Input aria-label={isWa ? "WhatsApp number" : "To"} type={isWa ? "tel" : "email"} placeholder={isWa ? "+34…" : "contact@business.example.com"} value={to} onChange={(e) => setTo(e.target.value)} />
      {!isWa ? <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} /> : null}
      <Textarea aria-label="Message" rows={isWa ? 4 : 8} value={body} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) { e.preventDefault(); if (!isWa && gmailConnected) send.mutate("gmail"); } }} />
      {missing ? <p className="text-[12px] text-bad">A link is missing. Add it in Settings › Workspace.</p> : null}
      {consent ? <p className="text-sm">Connect your Gmail first (send only, Valemont OS never reads your inbox). <a className="font-medium underline" href="/api/auth/google/gmail?back=/call">Connect Gmail</a></p> : err ? <p className="text-sm text-bad" role="alert">{(err as Error).message}</p> : null}
      {opened ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-subtle p-2">
          <p className="flex-1 text-sm">Did you send it?</p>
          <Button size="sm" variant="primary" disabled={send.isPending} onClick={() => send.mutate(isWa ? "whatsapp" : "mail_app")}>Yes, sent</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpened(false)}>Not sent</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {isWa ? <Button variant="primary" disabled={blocked || check.isPending} onClick={() => check.mutate("whatsapp")}><MessageCircle /> Open WhatsApp</Button> : (
            <>
              {gmailConnected ? <Button variant="primary" disabled={blocked || send.isPending} onClick={() => send.mutate("gmail")}><Mail /> {send.isPending ? "Sending…" : "Send with Gmail"}</Button> : null}
              <Button variant={gmailConnected ? "outline" : "primary"} disabled={blocked || check.isPending} onClick={() => check.mutate("mail_app")}>Open in mail app</Button>
            </>
          )}
          <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(isWa ? body : `${subject}\n\n${body}`); toast("Copied"); } catch { /* clipboard blocked */ } }}><Copy /> Copy</Button>
        </div>
      )}
      {lang === "ES" && context === "cold" && !isWa ? <p className="text-[12px] text-text-3">Spain: cold email needs prior consent (LSSI art. 21).</p> : null}
    </Panel>
  );
}
