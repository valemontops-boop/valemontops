"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MoreHorizontal, Pause, Phone, PhoneOff, Play, RotateCcw, SkipForward, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Panel, Skeleton } from "@/components/ui/form";
import { useLocale, useT } from "@/i18n/react";
import { ConfirmSent, ConnectGmail, MessageCard, useInstantSend, type Playbook, type SendTarget } from "./instant-send";
import { CallLog } from "./call-log";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome, type CallStats } from "@/domain/calls";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { OBJECTION_GUIDE, VARIANTS, guideOf, replySteps, type VariantStat } from "@/domain/objections";
import { fill, findItem, type Lang, type TemplateKey } from "@/domain/playbook";
import { templateChips } from "@/domain/messages";
import { addDays } from "@/domain/time";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type { Playbook };
type QueueItem = { accountId: string; name: string; phone: string; city: string; niche: string; country: "FR" | "ES" | null; why: string; contactName: string; email: string };
type Summary = { session: { id: string; started_at: string; ended_at: string | null; list_id: string }; stats: CallStats; messages: number };
type ObjCount = { key: string; count: number; won: number; wonRate: number | null };
export type ObjectionReport = { days: number; team: ObjCount[]; mine?: ObjCount[]; variants: VariantStat[]; picks: Record<string, number>; heard: number; brushOffShare: number | null; byMarket: { key: string; total: number; top: { key: string; count: number }[] }[]; byNiche: { key: string; total: number; top: { key: string; count: number }[] }[] };
/** Who a message goes to: the person on the line, or the one just called. */
export type Target = SendTarget;
type MyDayLite = { tally: { calls: number }; targets: Record<string, { target: number }> | null };

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
const isYes = (o: CallOutcome) => o === "meeting" || o === "interested" || o === "call_back";
/** Objection chips shown first during a call: the founder's most frequent (then the team's), the rest behind "Others". */
export const TOP_OBJECTIONS = 6;
export function objectionOrder(mine: ObjCount[] | undefined, team: ObjCount[] | undefined): Objection[] {
  const n = (k: string) => (mine?.find((x) => x.key === k)?.count ?? 0) * 1000 + (team?.find((x) => x.key === k)?.count ?? 0);
  return OBJECTION_GUIDE.map((g, i) => ({ k: g.key, s: n(g.key), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.k);
}
const UNDO_SECONDS = 10;

/**
 * The live call screen, as three clear states (round 8):
 * Before: who, why, the opener line, one big "Call" (Enter). During: timer, the reply card and the objection chips
 * (the six most frequent first), Hang up (X). After: only the outcome buttons (1–7), then the message card, then the
 * next prospect, with "Undo" for 10 seconds. Rare actions live in the "…" menu.
 */
export function ActiveSession({ id, listId, onEnd }: { id: string; listId: string; onEnd: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  // Idempotent: makes sure the server knows this session (after a reload or a server restart it may not).
  const ensured = useQuery({ queryKey: ["call-session-ensure", id], queryFn: () => api("/api/calls/sessions", { body: { id, list_id: listId } }), staleTime: Infinity, retry: 3 });
  const summary = useQuery({ queryKey: ["call-summary", id], queryFn: () => api<Summary>(`/api/calls/summary?id=${id}`), enabled: ensured.isSuccess });
  const queue = useQuery({ queryKey: ["call-queue", listId], queryFn: () => api<{ remaining: number; queue: QueueItem[] }>(`/api/calls/queue?list_id=${listId}`), enabled: Boolean(listId) });
  const playbook = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const report = useQuery({ queryKey: ["call-objections"], queryFn: () => api<ObjectionReport>("/api/calls/objections") });
  const day = useQuery({ queryKey: ["my-day"], queryFn: () => api<MyDayLite>("/api/my-day") });
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const current = queue.data?.queue.find((q) => !skipped.includes(q.accountId)) ?? null;
  const [phone, setPhone] = React.useState("");
  const [objs, setObjs] = React.useState<Objection[]>([]);
  const [focusObj, setFocusObj] = React.useState<Objection | null>(null);
  const [variant, setVariant] = React.useState<Record<string, number>>({});
  const [showAll, setShowAll] = React.useState(false);
  const [dialAt, setDialAt] = React.useState<number | null>(null);
  const [endAt, setEndAt] = React.useState<number | null>(null); // "Hang up": the call is over, the outcome is next
  const [pending, setPending] = React.useState<CallOutcome | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID()); // one idempotency key per call, reused on retry
  const [after, setAfter] = React.useState<{ target: Target; outcome: CallOutcome | null; objections: Objection[]; sendKey: string; template?: TemplateKey; needsBusiness?: boolean } | null>(null);
  const [undoRaw, setUndo] = React.useState<{ key: string; outcome: CallOutcome; name: string; until: number } | null>(null);
  const [paused, setPaused] = React.useState<{ since: number } | null>(null);
  const [pausedMs, setPausedMs] = React.useState(0);
  const now = useNow();
  const undo = undoRaw && now <= undoRaw.until ? undoRaw : null; // "Undo" lasts 10 seconds
  const sessionSec = summary.data ? Math.max(0, Math.floor((now - Date.parse(summary.data.session.started_at) - pausedMs - (paused ? now - paused.since : 0)) / 1000)) : 0;
  const callSec = dialAt ? Math.max(0, Math.floor(((endAt ?? now) - dialAt) / 1000)) : null;
  // Scripts and messages are in the founder's own language (Théo FR, Pablo ES); the market only drives consent rules.
  const locale = useLocale();
  const lang: Lang = locale === "es" ? "ES" : "FR";
  const market: Lang = lang; // free dialling: Théo calls France, Pablo calls Spain
  const liveTarget: Target | null = listId
    ? current ? { accountId: current.accountId, name: current.name, contact: current.contactName, email: current.email, phone: current.phone, market: current.country ?? "FR" } : null
    : { accountId: "", name: "", contact: "", email: "", phone, market };
  const pb = playbook.data;
  const resetCall = () => { setObjs([]); setFocusObj(null); setVariant({}); setDialAt(null); setEndAt(null); setShowAll(false); };
  const hangUp = () => { if (dialAt && !endAt) setEndAt(Date.now()); else if (!dialAt) { setDialAt(Date.now()); setEndAt(Date.now()); } setFocusObj(null); };
  const instant = useInstantSend(id);
  const phase: "before" | "during" | "after" | "message" = after ? "message" : pending || endAt ? "after" : dialAt ? "during" : "before";

  const end = useMutation({ mutationFn: () => api("/api/calls/sessions", { method: "PATCH", body: { id } }), onSuccess: () => { qc.invalidateQueries(); onEnd(); } });
  const refresh = () => ["call-summary", "call-queue", "call-objections", "call-log", "my-day", "email-queue"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const log = useMutation({
    mutationKey: ["log-activity"],
    mutationFn: (b: Record<string, unknown>) => api<{ duplicate: boolean; opportunityId: string | null; event: { account_id: string } }>("/api/calls", {
      body: { idempotency_key: key, session_id: id, list_id: listId, account_id: current?.accountId ?? "", phone: listId ? "" : phone, market: listId ? current?.country ?? null : market, objections: objs, replies: objs.map((o) => `${o}#${variant[o] ?? 1}`), duration_sec: callSec, ...b },
    }),
    onSuccess: (r, b) => {
      const o = b.outcome as CallOutcome;
      toast(r.opportunityId ? t("{outcome}: added to your pipeline", { outcome: t(CALL_OUTCOME_LABELS[o]) }) : t(CALL_OUTCOME_LABELS[o]));
      const target = liveTarget ? { ...liveTarget, accountId: r.event?.account_id || liveTarget.accountId, name: (b.business_name as string) || liveTarget.name, contact: (b.contact_name as string) || liveTarget.contact } : null;
      const { suggested } = templateChips(o, objs, target?.market ?? market);
      // Free-dial refusal: the number is not kept, so no message (D030). Gatekeepers get nothing.
      const message = target && suggested && (listId || isYes(o));
      setAfter(message ? { target: target!, outcome: o, objections: objs, sendKey: crypto.randomUUID() } : null);
      setUndo({ key, outcome: o, name: target?.name || target?.phone || "", until: Date.now() + UNDO_SECONDS * 1000 });
      setPending(null); setPhone(""); resetCall(); setKey(crypto.randomUUID());
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError && e.isBlocked ? e.message : t("Error: {message}. Tap again to retry (it won't count twice).", { message: (e as Error).message.replace(/[.\s]+$/, "") })),
  });
  const undoLast = useMutation({
    mutationFn: (k: string) => api("/api/calls/undo", { body: { idempotency_key: k } }),
    onSuccess: () => { toast(t("Undone: the call no longer counts.")); setUndo(null); setAfter(null); refresh(); qc.invalidateQueries({ queryKey: ["crm"] }); },
    onError: (e) => toast((e as Error).message),
  });

  const tap = (o: CallOutcome) => {
    if (log.isPending || (listId && !current)) return;
    if (dialAt && !endAt) setEndAt(Date.now());
    if (isYes(o)) return setPending(o);
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
    if (listId && !current) return;
    if (!dialAt) setDialAt(Date.now());
    const n = listId ? current?.phone : phone;
    if (n) window.location.href = `tel:${n}`;
  };
  const openMessage = (template: TemplateKey) => {
    const target = after?.target ?? liveTarget;
    if (!target) return;
    setAfter({ target, outcome: after?.outcome ?? null, objections: after?.objections ?? objs, sendKey: crypto.randomUUID(), template, needsBusiness: !target.accountId });
  };
  const copyCalendly = async () => {
    const link = pb?.links.calendly;
    if (!link) return toast(t("Add your Calendly link in Settings › Workspace"));
    try { await navigator.clipboard.writeText(link); toast(t("Calendly link copied")); } catch { toast(link); }
  };
  const skip = () => { if (current) { setSkipped((x) => [...x, current.accountId]); resetCall(); } };
  const pause = () => setPaused({ since: Date.now() });
  const resume = () => { if (paused) setPausedMs((m) => m + Date.now() - paused.since); setPaused(null); };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (paused) { if (e.key === "Enter" && !isTyping(e.target)) { e.preventDefault(); resume(); } return; }
      if (e.key === "Escape") { if (pending) setPending(null); else if (focusObj) setFocusObj(null); return; }
      if (isTyping(e.target) || pending) return;
      if (e.key.toLowerCase() === "u" && undo) { e.preventDefault(); undoLast.mutate(undo.key); return; }
      if (phase === "message") return; // the message card handles E / W / Enter / Esc
      // Digits by physical key: works on AZERTY (no Shift needed) and QWERTY alike.
      const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2];
      if (digit && Number(digit) <= CALL_OUTCOMES.length) { e.preventDefault(); tap(CALL_OUTCOMES[Number(digit) - 1]); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { if (focusObj) { e.preventDefault(); cycleVariant(e.key === "ArrowRight" ? 1 : -1); } return; }
      const k = e.key.toLowerCase();
      if (k === "enter") { e.preventDefault(); if (phase === "before") dial(); return; }
      if (k === "x") { e.preventDefault(); hangUp(); return; }
      if (k === "p") { e.preventDefault(); openMessage("deck"); return; }
      if (k === "c") { e.preventDefault(); void copyCalendly(); return; }
      if (k === "n" && listId) { e.preventDefault(); skip(); return; }
      const g = OBJECTION_GUIDE.find((x) => x.hotkey === k);
      if (g && phase !== "after") { e.preventDefault(); toggleObj(g.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const s = summary.data?.stats;
  const done = listId && queue.isSuccess && !current;
  const vars = { business: liveTarget?.name, contact: liveTarget?.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: lang === "ES" ? pb?.links.deckES : pb?.links.deckFR };
  const opener = pb ? findItem(pb.items, "opener", "default", lang) : null;
  const order = objectionOrder(report.data?.mine, report.data?.team);
  const shown = showAll ? order : [...new Set([...order.slice(0, TOP_OBJECTIONS), ...objs])];
  const todayCalls = day.data?.tally.calls ?? 0;
  const target = day.data?.targets?.calls?.target ?? 0;
  const chips = after ? templateChips(after.outcome, after.objections, after.target.market) : null;

  return (
    <div data-call-live className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* Session header: progress against today's target, timer, pause, end. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{listId ? t("Calling") : t("Free dialling")}</h1>
          <p className="num text-sm text-text-2" aria-live="polite">{fmt(sessionSec)}{listId ? ` · ${t("{n} left in list", { n: queue.data?.remaining ?? "…" })}` : ""}{s ? ` · ${t("{n} picked up", { n: s.pickedUp })} · ${t("{n} yes", { n: s.interested + s.callBacks + s.meetings })}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label={paused ? t("Resume") : t("Pause")} onClick={paused ? resume : pause}>{paused ? <Play /> : <Pause />}</Button>
          <MoreMenu>
            {instant.gmailKnown ? (instant.gmailConnected ? <span className="px-3 py-2 text-[13px] text-text-2">{t("Gmail connected")}</span> : <span className="px-3 py-2"><ConnectGmail compact /></span>) : null}
            <MenuItem onClick={() => openMessage("deck")} hint="P">{t("Send the deck")}</MenuItem>
            <MenuItem onClick={() => void copyCalendly()} hint="C">{t("Copy my Calendly link")}</MenuItem>
            {listId && current ? <MenuItem onClick={skip} hint="N">{t("Skip this number")}</MenuItem> : null}
            <p className="max-w-72 px-3 py-2 text-[12px] text-text-3">{t("Enter call · 1–7 outcome · letters objections · ← → other reply · X hang up · E email · W WhatsApp · U undo · P deck · C link · N skip")}</p>
          </MoreMenu>
          <Button variant="outline" onClick={() => end.mutate()} disabled={end.isPending}>{t("End session")}</Button>
        </div>
      </div>
      {target > 0 ? (
        <div aria-label={t("Calls today")}>
          <div className="flex h-2 overflow-hidden rounded-full bg-subtle"><div className="bg-sales transition-[width]" style={{ width: `${Math.min(100, (todayCalls / target) * 100)}%` }} /></div>
          <p className="num mt-1 text-[12px] text-text-2">{t("{n} / {total} calls today", { n: todayCalls, total: target })}</p>
        </div>
      ) : null}

      <ConfirmSent s={instant} />
      {undo ? (
        <div className="flex items-center gap-2 rounded-[12px] bg-subtle px-3 py-2 text-sm" role="status">
          <span className="min-w-0 flex-1 truncate">{t(CALL_OUTCOME_LABELS[undo.outcome])}{undo.name ? ` · ${undo.name}` : ""}</span>
          <Button size="sm" variant="ghost" disabled={undoLast.isPending} onClick={() => undoLast.mutate(undo.key)}><RotateCcw /> {t("Undo")} <span className="num text-[11px] opacity-70">U · {Math.max(0, Math.ceil((undo.until - now) / 1000))}</span></Button>
        </div>
      ) : null}

      {paused ? (
        <Panel className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-xl font-semibold">{t("Paused")}</p>
          <p className="text-sm text-text-2">{t("The session timer is stopped. Your calls are saved.")}</p>
          <Button size="lg" variant="primary" onClick={resume}><Play /> {t("Resume")} <span className="text-[11px] opacity-70">↵</span></Button>
        </Panel>
      ) : (
        <>
          {after && chips && instant.ready ? (
            <MessageCard key={after.sendKey} s={instant} target={after.target} chips={chips.chips} suggested={after.template ?? chips.suggested} sendKey={after.sendKey} keys needsBusiness={after.needsBusiness}
              onDone={() => setAfter(null)} onSkip={() => setAfter(null)}
              footer={listId && current && current.accountId !== after.target.accountId ? <span className="ml-auto text-[12px] text-text-3">{t("Next:")} {current.name}</span> : null} />
          ) : null}

          {phase !== "message" ? (
            <Panel className="flex flex-col gap-5">
              {listId && queue.isPending ? <Skeleton className="h-20" /> : done ? (
                <EmptyState title={t("List finished")} action={<Button variant="primary" size="sm" onClick={() => end.mutate()}>{t("See the session summary")}</Button>}>{t("Everyone in this list has been called today.")}</EmptyState>
              ) : (
                <>
                  {/* Who and why: always visible, small once the call has started. */}
                  {listId && current ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] text-text-2">{t(current.why)}{current.niche ? ` · ${t(current.niche)}` : ""}{current.city ? ` · ${current.city}` : ""}</p>
                        <p className={cn("truncate font-semibold tracking-tight", phase === "before" ? "text-2xl" : "text-lg")}>{current.name}</p>
                        {current.contactName ? <p className="text-sm text-text-2">{t("Ask for {name}", { name: current.contactName })}</p> : null}
                      </div>
                      {phase === "before" ? <Button variant="ghost" size="sm" aria-label={t("Skip this number (N)")} onClick={skip}><SkipForward /> {t("Skip")}</Button> : null}
                    </div>
                  ) : null}

                  {phase === "before" ? (
                    <>
                      {!listId ? <Input aria-label={t("Number (optional, never stored for a refusal)")} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); dial(); } }} placeholder={t("Number (optional, never stored for a refusal)")} className="num h-12 text-lg" /> : null}
                      {opener ? (
                        <div className="rounded-[16px] bg-subtle/70 p-4">
                          <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-3">{t("Opener")}</p>
                          <p className="text-[18px] leading-relaxed">{fill(opener.body, vars)}</p>
                        </div>
                      ) : null}
                      <Button size="lg" variant="primary" onClick={dial} className="h-16 w-full text-lg"><Phone /> {t("Call")} {listId && current ? <span className="num font-normal opacity-90">{current.phone}</span> : null}<span className="text-[12px] opacity-70">↵</span></Button>
                      <button type="button" onClick={hangUp} className="self-center text-[13px] text-text-2 underline">{t("Already called? Log the outcome")}</button>
                    </>
                  ) : null}

                  {phase === "during" ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="num text-3xl font-semibold" aria-label={t("Call timer")}>{fmt(callSec ?? 0)}</span>
                        <Button variant="dark" size="lg" onClick={hangUp}><PhoneOff /> {t("Hang up")} <span className="text-[11px] opacity-60">X</span></Button>
                      </div>
                      {focusObj && pb ? (
                        <ReplyCard objection={focusObj} lang={lang} variant={variant[focusObj] ?? 1} onCycle={cycleVariant} pb={pb} vars={vars} stats={report.data?.variants ?? []} best={report.data?.picks[focusObj] ?? null} onClose={() => setFocusObj(null)} />
                      ) : <p className="rounded-[16px] bg-subtle/70 p-4 text-[15px] text-text-2">{t("Listen, then tick what you hear")}</p>}
                      <div>
                        <p className="mb-2 text-sm font-medium text-text-2">{t("Objection? Tap it (or its letter): the answer shows above.")}</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {shown.map((k) => {
                            const g = guideOf(k)!;
                            const on = objs.includes(k);
                            return (
                              <button key={k} type="button" aria-pressed={on} onClick={() => toggleObj(k)} title={t(g.meaning)}
                                className={cn("flex min-h-12 items-center justify-between gap-2 rounded-[12px] border px-3 text-left text-[15px] font-medium transition-colors", on ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle", focusObj === k && "ring-2 ring-sales ring-offset-2 ring-offset-panel")}>
                                <span>{t(OBJECTION_LABELS[k])}</span><span className={cn("rounded border px-1 text-[11px] uppercase", on ? "border-panel/40 text-panel/70" : "border-hairline text-text-3")}>{g.hotkey}</span>
                              </button>
                            );
                          })}
                          {!showAll && order.length > shown.length ? <button type="button" onClick={() => setShowAll(true)} className="min-h-12 rounded-[12px] border border-dashed border-control px-3 text-[15px] text-text-2 hover:bg-subtle">{t("Others")} ({order.length - shown.length})</button> : null}
                        </div>
                      </div>
                    </>
                  ) : null}

                  {phase === "after" ? (
                    <div>
                      <p className="mb-2 text-sm font-medium text-ink">{t("Call over: how did it go?")}{callSec ? <span className="num ml-2 font-normal text-text-2">{fmt(callSec)}</span> : null}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {CALL_OUTCOMES.map((o, i) => (
                          <button key={o} type="button" onClick={() => tap(o)} disabled={log.isPending}
                            className={cn("flex min-h-[72px] flex-col items-center justify-center rounded-[14px] border-2 px-2 text-center text-[17px] font-semibold transition-colors disabled:opacity-50",
                              o === "meeting" ? "border-win bg-win text-panel hover:opacity-90" : o === "interested" || o === "call_back" ? "border-win bg-panel text-ink hover:bg-subtle" : "border-hairline bg-panel hover:bg-subtle",
                              pending === o && "ring-2 ring-ink ring-offset-2 ring-offset-panel", o === "meeting" && "col-span-2 sm:col-span-1")}>
                            {t(CALL_OUTCOME_LABELS[o])}
                            <span className={cn("text-[12px] font-normal", o === "meeting" ? "text-panel/80" : "text-text-3")}>{i + 1}</span>
                          </button>
                        ))}
                      </div>
                      {objs.length ? <p className="mt-2 text-[12px] text-text-2">{t("Objections:")} {objs.map((o) => t(OBJECTION_LABELS[o])).join(" · ")}</p> : null}
                      {pending ? <div className="mt-3"><YesDetails key={pending} outcome={pending} needsName={!listId} busy={log.isPending} onCancel={() => setPending(null)} onSave={(b) => log.mutate({ outcome: pending, ...b })} /></div> : null}
                    </div>
                  ) : null}
                </>
              )}
            </Panel>
          ) : null}
        </>
      )}

      <CallLog sessionId={id} title="This session's calls" />
    </div>
  );
}

/** Rarely used actions, folded behind "…". */
export function MoreMenu({ children }: { children: React.ReactNode }) {
  const t = useT();
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary aria-label={t("More actions")} className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full text-text-2 hover:bg-subtle hover:text-ink [&::-webkit-details-marker]:hidden"><MoreHorizontal className="size-5" /></summary>
      <div className="absolute right-0 z-30 mt-1 flex min-w-60 flex-col rounded-[14px] border border-hairline bg-panel py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) ref.current!.open = false; }}>
        {children}
      </div>
    </details>
  );
}
export function MenuItem({ onClick, hint, children }: { onClick: () => void; hint?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center justify-between gap-4 px-3 py-2 text-left text-[14px] hover:bg-subtle">
      <span>{children}</span>{hint ? <span className="rounded border border-hairline px-1 text-[11px] text-text-3">{hint}</span> : null}
    </button>
  );
}

const STEP_NAMES = ["Rephrase", "Ask", "Propose"] as const;
/**
 * The live reply, built to be read in two seconds mid-call: three short blocks, each with its role
 * ("Rephrase" / "Ask" / "Propose"), large dark text on white, the question emphasised. ← → other reply.
 */
function ReplyCard({ objection, lang, variant, onCycle, pb, vars, stats, best, onClose }: { objection: Objection; lang: Lang; variant: number; onCycle: (d: 1 | -1) => void; pb: Playbook; vars: Record<string, string | undefined>; stats: VariantStat[]; best: number | null; onClose: () => void }) {
  const t = useT();
  const item = findItem(pb.items, "objection", `${objection}#${variant}`, lang);
  const st = stats.find((x) => x.reply === `${objection}#${variant}`);
  const steps = item ? replySteps(fill(item.body, vars)) : [];
  const g = guideOf(objection);
  return (
    <div className="rounded-[18px] border-2 border-ink bg-panel p-5" aria-live="assertive">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-[15px] font-semibold">« {t(OBJECTION_LABELS[objection])} »{g?.type === "brush_off" ? <span className="ml-2 text-[13px] font-normal text-text-2">{t("brush-off: test it")}</span> : null}</p>
        <span className="flex items-center gap-1 text-[12px] text-text-3">
          <button type="button" aria-label={t("Previous reply")} onClick={() => onCycle(-1)} className="rounded p-1.5 hover:bg-subtle"><ChevronLeft className="size-5" /></button>
          <span className="num">{t("reply {n}", { n: variant })}{best === variant ? ` · ${t("best")}` : ""}{st ? ` · ${st.won}/${st.uses}` : ""}</span>
          <button type="button" aria-label={t("Next reply")} onClick={() => onCycle(1)} className="rounded p-1.5 hover:bg-subtle"><ChevronRight className="size-5" /></button>
          <button type="button" aria-label={t("Close")} onClick={onClose} className="rounded p-1.5 hover:bg-subtle"><X className="size-5" /></button>
        </span>
      </div>
      <ol className="flex flex-col gap-4">
        {steps.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span className={cn("mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", i === 1 ? "bg-ink text-panel" : "bg-subtle text-text-2")}>{i + 1}</span>
            <span>
              <span className="block text-[12px] font-semibold uppercase tracking-wide text-text-3">{t(STEP_NAMES[i] ?? "")}</span>
              <span className={cn("block text-[22px] leading-[1.35]", i === 1 ? "font-semibold" : "font-normal")}>{line}</span>
            </span>
          </li>
        ))}
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
