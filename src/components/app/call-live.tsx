"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, Mail, MessageCircle, Phone, Presentation, Send, SkipForward, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Input, Panel, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome, type CallStats } from "@/domain/calls";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { OBJECTION_GUIDE, OBJECTION_TYPE_LABEL, REPLY_STEPS, VARIANTS, guideOf, replySteps, type VariantStat } from "@/domain/objections";
import {
  COLD_TEMPLATES, EMAIL_TEMPLATE_LABELS, TEMPLATES, TEMPLATE_SHORT, fill, findItem, hasMissingLink, mailtoLink, suggestedFollowUp, whatsappLink,
  type Lang, type PlaybookItem, type TemplateKey,
} from "@/domain/playbook";
import { addDays } from "@/domain/time";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

type QueueItem = { accountId: string; name: string; phone: string; city: string; niche: string; country: "FR" | "ES" | null; why: string; contactName: string; email: string };
type Summary = { session: { id: string; started_at: string; ended_at: string | null; list_id: string }; stats: CallStats; messages: number };
export type Playbook = { items: PlaybookItem[]; links: { calendly: string; deckFR: string; deckES: string }; founderName: string };
export type ObjectionReport = { days: number; team: { key: string; count: number; won: number; wonRate: number | null }[]; variants: VariantStat[]; picks: Record<string, number>; heard: number; brushOffShare: number | null; byMarket: { key: string; total: number; top: { key: string; count: number }[] }[]; byNiche: { key: string; total: number; top: { key: string; count: number }[] }[] };
/** Who a message goes to: the person on the line, or the one just called. */
export type Target = { accountId: string; name: string; contact: string; email: string; phone: string; market: Lang };
type Channel = "email" | "whatsapp";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function useNow() {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
const BRUSH = OBJECTION_GUIDE.filter((g) => g.type === "brush_off");
const REAL = OBJECTION_GUIDE.filter((g) => g.type === "real");
const STEP_TONE = ["text-sales", "text-mkt", "text-win"] as const;

export function ActiveSession({ id, listId, onEnd }: { id: string; listId: string; onEnd: () => void }) {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`) });
  const queue = useQuery({ queryKey: ["call-queue", listId], queryFn: () => api<{ remaining: number; queue: QueueItem[] }>(`/api/calls/queue?list_id=${listId}`), enabled: Boolean(listId) });
  const playbook = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const report = useQuery({ queryKey: ["call-objections"], queryFn: () => api<ObjectionReport>("/api/calls/objections") });
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean }>("/api/email/status") });
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const current = queue.data?.queue.find((q) => !skipped.includes(q.accountId)) ?? null;
  const [phone, setPhone] = React.useState("");
  const [market, setMarket] = React.useState<Lang>("FR");
  const [objs, setObjs] = React.useState<Objection[]>([]);
  const [focusObj, setFocusObj] = React.useState<Objection | null>(null);
  const [variant, setVariant] = React.useState<Record<string, number>>({});
  const [dialAt, setDialAt] = React.useState<number | null>(null);
  const [pending, setPending] = React.useState<CallOutcome | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID()); // one idempotency key per call, reused on retry
  const [after, setAfter] = React.useState<{ target: Target; suggestion: TemplateKey | null; outcome: CallOutcome; sendKey: string } | null>(null);
  const [composer, setComposer] = React.useState<{ channel: Channel; template: TemplateKey; target: Target; sendKey?: string } | null>(null);
  const now = useNow();
  const sessionSec = summary.data ? Math.max(0, Math.floor((now - Date.parse(summary.data.session.started_at)) / 1000)) : 0;
  const callSec = dialAt ? Math.max(0, Math.floor((now - dialAt) / 1000)) : null;
  const lang: Lang = listId ? current?.country ?? "FR" : market;
  const liveTarget: Target | null = listId
    ? current ? { accountId: current.accountId, name: current.name, contact: current.contactName, email: current.email, phone: current.phone, market: current.country ?? "FR" } : null
    : { accountId: "", name: "", contact: "", email: "", phone, market };
  const followTarget = after?.target ?? liveTarget;
  const pb = playbook.data;
  const resetCall = () => { setObjs([]); setFocusObj(null); setVariant({}); setDialAt(null); };

  const end = useMutation({ mutationFn: () => api("/api/calls/sessions", { method: "PATCH", body: { id } }), onSuccess: () => { qc.invalidateQueries(); onEnd(); } });
  const log = useMutation({
    mutationKey: ["log-activity"],
    mutationFn: (b: Record<string, unknown>) => api<{ duplicate: boolean; opportunityId: string | null; event: { account_id: string } }>("/api/calls", {
      body: { idempotency_key: key, session_id: id, account_id: current?.accountId ?? "", phone: listId ? "" : phone, market: listId ? current?.country ?? null : market, objections: objs, replies: objs.map((o) => `${o}#${variant[o] ?? 1}`), duration_sec: callSec, ...b },
    }),
    onSuccess: (r, b) => {
      const o = b.outcome as CallOutcome;
      toast(r.opportunityId ? `${CALL_OUTCOME_LABELS[o]}: added to your pipeline` : CALL_OUTCOME_LABELS[o]);
      let suggestion = suggestedFollowUp(o, objs);
      // No message possible for a free-dial refusal: the number is not kept (D030).
      if (!listId && !isYes(o)) suggestion = null;
      if (suggestion && COLD_TEMPLATES.includes(suggestion) && (liveTarget?.market ?? "FR") === "ES") suggestion = null; // Spain: no cold message without consent
      if (suggestion && liveTarget) {
        const name = (b.business_name as string) || liveTarget.name;
        setAfter({ outcome: o, suggestion, sendKey: crypto.randomUUID(), target: { ...liveTarget, accountId: r.event?.account_id || liveTarget.accountId, name, contact: (b.contact_name as string) || liveTarget.contact } });
      } else setAfter(null);
      setPending(null); setPhone(""); resetCall(); setKey(crypto.randomUUID());
      qc.invalidateQueries({ queryKey: ["call-summary", id] });
      qc.invalidateQueries({ queryKey: ["call-queue", listId] });
      qc.invalidateQueries({ queryKey: ["call-objections"] });
      qc.invalidateQueries({ queryKey: ["my-day"] });
    },
    onError: (e) => toast(e instanceof ApiError && e.isBlocked ? e.message : `Error: ${(e as Error).message}. Tap again to retry (it won't count twice).`),
  });
  // One key sends the suggested message: straight through Gmail when connected and an address is known.
  const quick = useMutation({
    mutationFn: (a: NonNullable<typeof after>) => {
      const it = pb ? findItem(pb.items, "email", a.suggestion!, a.target.market) : null;
      const v = { business: a.target.name, contact: a.target.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: a.target.market === "ES" ? pb?.links.deckES : pb?.links.deckFR };
      return api("/api/email/send", { body: { idempotency_key: a.sendKey, channel: "email", via: "gmail", account_id: a.target.accountId, call_session_id: id, to: a.target.email, subject: fill(it?.subject ?? "", v), body: fill(it?.body ?? "", v), template_key: a.suggestion, language: a.target.market, market: a.target.market } });
    },
    onSuccess: (_r, a) => { toast(`${TEMPLATE_SHORT[a.suggestion!]} email sent to ${a.target.name || a.target.email}`); setAfter(null); qc.invalidateQueries({ queryKey: ["call-summary", id] }); qc.invalidateQueries({ queryKey: ["email-queue"] }); },
    onError: (e, a) => {
      if (e instanceof ApiError && e.body.error === "consent_required") toast("Connect Gmail first (link in the Messages panel)");
      else { toast((e as Error).message); setComposer({ channel: "email", template: a.suggestion!, target: a.target, sendKey: a.sendKey }); }
    },
  });
  const sendSuggested = () => {
    if (!after?.suggestion) return;
    if (gmail.data?.connected && after.target.email && after.target.accountId) quick.mutate(after);
    else setComposer({ channel: after.target.email || !after.target.phone ? "email" : "whatsapp", template: after.suggestion, target: after.target, sendKey: after.sendKey });
  };

  const tap = (o: CallOutcome) => {
    if (log.isPending) return;
    if (o === "call_back" || o === "interested" || o === "meeting") return setPending(o);
    log.mutate({ outcome: o });
  };
  const toggleObj = (o: Objection) => {
    const on = objs.includes(o);
    setObjs((x) => (on ? x.filter((y) => y !== o) : [...x, o]));
    if (!on) {
      setFocusObj(o);
      setVariant((v) => (v[o] ? v : { ...v, [o]: report.data?.picks[o] ?? 1 }));
    } else if (focusObj === o) setFocusObj(null);
    if (!dialAt) setDialAt(Date.now()); // an objection means someone picked up
  };
  const cycleVariant = (dir: 1 | -1) => {
    if (!focusObj) return;
    setVariant((v) => ({ ...v, [focusObj]: (((v[focusObj] ?? 1) - 1 + dir + VARIANTS) % VARIANTS) + 1 }));
  };
  const dial = () => {
    if (!dialAt) setDialAt(Date.now());
    const n = listId ? current?.phone : phone;
    if (n) window.location.href = `tel:${n}`;
  };
  const open = (channel: Channel, template?: TemplateKey) => {
    if (!followTarget) return;
    setComposer({ channel, template: template ?? after?.suggestion ?? (channel === "whatsapp" ? "thanks" : "calendly"), target: followTarget, sendKey: after?.sendKey });
  };
  const copyCalendly = async () => {
    const link = pb?.links.calendly;
    if (!link) return toast("Add your Calendly link in Settings › Workspace");
    try { await navigator.clipboard.writeText(link); toast("Calendly link copied"); } catch { toast(link); }
  };
  const skip = () => { if (current) { setSkipped((x) => [...x, current.accountId]); resetCall(); } };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (composer) setComposer(null); else if (pending) setPending(null); else if (focusObj) setFocusObj(null); else if (after) setAfter(null); return; }
      if (isTyping(e.target) || pending || composer || e.metaKey || e.ctrlKey || e.altKey) return;
      // Digits by physical key: works on AZERTY (no Shift needed) and QWERTY alike.
      const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2];
      if (digit && Number(digit) <= CALL_OUTCOMES.length) { e.preventDefault(); tap(CALL_OUTCOMES[Number(digit) - 1]); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { if (focusObj) { e.preventDefault(); cycleVariant(e.key === "ArrowRight" ? 1 : -1); } return; }
      const k = e.key.toLowerCase();
      const g = OBJECTION_GUIDE.find((x) => x.hotkey === k);
      if (g) { e.preventDefault(); toggleObj(g.key); return; }
      if (k === "enter") { e.preventDefault(); dial(); return; }
      if (k === "m") { e.preventDefault(); sendSuggested(); return; }
      if (k === "e") { e.preventDefault(); open("email"); return; }
      if (k === "p") { e.preventDefault(); open("email", "deck"); return; }
      if (k === "w") { e.preventDefault(); open("whatsapp"); return; }
      if (k === "c") { e.preventDefault(); void copyCalendly(); return; }
      if (k === "n" && listId) { e.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const s = summary.data?.stats;
  const done = listId && queue.isSuccess && !current;
  const vars = { business: liveTarget?.name, contact: liveTarget?.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: lang === "ES" ? pb?.links.deckES : pb?.links.deckFR };
  const opener = pb ? findItem(pb.items, "opener", "default", lang) : null;

  return (
    <div data-call-live className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold tracking-tight">Calling</h1><p className="num text-sm text-text-2">{fmt(sessionSec)} · {listId ? `${queue.data?.remaining ?? "…"} left in list` : "free dialling"}{s?.avgTalkSec ? ` · avg talk ${fmt(s.avgTalkSec)}` : ""}</p></div>
        <Button variant="outline" onClick={() => end.mutate()} disabled={end.isPending}>End session</Button>
      </div>
      <div className="grid grid-cols-5 gap-2" aria-live="polite">
        {([["Dials", s?.dials, "sales"], ["Picked up", s?.pickedUp, "sales"], ["Messages", summary.data?.messages, "sales"], ["Yes", s ? s.interested + s.callBacks : undefined, "win"], ["Meetings", s?.meetings, "ink"]] as const).map(([l, v, t]) => (
          <div key={l} className={cn("rounded-[12px] p-3 text-center", t === "ink" ? "bg-ink text-panel" : t === "win" ? "bg-win-soft" : "bg-sales-soft")}>
            <p className="num text-[26px] font-semibold leading-none">{v ?? 0}</p>
            <p className={cn("mt-1 text-[12px]", t === "ink" ? "text-panel/80" : "text-text-2")}>{l}</p>
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
                  {callSec !== null ? <span className="num rounded-full bg-sales-soft px-3 py-1 text-sm font-medium" aria-label="Call timer">{fmt(callSec)}</span> : null}
                  <Button variant="primary" size="lg" onClick={dial}><Phone /> <span className="num">{current.phone}</span><Kbd dark>↵</Kbd></Button>
                  <Button variant="ghost" size="lg" aria-label="Skip this number (N)" onClick={skip}><SkipForward /></Button>
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
              {opener && !dialAt ? <p className="rounded-[12px] border-l-4 border-sales bg-sales-soft p-3 text-[15px] leading-relaxed"><span className="mb-1 block text-[12px] font-medium text-text-2">Opener · {lang}</span>{fill(opener.body, vars)}</p> : null}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">Objections <span className="font-normal text-text-3">tick what you hear, any outcome</span></p>
                  <p className="text-[12px] text-text-3">Pause · Label · Ask · Next step</p>
                </div>
                <ObjectionGroup title="Brush-offs (reflex, test them)" items={BRUSH} objs={objs} focus={focusObj} onToggle={toggleObj} report={report.data} />
                <ObjectionGroup title="Real objections (explore them)" items={REAL} objs={objs} focus={focusObj} onToggle={toggleObj} report={report.data} />
                {focusObj && pb ? (
                  <ReplyCard objection={focusObj} lang={lang} variant={variant[focusObj] ?? 1} onCycle={cycleVariant} pb={pb} vars={vars} stats={report.data?.variants ?? []} best={report.data?.picks[focusObj] ?? null} />
                ) : null}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Outcome <span className="font-normal text-text-3">one tap = one call</span></p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CALL_OUTCOMES.map((o, i) => (
                    <button key={o} type="button" onClick={() => tap(o)} disabled={log.isPending || (Boolean(listId) && !current)}
                      className={cn("flex min-h-16 flex-col items-center justify-center rounded-[12px] border px-2 text-center text-[15px] font-medium transition-colors disabled:opacity-50",
                        o === "meeting" ? "border-win bg-win text-panel hover:opacity-90" : o === "interested" || o === "call_back" ? "border-win bg-win-soft hover:bg-win-soft/70" : "border-hairline bg-panel hover:bg-subtle",
                        pending === o && "ring-2 ring-ink ring-offset-2 ring-offset-panel", o === "meeting" && "col-span-2 sm:col-span-1")}>
                      {CALL_OUTCOME_LABELS[o]}
                      <span className={cn("text-[11px] font-normal", o === "meeting" ? "text-panel/80" : "text-text-3")}>key {i + 1}</span>
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
              <p className="text-sm font-medium">Messages</p>
              {gmail.data ? <span className="text-[12px] text-text-2">{gmail.data.connected ? <span className="text-win">● Gmail connected</span> : <a className="underline" href="/api/auth/google/gmail?back=/call">Connect Gmail</a>}</span> : null}
            </div>
            {after?.suggestion ? (
              <div className="flex flex-col gap-2 rounded-[12px] bg-sales-soft p-3">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <p>Next message for <b>{after.target.name || "the last call"}</b></p>
                  <button type="button" aria-label="Skip this message" onClick={() => setAfter(null)} className="text-text-3"><X className="size-4" /></button>
                </div>
                <button type="button" onClick={sendSuggested} disabled={quick.isPending}
                  className="flex min-h-12 items-center gap-3 rounded-[10px] bg-sales px-3 text-left text-[15px] font-medium text-panel transition-opacity hover:opacity-90 disabled:opacity-60 [&_svg]:size-4">
                  <Send /><span className="flex-1">{quick.isPending ? "Sending…" : `Send: ${EMAIL_TEMPLATE_LABELS[after.suggestion]}`}</span><Kbd dark>M</Kbd>
                </button>
                <p className="text-[12px] text-text-2">{gmail.data?.connected && after.target.email && after.target.accountId ? `Sends now by Gmail to ${after.target.email}.` : "Opens the message ready to send."}</p>
              </div>
            ) : <p className="text-[12px] text-text-3">After each call the right message is prepared: thank-you, Calendly, deck, confirmation, or “tried to reach you”. One key sends it.</p>}
            {([
              { label: "Email", key: "E", icon: <Mail />, run: () => open("email") },
              { label: "Send the deck", key: "P", icon: <Presentation />, run: () => open("email", "deck") },
              { label: "WhatsApp", key: "W", icon: <MessageCircle />, run: () => open("whatsapp") },
            ]).map((a) => (
              <button key={a.key} type="button" disabled={!followTarget} onClick={a.run}
                className="flex min-h-11 items-center gap-3 rounded-[12px] border border-control bg-panel px-3 text-left text-[15px] font-medium transition-colors hover:bg-subtle disabled:opacity-50 [&_svg]:size-4">
                {a.icon}<span className="flex-1">{a.label}</span><Kbd>{a.key}</Kbd>
              </button>
            ))}
            <button type="button" onClick={() => void copyCalendly()} className="flex min-h-10 items-center gap-3 rounded-[12px] px-3 text-left text-sm text-text-2 hover:bg-subtle [&_svg]:size-4"><Copy /><span className="flex-1">Copy my Calendly link</span><Kbd>C</Kbd></button>
          </Panel>
          {composer && pb ? (
            <FollowUpComposer key={`${composer.channel}-${composer.template}-${composer.target.accountId}-${composer.target.name}`} channel={composer.channel} template={composer.template} target={composer.target} playbook={pb} gmailConnected={Boolean(gmail.data?.connected)} sessionId={id} sendKey={composer.sendKey}
              onClose={() => setComposer(null)} onSent={() => { setComposer(null); setAfter(null); }} />
          ) : null}
        </div>
      </div>
      <p className="text-[12px] text-text-3"><Kbd>↵</Kbd> dial · <Kbd>1</Kbd>–<Kbd>7</Kbd> outcome · <Kbd>A</Kbd>…<Kbd>T</Kbd> objections · <Kbd>←</Kbd><Kbd>→</Kbd> other reply · <Kbd>M</Kbd> send suggested message · <Kbd>E</Kbd> email · <Kbd>P</Kbd> deck · <Kbd>W</Kbd> WhatsApp · <Kbd>C</Kbd> copy link · <Kbd>N</Kbd> skip · <Kbd>Esc</Kbd> close. Opening a link never counts as sent: only your confirmation does.</p>
    </div>
  );
}
const isYes = (o: CallOutcome) => o === "meeting" || o === "interested" || o === "call_back";

function ObjectionGroup({ title, items, objs, focus, onToggle, report }: { title: string; items: typeof OBJECTION_GUIDE; objs: Objection[]; focus: Objection | null; onToggle: (o: Objection) => void; report?: ObjectionReport }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-text-3">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((g) => {
          const on = objs.includes(g.key);
          const r = report?.team.find((x) => x.key === g.key);
          return (
            <button key={g.key} type="button" aria-pressed={on} onClick={() => onToggle(g.key)} title={g.meaning}
              className={cn("flex min-h-11 items-center justify-between gap-2 rounded-[10px] border px-3 text-left text-sm transition-colors",
                on ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle", focus === g.key && "ring-2 ring-sales ring-offset-1 ring-offset-panel")}>
              <span className="min-w-0">{OBJECTION_LABELS[g.key]}{r && r.count >= 3 && r.wonRate !== null ? <span className={cn("block text-[11px]", on ? "text-panel/70" : "text-text-3")}>{Math.round(r.wonRate * 100)}% won over</span> : null}</span>
              <Kbd dark={on}>{g.hotkey.toUpperCase()}</Kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The live reply: what the objection usually means, a short pause cue, then Label / Ask / Next step. */
function ReplyCard({ objection, lang, variant, onCycle, pb, vars, stats, best }: { objection: Objection; lang: Lang; variant: number; onCycle: (d: 1 | -1) => void; pb: Playbook; vars: Record<string, string | undefined>; stats: VariantStat[]; best: number | null }) {
  const g = guideOf(objection);
  const item = findItem(pb.items, "objection", `${objection}#${variant}`, lang);
  const st = stats.find((x) => x.reply === `${objection}#${variant}`);
  const steps = item ? replySteps(fill(item.body, vars)) : [];
  return (
    <div key={`${objection}-${variant}`} className="overflow-hidden rounded-[14px] border border-ink" aria-live="polite">
      <div className="h-1 origin-left animate-[vos-pause_2s_linear_forwards] bg-sales" aria-hidden />
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{OBJECTION_LABELS[objection]} <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium", g?.type === "brush_off" ? "bg-subtle text-text-2" : "bg-mkt-soft text-mkt")}>{g ? OBJECTION_TYPE_LABEL[g.type] : ""}</span></p>
          <div className="flex items-center gap-1 text-[12px] text-text-2">
            <button type="button" aria-label="Previous reply" onClick={() => onCycle(-1)} className="rounded p-1 hover:bg-subtle"><ChevronLeft className="size-4" /></button>
            <span className="num">Reply {variant}/{VARIANTS}{best === variant ? " · best" : ""}{st ? ` · ${st.won}/${st.uses} won` : ""}</span>
            <button type="button" aria-label="Next reply" onClick={() => onCycle(1)} className="rounded p-1 hover:bg-subtle"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        {g ? <p className="text-[13px] text-text-2">{g.meaning}</p> : null}
        <ol className="flex flex-col gap-2">
          {steps.map((line, i) => (
            <li key={i} className="grid grid-cols-[5.5rem_1fr] gap-2 text-[15px] leading-snug">
              <span className={cn("pt-0.5 text-[11px] font-semibold uppercase tracking-wide", STEP_TONE[i] ?? "text-text-3")}>{REPLY_STEPS[i] ?? ""}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Kbd({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <kbd className={cn("inline-flex min-w-5 items-center justify-center rounded-[5px] border px-1 font-sans text-[11px] font-medium leading-4", dark ? "border-panel/40 text-panel/80" : "border-hairline bg-panel text-text-3")}>{children}</kbd>;
}

function YesDetails({ outcome, needsName, busy, onCancel, onSave }: { outcome: CallOutcome; needsName: boolean; busy: boolean; onCancel: () => void; onSave: (b: Record<string, string>) => void }) {
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = React.useState(outcome === "meeting" ? addDays(today, 3) : outcome === "interested" ? addDays(today, 1) : addDays(today, 2));
  const [business, setBusiness] = React.useState("");
  const [contact, setContact] = React.useState("");
  return (
    <form className="flex flex-col gap-3 rounded-[12px] bg-win-soft p-3" onSubmit={(e) => { e.preventDefault(); onSave({ follow_up_date: date, business_name: business, contact_name: contact }); }}>
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
 * Prepares a message from the playbook in the prospect's language. Gmail sends directly (send-only grant);
 * the mail app and WhatsApp open prefilled and only count once the founder confirms it was sent.
 */
export function FollowUpComposer({ channel, template, target, playbook, gmailConnected, sessionId, sendKey, onClose, onSent }: { channel: Channel; template: TemplateKey; target: Target; playbook: Playbook; gmailConnected: boolean; sessionId?: string; sendKey?: string; onClose: () => void; onSent?: () => void }) {
  const qc = useQueryClient();
  const [ch, setCh] = React.useState<Channel>(channel);
  const isWa = ch === "whatsapp";
  const [lang, setLang] = React.useState<Lang>(target.market);
  const [tpl, setTpl] = React.useState<TemplateKey>(template);
  const [to, setTo] = React.useState(isWa ? target.phone : target.email);
  const [business, setBusiness] = React.useState(target.name);
  const [idem] = React.useState(() => sendKey ?? crypto.randomUUID());
  const [opened, setOpened] = React.useState(false);
  const varsFor = (l: Lang) => ({ business, contact: target.contact, founder: playbook.founderName, calendly: playbook.links.calendly, deck: l === "ES" ? playbook.links.deckES : playbook.links.deckFR });
  const textFor = (c: Channel, t: TemplateKey, l: Lang) => {
    const it = findItem(playbook.items, c === "whatsapp" ? "whatsapp" : "email", t, l);
    return { subject: fill(it?.subject ?? "", varsFor(l)), body: fill(it?.body ?? "", varsFor(l)) };
  };
  const [subject, setSubject] = React.useState(() => textFor(ch, tpl, lang).subject);
  const [body, setBody] = React.useState(() => textFor(ch, tpl, lang).body);
  const reload = (c: Channel, t: TemplateKey, l: Lang) => { const x = textFor(c, t, l); setSubject(x.subject); setBody(x.body); };
  const cold = COLD_TEMPLATES.includes(tpl);
  const payload = (via: "gmail" | "mail_app" | "whatsapp", checkOnly = false) => ({
    idempotency_key: idem, channel: ch, via, context: cold ? "cold" : "after_call", account_id: target.accountId, call_session_id: sessionId ?? "", to: to.trim(), subject, body,
    template_key: tpl, language: lang, market: target.market, business_name: target.accountId ? "" : business.trim(), contact_name: target.contact, check_only: checkOnly,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ["call-summary"] }); qc.invalidateQueries({ queryKey: ["my-day"] }); qc.invalidateQueries({ queryKey: ["email-sends"] }); qc.invalidateQueries({ queryKey: ["email-queue"] }); (onSent ?? onClose)(); };
  const send = useMutation({
    mutationFn: (via: "gmail" | "mail_app" | "whatsapp") => api("/api/email/send", { body: payload(via) }),
    onSuccess: () => { toast(isWa ? "WhatsApp logged" : "Email sent and logged"); done(); },
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
        <p className="text-sm font-medium">{target.name || "New message"}</p>
        <Button size="icon" variant="ghost" aria-label="Close (Esc)" onClick={onClose}><X /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <SegmentedSwitch size="sm" label="Channel" value={ch} onChange={(c) => { setCh(c); setTo(c === "whatsapp" ? target.phone : target.email); reload(c, tpl, lang); setOpened(false); }} options={[{ value: "email", label: "Email" }, { value: "whatsapp", label: "WhatsApp" }]} />
        <SegmentedSwitch size="sm" label="Language" value={lang} onChange={(l) => { setLang(l); reload(ch, tpl, l); }} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
      </div>
      <Select aria-label="Template" value={tpl} onChange={(e) => { const t = e.target.value as TemplateKey; setTpl(t); reload(ch, t, lang); }}>
        {TEMPLATES.map((t) => <option key={t} value={t}>{EMAIL_TEMPLATE_LABELS[t]}</option>)}
      </Select>
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
      {lang === "ES" && cold ? <p className="text-[12px] text-text-3">Spain: a message to someone you have not talked to needs prior consent (LSSI art. 21).</p> : null}
    </Panel>
  );
}
