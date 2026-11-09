"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, Mail, MessageCircle, Phone, Send, SkipForward, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Field, Input, Panel, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useT } from "@/i18n/react";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome, type CallStats } from "@/domain/calls";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { OBJECTION_GUIDE, VARIANTS, guideOf, replySteps, type VariantStat } from "@/domain/objections";
import {
  COLD_TEMPLATES, EMAIL_TEMPLATE_LABELS, TEMPLATES, fill, findItem, hasMissingLink, mailtoLink, suggestedFollowUp, whatsappLink,
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

export function ActiveSession({ id, listId, onEnd }: { id: string; listId: string; onEnd: () => void }) {
  const t = useT();
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
      toast(r.opportunityId ? t("{outcome}: added to your pipeline", { outcome: t(CALL_OUTCOME_LABELS[o]) }) : t(CALL_OUTCOME_LABELS[o]));
      let suggestion = suggestedFollowUp(o, objs);
      if (!listId && !isYes(o)) suggestion = null; // free-dial refusal: the number is not kept (D030)
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
    onError: (e) => toast(e instanceof ApiError && e.isBlocked ? e.message : t("Error: {message}. Tap again to retry (it won't count twice).", { message: (e as Error).message })),
  });
  // One key sends the suggested message: straight through Gmail when connected and an address is known.
  const quick = useMutation({
    mutationFn: (a: NonNullable<typeof after>) => {
      const it = pb ? findItem(pb.items, "email", a.suggestion!, a.target.market) : null;
      const v = { business: a.target.name, contact: a.target.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: a.target.market === "ES" ? pb?.links.deckES : pb?.links.deckFR };
      return api("/api/email/send", { body: { idempotency_key: a.sendKey, channel: "email", via: "gmail", account_id: a.target.accountId, call_session_id: id, to: a.target.email, subject: fill(it?.subject ?? "", v), body: fill(it?.body ?? "", v), template_key: a.suggestion, language: a.target.market, market: a.target.market } });
    },
    onSuccess: (_r, a) => { toast(t("Email sent to {name}", { name: a.target.name || a.target.email })); setAfter(null); qc.invalidateQueries({ queryKey: ["call-summary", id] }); qc.invalidateQueries({ queryKey: ["email-queue"] }); },
    onError: (e, a) => {
      if (e instanceof ApiError && e.body.error === "consent_required") toast(t("Connect Gmail first"));
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
    if (!link) return toast(t("Add your Calendly link in Settings › Workspace"));
    try { await navigator.clipboard.writeText(link); toast(t("Calendly link copied")); } catch { toast(link); }
  };
  const skip = () => { if (current) { setSkipped((x) => [...x, current.accountId]); resetCall(); } };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (composer) return; // the dialog handles its own keys (Esc closes it)
      if (e.key === "Escape") { if (pending) setPending(null); else if (focusObj) setFocusObj(null); else if (after) setAfter(null); return; }
      if (isTyping(e.target) || pending || e.metaKey || e.ctrlKey || e.altKey) return;
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
  const counts: [string, number | undefined][] = [["Dials", s?.dials], ["Picked up", s?.pickedUp], ["Yes", s ? s.interested + s.callBacks : undefined], ["Meetings", s?.meetings], ["Messages", summary.data?.messages]];

  return (
    <div data-call-live className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("Calling")}</h1>
          <p className="num text-sm text-text-2" aria-live="polite">{fmt(sessionSec)} · {listId ? t("{n} left in list", { n: queue.data?.remaining ?? "…" }) : t("free dialling")}</p>
        </div>
        <Button variant="outline" onClick={() => end.mutate()} disabled={end.isPending}>{t("End session")}</Button>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label={t("Session counts")}>
        {counts.map(([l, v]) => <div key={l} className="flex items-baseline gap-1.5"><dt className="text-text-2">{t(l)}</dt><dd className="num text-lg font-semibold">{v ?? 0}</dd></div>)}
      </dl>

      <Panel className="flex flex-col gap-5">
        {listId ? (
          queue.isPending ? <Skeleton className="h-20" /> : done ? (
            <EmptyState title={t("List finished")} action={<Button variant="primary" size="sm" onClick={() => end.mutate()}>{t("See the session summary")}</Button>}>{t("Everyone in this list has been called today.")}</EmptyState>
          ) : current ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-text-2">{t(current.why)}{current.niche ? ` · ${current.niche}` : ""}{current.city ? ` · ${current.city}` : ""} · {lang}</p>
                <p className="truncate text-2xl font-semibold tracking-tight">{current.name}</p>
                {current.contactName ? <p className="text-sm text-text-2">{t("Ask for {name}", { name: current.contactName })}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                {callSec !== null ? <span className="num text-sm text-text-2" aria-label={t("Call timer")}>{fmt(callSec)}</span> : null}
                <Button variant="primary" size="lg" onClick={dial}><Phone /> <span className="num">{current.phone}</span></Button>
                <Button variant="ghost" size="lg" aria-label={t("Skip this number (N)")} onClick={skip}><SkipForward /></Button>
              </div>
            </div>
          ) : null
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("Number (optional, never stored for a refusal)")} htmlFor="cm-phone" className="min-w-56 flex-1"><Input id="cm-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33…" className="num h-12 text-lg" /></Field>
            <SegmentedSwitch label={t("Country")} value={market} onChange={setMarket} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
            <Button variant="primary" size="lg" onClick={dial}><Phone /> {callSec !== null ? <span className="num">{fmt(callSec)}</span> : t("Dial")}</Button>
          </div>
        )}

        {!done ? (
          <>
            {opener ? (
              <details className="group text-[15px] leading-relaxed" open={!dialAt}>
                <summary className="cursor-pointer text-sm text-text-2">{t("Opener")}</summary>
                <p className="mt-1">{fill(opener.body, vars)}</p>
              </details>
            ) : null}
            <div>
              <p className="mb-2 text-sm text-text-2">{t("Objections heard")}</p>
              <div className="flex flex-wrap gap-1.5">
                {OBJECTION_GUIDE.map((g) => {
                  const on = objs.includes(g.key);
                  return (
                    <button key={g.key} type="button" aria-pressed={on} onClick={() => toggleObj(g.key)} title={t(g.meaning)}
                      className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors", on ? "border-ink bg-ink text-panel" : "border-hairline bg-panel hover:border-control")}>
                      {t(OBJECTION_LABELS[g.key])}<span className={cn("text-[10px] uppercase", on ? "text-panel/60" : "text-text-3")}>{g.hotkey}</span>
                    </button>
                  );
                })}
              </div>
              {focusObj && pb ? <ReplyCard objection={focusObj} lang={lang} variant={variant[focusObj] ?? 1} onCycle={cycleVariant} pb={pb} vars={vars} stats={report.data?.variants ?? []} best={report.data?.picks[focusObj] ?? null} onClose={() => setFocusObj(null)} /> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CALL_OUTCOMES.map((o, i) => (
                <button key={o} type="button" onClick={() => tap(o)} disabled={log.isPending || (Boolean(listId) && !current)}
                  className={cn("flex min-h-14 flex-col items-center justify-center rounded-[12px] border px-2 text-center text-[15px] font-medium transition-colors disabled:opacity-50",
                    o === "meeting" ? "border-ink bg-ink text-panel hover:bg-accent-hover" : o === "interested" || o === "call_back" ? "border-ink bg-panel hover:bg-subtle" : "border-hairline bg-panel hover:bg-subtle",
                    pending === o && "ring-2 ring-ink ring-offset-2 ring-offset-panel", o === "meeting" && "col-span-2 sm:col-span-1")}>
                  {t(CALL_OUTCOME_LABELS[o])}
                  <span className={cn("text-[11px] font-normal", o === "meeting" ? "text-panel/70" : "text-text-3")}>{i + 1}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {pending ? <YesDetails key={pending} outcome={pending} needsName={!listId} busy={log.isPending} onCancel={() => setPending(null)} onSave={(b) => log.mutate({ outcome: pending, ...b })} /> : null}
      </Panel>

      {after?.suggestion ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-hairline bg-panel px-4 py-3" aria-live="polite">
          <p className="min-w-0 flex-1 text-sm"><span className="text-text-2">{t("Message for {name}", { name: after.target.name || t("the last call") })}: </span><b className="font-medium">{t(EMAIL_TEMPLATE_LABELS[after.suggestion])}</b></p>
          <Button size="sm" variant="primary" disabled={quick.isPending} onClick={sendSuggested}><Send /> {quick.isPending ? t("Sending…") : t("Send")} <span className="text-[11px] opacity-70">M</span></Button>
          <Button size="sm" variant="ghost" onClick={() => open("email")}><Mail /> {t("Email")}</Button>
          <Button size="sm" variant="ghost" onClick={() => open("whatsapp")}><MessageCircle /> WhatsApp</Button>
          <Button size="icon" variant="ghost" aria-label={t("Skip this message")} onClick={() => setAfter(null)}><X /></Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-3">
        {gmail.data && !gmail.data.connected ? <a className="underline" href="/api/auth/google/gmail?back=/call">{t("Connect Gmail")}</a> : gmail.data?.connected ? <span>{t("Gmail connected")}</span> : null}
        <button type="button" className="underline" onClick={() => open("email", "deck")}>{t("Send the deck")} (P)</button>
        <button type="button" className="underline" onClick={() => void copyCalendly()}>{t("Copy my Calendly link")} (C)</button>
        <details className="relative">
          <summary className="cursor-pointer underline">{t("Keyboard shortcuts")}</summary>
          <p className="mt-1 max-w-xl">{t("Enter dial · 1–7 outcome · letters objections · ← → other reply · M send the message · E email · W WhatsApp · P deck · C copy link · N skip · Esc close")}</p>
        </details>
      </div>

      <Modal open={Boolean(composer && pb)} onOpenChange={(o) => { if (!o) setComposer(null); }} title={composer ? (composer.target.name || t("New message")) : ""}>
        {composer && pb ? (
          <FollowUpComposer key={`${composer.channel}-${composer.template}-${composer.target.accountId}-${composer.target.name}`} channel={composer.channel} template={composer.template} target={composer.target} playbook={pb} gmailConnected={Boolean(gmail.data?.connected)} sessionId={id} sendKey={composer.sendKey}
            onClose={() => setComposer(null)} onSent={() => { setComposer(null); setAfter(null); }} />
        ) : null}
      </Modal>
    </div>
  );
}
const isYes = (o: CallOutcome) => o === "meeting" || o === "interested" || o === "call_back";

/** The live reply in three short lines; ← → switches to the other variant. */
function ReplyCard({ objection, lang, variant, onCycle, pb, vars, stats, best, onClose }: { objection: Objection; lang: Lang; variant: number; onCycle: (d: 1 | -1) => void; pb: Playbook; vars: Record<string, string | undefined>; stats: VariantStat[]; best: number | null; onClose: () => void }) {
  const t = useT();
  const item = findItem(pb.items, "objection", `${objection}#${variant}`, lang);
  const st = stats.find((x) => x.reply === `${objection}#${variant}`);
  const steps = item ? replySteps(fill(item.body, vars)) : [];
  const g = guideOf(objection);
  return (
    <div className="mt-3 rounded-[14px] bg-subtle/60 p-3" aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-text-2">
        <span>{t(OBJECTION_LABELS[objection])}{g?.type === "brush_off" ? ` · ${t("brush-off: test it")}` : ""}</span>
        <span className="flex items-center gap-1">
          <button type="button" aria-label={t("Previous reply")} onClick={() => onCycle(-1)} className="rounded p-1 hover:bg-panel"><ChevronLeft className="size-4" /></button>
          <span className="num">{variant}/{VARIANTS}{best === variant ? ` · ${t("best")}` : ""}{st ? ` · ${st.won}/${st.uses}` : ""}</span>
          <button type="button" aria-label={t("Next reply")} onClick={() => onCycle(1)} className="rounded p-1 hover:bg-panel"><ChevronRight className="size-4" /></button>
          <button type="button" aria-label={t("Close")} onClick={onClose} className="rounded p-1 hover:bg-panel"><X className="size-4" /></button>
        </span>
      </div>
      <ol className="flex flex-col gap-1.5 text-[15px] leading-snug">
        {steps.map((line, i) => <li key={i} className={cn(i === 2 && "font-medium")}>{line}</li>)}
      </ol>
    </div>
  );
}

function YesDetails({ outcome, needsName, busy, onCancel, onSave }: { outcome: CallOutcome; needsName: boolean; busy: boolean; onCancel: () => void; onSave: (b: Record<string, string>) => void }) {
  const t = useT();
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = React.useState(outcome === "meeting" ? addDays(today, 3) : outcome === "interested" ? addDays(today, 1) : addDays(today, 2));
  const [business, setBusiness] = React.useState("");
  const [contact, setContact] = React.useState("");
  return (
    <form className="flex flex-col gap-3 rounded-[12px] bg-subtle/60 p-3" onSubmit={(e) => { e.preventDefault(); onSave({ follow_up_date: date, business_name: business, contact_name: contact }); }}>
      <p className="text-sm font-medium">{outcome === "meeting" ? t("Meeting date") : t("When to call back")}</p>
      <div className="flex flex-wrap gap-2">
        {[["Today", 0], ["Tomorrow", 1], ["In 2 days", 2], ["Next week", 7]].map(([l, d]) => { const v = addDays(today, d as number); return <button key={String(l)} type="button" aria-pressed={date === v} onClick={() => setDate(v)} className={cn("min-h-10 rounded-full border px-3 text-sm", date === v ? "border-ink bg-ink text-panel" : "border-control bg-panel")}>{t(String(l))}</button>; })}
        <Input aria-label={t("Date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-40" />
      </div>
      {needsName ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input aria-label={t("Business name")} required autoFocus placeholder={t("Business name (required)")} value={business} onChange={(e) => setBusiness(e.target.value)} />
          <Input aria-label={t("Contact name")} placeholder={t("Who you spoke to (optional)")} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" autoFocus={!needsName} disabled={busy || (needsName && !business.trim())}>{busy ? t("Saving…") : t("Save · {outcome}", { outcome: t(CALL_OUTCOME_LABELS[outcome]) })}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}

/**
 * Prepares a message from the playbook in the prospect's language. Gmail sends directly (send-only grant);
 * the mail app and WhatsApp open prefilled and only count once the founder confirms it was sent.
 */
export function FollowUpComposer({ channel, template, target, playbook, gmailConnected, sessionId, sendKey, onClose, onSent }: { channel: Channel; template: TemplateKey; target: Target; playbook: Playbook; gmailConnected: boolean; sessionId?: string; sendKey?: string; onClose: () => void; onSent?: () => void }) {
  const t = useT();
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
    onSuccess: () => { toast(isWa ? t("WhatsApp logged") : t("Email sent and logged")); done(); },
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
    <div className="flex flex-col gap-3" aria-label={t("Follow-up composer")}>
      <div className="flex flex-wrap gap-2">
        <SegmentedSwitch size="sm" label={t("Channel")} value={ch} onChange={(c) => { setCh(c); setTo(c === "whatsapp" ? target.phone : target.email); reload(c, tpl, lang); setOpened(false); }} options={[{ value: "email", label: t("Email") }, { value: "whatsapp", label: "WhatsApp" }]} />
        <SegmentedSwitch size="sm" label={t("Language")} value={lang} onChange={(l) => { setLang(l); reload(ch, tpl, l); }} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
      </div>
      <Select aria-label={t("Template")} value={tpl} onChange={(e) => { const k = e.target.value as TemplateKey; setTpl(k); reload(ch, k, lang); }}>
        {TEMPLATES.map((k) => <option key={k} value={k}>{t(EMAIL_TEMPLATE_LABELS[k])}</option>)}
      </Select>
      {!target.accountId ? <Input aria-label={t("Business name")} placeholder={t("Business name (required to follow up)")} value={business} onChange={(e) => setBusiness(e.target.value)} /> : null}
      <Input aria-label={isWa ? t("WhatsApp number") : t("To")} type={isWa ? "tel" : "email"} placeholder={isWa ? "+34…" : "contact@business.example.com"} value={to} onChange={(e) => setTo(e.target.value)} />
      {!isWa ? <Input aria-label={t("Subject")} value={subject} onChange={(e) => setSubject(e.target.value)} /> : null}
      <Textarea aria-label={t("Message")} rows={isWa ? 4 : 8} value={body} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) { e.preventDefault(); if (!isWa && gmailConnected) send.mutate("gmail"); } }} />
      {missing ? <p className="text-[12px] text-bad">{t("A link is missing. Add it in Settings › Workspace.")}</p> : null}
      {consent ? <p className="text-sm">{t("Connect your Gmail first (send only, Valemont OS never reads your inbox).")} <a className="font-medium underline" href="/api/auth/google/gmail?back=/call">{t("Connect Gmail")}</a></p> : err ? <p className="text-sm text-bad" role="alert">{(err as Error).message}</p> : null}
      {opened ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-subtle p-2">
          <p className="flex-1 text-sm">{t("Did you send it?")}</p>
          <Button size="sm" variant="primary" disabled={send.isPending} onClick={() => send.mutate(isWa ? "whatsapp" : "mail_app")}>{t("Yes, sent")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpened(false)}>{t("Not sent")}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {isWa ? <Button variant="primary" disabled={blocked || check.isPending} onClick={() => check.mutate("whatsapp")}><MessageCircle /> {t("Open WhatsApp")}</Button> : (
            <>
              {gmailConnected ? <Button variant="primary" disabled={blocked || send.isPending} onClick={() => send.mutate("gmail")}><Mail /> {send.isPending ? t("Sending…") : t("Send with Gmail")}</Button> : null}
              <Button variant={gmailConnected ? "outline" : "primary"} disabled={blocked || check.isPending} onClick={() => check.mutate("mail_app")}>{t("Open in mail app")}</Button>
            </>
          )}
          <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(isWa ? body : `${subject}\n\n${body}`); toast(t("Copied")); } catch { /* clipboard blocked */ } }}><Copy /> {t("Copy")}</Button>
        </div>
      )}
      {lang === "ES" && cold ? <p className="text-[12px] text-text-3">{t("Spain: a message to someone you have not talked to needs prior consent (LSSI art. 21).")}</p> : null}
    </div>
  );
}
