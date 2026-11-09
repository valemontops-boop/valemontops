"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, Check, ChevronLeft, ChevronRight, Mail, MoreHorizontal, Pause, Phone, PhoneOff, Play, RotateCcw, SkipForward, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Panel, Skeleton } from "@/components/ui/form";
import { useLocale, useT } from "@/i18n/react";
import { ConfirmSent, ConnectGmail, InCallMail, MessageCard, useInstantSend, type Playbook, type SendTarget } from "./instant-send";
import { CallLog } from "./call-log";
import {
  AFTER_OUTCOME_LABELS, CALL_OUTCOME_LABELS, LADDER_START, MISSED_OUTCOMES, afterOutcomes, ladder, nextStep, resolveAfter, suggestedAfter,
  type AfterOutcome, type CallFlowAction, type CallOutcome, type CallStats, type CallStep, type LadderOffer, type LadderState,
} from "@/domain/calls";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { OBJECTION_GUIDE, VARIANTS, guideOf, replySteps, type VariantStat } from "@/domain/objections";
import { TEMPLATE_SHORT, fill, findItem, type Lang, type TemplateKey } from "@/domain/playbook";
import { afterCallSuggestion, inCallChips, templateChips } from "@/domain/messages";
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
type Pending = { after: AfterOutcome; outcome: CallOutcome; offer: LadderOffer | null };
type After = { target: Target; outcome: CallOutcome | null; objections: Objection[]; offer: LadderOffer | null; sendKey: string; template?: TemplateKey; needsBusiness?: boolean; open: boolean };

/**
 * The live call screen, round 9 (D071), one click per step:
 * [New call] (Enter) → [Picked up] 1 / [Not picked up] 2. Not picked up → no answer 1 / voicemail 2, logged, next
 * (a "tried to reach you" mail one click away). Picked up → objections and their reply, [Instant mail] (M, sent while
 * still on the phone), the downsell ladder (O: Local, then 30/30), [Hung up] (X) → one outcome (1–7), then the next
 * prospect. The message card stays available after, folded, never blocking; it is not suggested when a mail already
 * went out during the call. "Undo" for 10 seconds.
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
  const [step, setStep] = React.useState<CallStep>("ready");
  const go = (a: CallFlowAction) => setStep((x) => nextStep(x, a));
  const [objs, setObjs] = React.useState<Objection[]>([]);
  const [focusObj, setFocusObj] = React.useState<Objection | null>(null);
  const [variant, setVariant] = React.useState<Record<string, number>>({});
  const [showAll, setShowAll] = React.useState(false);
  const [dialAt, setDialAt] = React.useState<number | null>(null);
  const [endAt, setEndAt] = React.useState<number | null>(null);
  const [ladderState, setLadder] = React.useState<LadderState>(LADDER_START);
  const [mailOpen, setMailOpen] = React.useState(false);
  const [mailed, setMailed] = React.useState<TemplateKey[]>([]); // sent during this call
  const [known, setKnown] = React.useState<{ accountId: string; email: string; business: string }>({ accountId: "", email: "", business: "" }); // learnt during this call
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID()); // one idempotency key per call, reused on retry
  const [after, setAfter] = React.useState<After | null>(null);
  const [undoRaw, setUndo] = React.useState<{ key: string; outcome: CallOutcome; offer: LadderOffer | null; name: string; until: number } | null>(null);
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
    ? current ? { accountId: current.accountId, name: current.name, contact: current.contactName, email: known.email || current.email, phone: current.phone, market: current.country ?? "FR" } : null
    : { accountId: known.accountId, name: known.business, contact: "", email: known.email, phone, market };
  const pb = playbook.data;
  const resetCall = () => { setObjs([]); setFocusObj(null); setVariant({}); setDialAt(null); setEndAt(null); setShowAll(false); setLadder(LADDER_START); setMailOpen(false); setMailed([]); setKnown({ accountId: "", email: "", business: "" }); setStep("ready"); };
  const instant = useInstantSend(id);

  const end = useMutation({ mutationFn: () => api("/api/calls/sessions", { method: "PATCH", body: { id } }), onSuccess: () => { qc.invalidateQueries(); onEnd(); } });
  const refresh = () => ["call-summary", "call-queue", "call-objections", "call-log", "my-day", "email-queue", "crm"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const log = useMutation({
    mutationKey: ["log-activity"],
    mutationFn: (b: Record<string, unknown>) => api<{ duplicate: boolean; opportunityId: string | null; event: { account_id: string } }>("/api/calls", {
      body: {
        idempotency_key: key, session_id: id, list_id: listId, account_id: current?.accountId ?? known.accountId, phone: listId ? "" : phone, market: listId ? current?.country ?? null : market,
        objections: objs, replies: objs.map((o) => `${o}#${variant[o] ?? 1}`), duration_sec: callSec, offers_pitched: ladderState.pitched, ...b,
      },
    }),
    onSuccess: (r, b) => {
      const o = b.outcome as CallOutcome;
      const offer = (b.offer as LadderOffer | null | undefined) ?? null;
      const label = offer ? AFTER_OUTCOME_LABELS[offer === "local" ? "local_yes" : "thirty_yes"] : CALL_OUTCOME_LABELS[o];
      toast(r.opportunityId ? t("{outcome}: added to your pipeline", { outcome: t(label) }) : offer === "thirty" ? t("30/30 lead noted: no Consulting deal") : t(label));
      const target = liveTarget ? { ...liveTarget, accountId: r.event?.account_id || liveTarget.accountId, name: (b.business_name as string) || liveTarget.name, contact: (b.contact_name as string) || liveTarget.contact } : null;
      // Free-dial refusal: the number is not kept, so no message (D030). Gatekeepers get nothing. A mail already sent during the call: nothing more.
      const sug = target ? afterCallSuggestion(o, objs, target.market, offer, mailed) : null;
      const message = target && sug && (listId || isYes(o) || target.accountId);
      setAfter(message ? { target: target!, outcome: o, objections: objs, offer, sendKey: crypto.randomUUID(), open: false } : null);
      setUndo({ key, outcome: o, offer, name: target?.name || target?.phone || "", until: Date.now() + UNDO_SECONDS * 1000 });
      setPending(null); setPhone(""); resetCall(); setKey(crypto.randomUUID());
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError && e.isBlocked ? e.message : t("Error: {message}. Tap again to retry (it won't count twice).", { message: (e as Error).message.replace(/[.\s]+$/, "") })),
  });
  const undoLast = useMutation({
    mutationFn: (k: string) => api("/api/calls/undo", { body: { idempotency_key: k } }),
    onSuccess: () => { toast(t("Undone: the call no longer counts.")); setUndo(null); setAfter(null); refresh(); },
    onError: (e) => toast((e as Error).message),
  });

  const busy = log.isPending || Boolean(listId && !current);
  /** [New call]: the timer starts and the phone dials (tel: link). */
  const newCall = () => {
    if (busy) return;
    setAfter(null);
    setDialAt(Date.now());
    go("dial");
    const n = listId ? current?.phone : phone;
    if (n) window.location.href = `tel:${n}`;
  };
  /** "Already called?": straight to picked up / not picked up. */
  const logWithoutDial = () => { if (busy) return; setAfter(null); setDialAt(Date.now()); setEndAt(Date.now()); go("hang_up"); };
  const pickedUp = () => go("picked_up");
  const notPickedUp = () => { if (!endAt) setEndAt(Date.now()); setMailOpen(false); go("not_picked_up"); };
  const logMissed = (o: (typeof MISSED_OUTCOMES)[number]) => { if (!busy) log.mutate({ outcome: o, offers_pitched: [] }); };
  const hangUp = () => {
    if (step === "live") { setEndAt(Date.now()); setFocusObj(null); setMailOpen(false); go("hang_up"); }
    else if (step === "ringing") notPickedUp();
  };
  const chooseAfter = (a: AfterOutcome) => {
    if (busy) return;
    const r = resolveAfter(a);
    // A yes asks for the date of the next step (and a name in free dialling); a yes to 30/30 needs only the name.
    if (isYes(r.outcome) && (r.offer !== "thirty" || (!listId && !known.accountId))) return setPending({ after: a, ...r });
    log.mutate({ outcome: r.outcome, offer: r.offer });
  };
  const toggleObj = (o: Objection) => {
    const on = objs.includes(o);
    setObjs((x) => (on ? x.filter((y) => y !== o) : [...x, o]));
    if (!on) {
      setFocusObj(o);
      setVariant((v) => (v[o] ? v : { ...v, [o]: report.data?.picks[o] ?? 1 }));
      if (o === "send_info" || o === "no_time") setMailOpen(true); // "send me info" / "no time": the deck is one click away
    } else if (focusObj === o) setFocusObj(null);
  };
  const cycleVariant = (dir: 1 | -1) => {
    if (!focusObj) return;
    setVariant((v) => ({ ...v, [focusObj]: (((v[focusObj] ?? 1) - 1 + dir + VARIANTS) % VARIANTS) + 1 }));
  };
  const onLadder = (a: "propose" | "yes" | "no" | "reset") => {
    const next = ladder(ladderState, a);
    setLadder(next);
    if (a !== "reset") setFocusObj(null);
    if (next.accepted === "thirty" || next.accepted === "local") setMailOpen(true); // the matching mail comes first
  };
  const openMessage = (template: TemplateKey) => {
    const target = after?.target ?? liveTarget;
    if (!target) return;
    setAfter({ target, outcome: after?.outcome ?? null, objections: after?.objections ?? objs, offer: after?.offer ?? null, sendKey: crypto.randomUUID(), template, needsBusiness: !target.accountId, open: true });
  };
  const copyCalendly = async () => {
    const link = pb?.links.calendly;
    if (!link) return toast(t("Add your Calendly link in Settings › Workspace"));
    try { await navigator.clipboard.writeText(link); toast(t("Calendly link copied")); } catch { toast(link); }
  };
  const skip = () => { if (current && step === "ready") { setSkipped((x) => [...x, current.accountId]); resetCall(); } };
  const pause = () => setPaused({ since: Date.now() });
  const resume = () => { if (paused) setPausedMs((m) => m + Date.now() - paused.since); setPaused(null); };
  const outcomes = afterOutcomes(ladderState);
  const suggested = suggestedAfter(ladderState);
  const onMailSent = (k: TemplateKey, r: { accountId: string; email: string; business: string }) => {
    setMailed((m) => [...new Set([...m, k])]);
    setKnown((x) => ({ accountId: x.accountId || (listId ? "" : r.accountId), email: r.email, business: r.business || x.business }));
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (paused) { if (e.key === "Enter" && !isTyping(e.target)) { e.preventDefault(); resume(); } return; }
      if (e.key === "Escape") {
        if (pending) setPending(null);
        else if (after?.open) setAfter({ ...after, open: false });
        else if (mailOpen) setMailOpen(false);
        else if (focusObj) setFocusObj(null);
        else if (step === "ringing" || step === "missed" || step === "hungup") go("back");
        return;
      }
      if (isTyping(e.target) || pending) return;
      if (e.key.toLowerCase() === "u" && undo) { e.preventDefault(); undoLast.mutate(undo.key); return; }
      if (after?.open) return; // the message card handles E / W / Enter / Esc
      const digit = Number(/^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2] ?? 0); // physical key: AZERTY and QWERTY alike
      const k = e.key.toLowerCase();
      if (step === "ready") {
        if (k === "enter") { e.preventDefault(); newCall(); }
        else if (k === "x") { e.preventDefault(); logWithoutDial(); }
        else if (k === "e" && after) { e.preventDefault(); setAfter({ ...after, open: true }); }
        else if (k === "p") { e.preventDefault(); openMessage("deck"); }
        else if (k === "c") { e.preventDefault(); void copyCalendly(); }
        else if (k === "n" && listId) { e.preventDefault(); skip(); }
        return;
      }
      if (step === "ringing") {
        if (digit === 1) { e.preventDefault(); pickedUp(); }
        else if (digit === 2 || k === "x") { e.preventDefault(); notPickedUp(); }
        return;
      }
      if (step === "missed") {
        if (k === "m") { e.preventDefault(); setMailOpen((x) => !x); return; }
        if (mailOpen) return; // digits send a mail chip
        if (digit >= 1 && digit <= MISSED_OUTCOMES.length) { e.preventDefault(); logMissed(MISSED_OUTCOMES[digit - 1]); }
        return;
      }
      if (step === "hungup") {
        if (digit >= 1 && digit <= outcomes.length) { e.preventDefault(); chooseAfter(outcomes[digit - 1]); }
        else if (k === "enter" && suggested) { e.preventDefault(); chooseAfter(suggested); }
        return;
      }
      // live
      if (k === "x") { e.preventDefault(); hangUp(); return; }
      if (k === "m") { e.preventDefault(); setMailOpen((x) => !x); return; }
      if (k === "o" && (ladderState.at === "idle")) { e.preventDefault(); onLadder("propose"); return; }
      if ((k === "y" || k === "n") && (ladderState.at === "local" || ladderState.at === "thirty")) { e.preventDefault(); onLadder(k === "y" ? "yes" : "no"); return; }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { if (focusObj) { e.preventDefault(); cycleVariant(e.key === "ArrowRight" ? 1 : -1); } return; }
      const g = OBJECTION_GUIDE.find((x) => x.hotkey === k);
      if (g) { e.preventDefault(); toggleObj(g.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const s = summary.data?.stats;
  const done = listId && queue.isSuccess && !current && step === "ready";
  const vars = { business: liveTarget?.name, contact: liveTarget?.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: lang === "ES" ? pb?.links.deckES : pb?.links.deckFR, thirty: pb?.links.thirty, local_price: pb?.localPrice };
  const opener = pb ? findItem(pb.items, "opener", "default", lang) : null;
  const order = objectionOrder(report.data?.mine, report.data?.team);
  const shown = showAll ? order : [...new Set([...order.slice(0, TOP_OBJECTIONS), ...objs])];
  const todayCalls = day.data?.tally.calls ?? 0;
  const target = day.data?.targets?.calls?.target ?? 0;
  const chips = after ? templateChips(after.outcome, after.objections, after.target.market, after.offer) : null;
  const mailChips = liveTarget ? inCallChips({ picked: step !== "missed", market: liveTarget.market, objections: objs, accepted: ladderState.accepted, sent: mailed }) : null;
  const yesCount = s ? s.interested + s.callBacks + s.meetings : 0;
  const mailBlock = liveTarget && mailChips && instant.ready && mailOpen ? (
    <InCallMail key={key} s={instant} target={liveTarget} chips={mailChips.chips} suggested={mailChips.suggested} sent={mailed} keys needsBusiness={!listId && !known.accountId} onSent={onMailSent} />
  ) : null;

  return (
    <div data-call-live className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* Session header: progress against today's target, timer, pause, end. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{listId ? t("Calling") : t("Free dialling")}</h1>
          <p className="num text-sm text-text-2" aria-live="polite">{fmt(sessionSec)}{listId ? ` · ${t("{n} left in list", { n: queue.data?.remaining ?? "…" })}` : ""}{s ? ` · ${t("{n} picked up", { n: s.pickedUp })} · ${t("{n} yes", { n: yesCount })}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label={paused ? t("Resume") : t("Pause")} onClick={paused ? resume : pause}>{paused ? <Play /> : <Pause />}</Button>
          <MoreMenu>
            {instant.gmailKnown ? (instant.gmailConnected ? <span className="px-3 py-2 text-[13px] text-text-2">{t("Gmail connected")}</span> : <span className="px-3 py-2"><ConnectGmail compact /></span>) : null}
            <MenuItem onClick={() => openMessage("deck")} hint="P">{t("Send the deck")}</MenuItem>
            <MenuItem onClick={() => void copyCalendly()} hint="C">{t("Copy my Calendly link")}</MenuItem>
            {listId && current && step === "ready" ? <MenuItem onClick={skip} hint="N">{t("Skip this number")}</MenuItem> : null}
            <p className="max-w-72 px-3 py-2 text-[12px] text-text-3">{t("Enter new call · 1 picked up · 2 not picked up · letters objections · ← → other reply · M instant mail · O offer Local then 30/30 · Y / N their answer · X hung up · 1–7 outcome · U undo · E message · N skip")}</p>
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
          <span className="min-w-0 flex-1 truncate">{t(undo.offer ? AFTER_OUTCOME_LABELS[undo.offer === "local" ? "local_yes" : "thirty_yes"] : CALL_OUTCOME_LABELS[undo.outcome])}{undo.name ? ` · ${undo.name}` : ""}</span>
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
          {/* After a call: the message stays one key away (E), folded, never in the way of the next call. */}
          {after && chips && instant.ready && step === "ready" ? (after.open ? (
            <MessageCard key={after.sendKey} s={instant} target={after.target} chips={chips.chips} suggested={after.template ?? chips.suggested} sendKey={after.sendKey} keys needsBusiness={after.needsBusiness}
              onDone={() => setAfter(null)} onSkip={() => setAfter(null)}
              footer={listId && current && current.accountId !== after.target.accountId ? <span className="ml-auto text-[12px] text-text-3">{t("Next:")} {current.name}</span> : null} />
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-sales/60 bg-panel px-4 py-2.5" role="status">
              <Mail className="size-4 text-text-2" />
              <p className="min-w-0 flex-1 truncate text-sm">{t("Message for {name}", { name: after.target.contact || after.target.name || t("the last call") })}{chips.suggested ? <span className="text-text-2"> · {t(TEMPLATE_SHORT[after.template ?? chips.suggested])}</span> : null}</p>
              <Button size="sm" variant="outline" onClick={() => setAfter({ ...after, open: true })}>{t("Write")} <span className="text-[11px] opacity-60">E</span></Button>
              <Button size="icon" variant="ghost" aria-label={t("No message")} onClick={() => setAfter(null)}><X /></Button>
            </div>
          )) : null}

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
                      <p className={cn("truncate font-semibold tracking-tight", step === "ready" ? "text-2xl" : "text-lg")}>{current.name}</p>
                      {current.contactName ? <p className="text-sm text-text-2">{t("Ask for {name}", { name: current.contactName })}</p> : null}
                    </div>
                    {step === "ready" ? <Button variant="ghost" size="sm" aria-label={t("Skip this number (N)")} onClick={skip}><SkipForward /> {t("Skip")}</Button> : null}
                  </div>
                ) : null}

                {step === "ready" ? (
                  <>
                    {!listId ? <Input aria-label={t("Number (optional, never stored for a refusal)")} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); newCall(); } }} placeholder={t("Number (optional, never stored for a refusal)")} className="num h-12 text-lg" /> : null}
                    {opener ? (
                      <div className="rounded-[16px] bg-subtle/70 p-4">
                        <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-3">{t("Opener")}</p>
                        <p className="text-[18px] leading-relaxed">{fill(opener.body, vars)}</p>
                      </div>
                    ) : null}
                    <Button size="lg" variant="primary" onClick={newCall} disabled={busy} className="h-16 w-full text-lg"><Phone /> {t("New call")} {listId && current ? <span className="num font-normal opacity-90">{current.phone}</span> : null}<span className="text-[12px] opacity-70">↵</span></Button>
                    <button type="button" onClick={logWithoutDial} className="self-center text-[13px] text-text-2 underline">{t("Already called? Log the outcome")}</button>
                  </>
                ) : null}

                {step === "ringing" ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="num text-3xl font-semibold" aria-label={t("Call timer")}>{fmt(callSec ?? 0)}</span>
                      <button type="button" onClick={() => go("back")} className="text-[13px] text-text-2 underline">{t("Back")}</button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <BigChoice onClick={pickedUp} tone="win" hint="1">{t("They picked up")}</BigChoice>
                      <BigChoice onClick={notPickedUp} hint="2">{t("They did not pick up")}</BigChoice>
                    </div>
                  </>
                ) : null}

                {step === "missed" ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">{t("Nobody picked up: what happened?")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {MISSED_OUTCOMES.map((o, i) => (
                        <button key={o} type="button" onClick={() => logMissed(o)} disabled={log.isPending} className="flex min-h-[64px] flex-col items-center justify-center rounded-[14px] border-2 border-hairline bg-panel text-[17px] font-semibold hover:bg-subtle disabled:opacity-50">
                          {t(CALL_OUTCOME_LABELS[o])}<span className="text-[12px] font-normal text-text-3">{i + 1}</span>
                        </button>
                      ))}
                    </div>
                    {mailBlock ?? (liveTarget ? <MailToggle onClick={() => setMailOpen(true)} sent={mailed.length} label={t("Mail: tried to reach you")} /> : null)}
                    <button type="button" onClick={() => go("back")} className="self-start text-[13px] text-text-2 underline">{t("Back")}</button>
                  </div>
                ) : null}

                {step === "live" ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className="num text-3xl font-semibold" aria-label={t("Call timer")}>{fmt(callSec ?? 0)}</span>
                      <Button variant="dark" size="lg" onClick={hangUp}><PhoneOff /> {t("Hung up")} <span className="text-[11px] opacity-60">X</span></Button>
                    </div>
                    {ladderState.at === "local" || ladderState.at === "thirty" ? (
                      <PitchCard offer={ladderState.at} pb={pb} lang={lang} vars={vars} onAnswer={(yes) => onLadder(yes ? "yes" : "no")} />
                    ) : focusObj && pb ? (
                      <ReplyCard objection={focusObj} lang={lang} variant={variant[focusObj] ?? 1} onCycle={cycleVariant} pb={pb} vars={vars} stats={report.data?.variants ?? []} best={report.data?.picks[focusObj] ?? null} onClose={() => setFocusObj(null)} />
                    ) : <p className="rounded-[16px] bg-subtle/70 p-4 text-[15px] text-text-2">{t("Listen, then tick what you hear")}</p>}
                    <div className="flex flex-wrap gap-2">
                      {mailOpen ? null : <MailToggle onClick={() => setMailOpen(true)} sent={mailed.length} label={t("Instant mail")} />}
                      <LadderBar state={ladderState} onPropose={() => onLadder("propose")} onReset={() => onLadder("reset")} />
                    </div>
                    {mailBlock}
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

                {step === "hungup" ? (
                  <div>
                    <p className="mb-2 text-sm font-medium text-ink">{t("Call over: how did it go?")}{callSec ? <span className="num ml-2 font-normal text-text-2">{fmt(callSec)}</span> : null}</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {outcomes.map((o, i) => (
                        <button key={o} type="button" onClick={() => chooseAfter(o)} disabled={log.isPending}
                          className={cn("flex min-h-[72px] flex-col items-center justify-center rounded-[14px] border-2 px-2 text-center text-[17px] font-semibold transition-colors disabled:opacity-50",
                            o === "meeting" ? "border-win bg-win text-panel hover:opacity-90" : ["interested", "call_back", "local_yes", "thirty_yes"].includes(o) ? "border-win bg-panel text-ink hover:bg-subtle" : "border-hairline bg-panel hover:bg-subtle",
                            (pending?.after === o || (!pending && suggested === o)) && "ring-2 ring-ink ring-offset-2 ring-offset-panel")}>
                          {t(AFTER_OUTCOME_LABELS[o])}
                          <span className={cn("text-[12px] font-normal", o === "meeting" ? "text-panel/80" : "text-text-3")}>{i + 1}{!pending && suggested === o ? " · ↵" : ""}</span>
                        </button>
                      ))}
                    </div>
                    {objs.length || mailed.length ? <p className="mt-2 text-[12px] text-text-2">{objs.length ? `${t("Objections:")} ${objs.map((o) => t(OBJECTION_LABELS[o])).join(" · ")}` : ""}{objs.length && mailed.length ? " · " : ""}{mailed.length ? `${t("Mail sent during the call:")} ${mailed.map((k) => t(TEMPLATE_SHORT[k])).join(", ")}` : ""}</p> : null}
                    {pending ? <div className="mt-3"><YesDetails key={pending.after} outcome={pending.outcome} label={t(AFTER_OUTCOME_LABELS[pending.after])} needsName={!listId && !known.accountId} initialName={known.business} askDate={pending.offer !== "thirty"} busy={log.isPending} onCancel={() => setPending(null)} onSave={(b) => log.mutate({ outcome: pending.outcome, offer: pending.offer, ...b })} /></div> : null}
                  </div>
                ) : null}
              </>
            )}
          </Panel>
        </>
      )}

      <CallLog sessionId={id} title="This session's calls" />
    </div>
  );
}

function BigChoice({ onClick, tone, hint, children }: { onClick: () => void; tone?: "win"; hint: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-[96px] flex-col items-center justify-center rounded-[18px] border-2 text-[22px] font-semibold transition-colors", tone === "win" ? "border-win bg-win text-panel hover:opacity-90" : "border-ink bg-panel text-ink hover:bg-subtle")}>
      {children}<span className={cn("text-[13px] font-normal", tone === "win" ? "text-panel/80" : "text-text-3")}>{hint}</span>
    </button>
  );
}

function MailToggle({ onClick, sent, label }: { onClick: () => void; sent: number; label: string }) {
  const t = useT();
  return (
    <Button variant="outline" size="lg" onClick={onClick} className="min-h-12"><Mail /> {label}{sent ? <span className="text-[12px] text-win">· {t("{n} sent", { n: sent })}</span> : null} <span className="text-[11px] opacity-60">M</span></Button>
  );
}

/** Downsell ladder entry: after a no to Consulting, offer Local; the answers show here once given. */
function LadderBar({ state, onPropose, onReset }: { state: LadderState; onPropose: () => void; onReset: () => void }) {
  const t = useT();
  if (state.at === "idle") return <Button variant="outline" size="lg" onClick={onPropose} className="min-h-12"><ArrowDownRight /> {t("Not interested → offer Local")} <span className="text-[11px] opacity-60">O</span></Button>;
  if (state.at !== "done") return null;
  const text = state.accepted === "local" ? t("Yes to Local: hang up, then confirm") : state.accepted === "thirty" ? t("Yes to 30/30: send the link, then hang up") : t("No to Local and 30/30");
  return (
    <span className="flex min-h-12 items-center gap-2 rounded-[12px] bg-subtle px-3 text-[14px]">
      {state.accepted ? <Check className="size-4 text-win" /> : null}{text}
      <button type="button" onClick={onReset} aria-label={t("Start the offers again")} className="rounded p-1 text-text-2 hover:bg-panel"><RotateCcw className="size-4" /></button>
    </span>
  );
}

/** The downsell pitch, said live: three short lines in the founder's language (Settings › Playbook), then Yes / No. */
function PitchCard({ offer, pb, lang, vars, onAnswer }: { offer: LadderOffer; pb: Playbook | undefined; lang: Lang; vars: Record<string, string | undefined>; onAnswer: (yes: boolean) => void }) {
  const t = useT();
  const item = pb ? findItem(pb.items, "opener", offer === "local" ? "pitch_local" : "pitch_thirty", lang) : null;
  const lines = item ? fill(item.body, vars).split("\n").filter((l) => l.trim()) : [];
  return (
    <div className="rounded-[18px] border-2 border-ink bg-panel p-5" aria-live="assertive">
      <p className="mb-3 text-[15px] font-semibold">{offer === "local" ? t("Offer Local · {price} per month", { price: pb?.localPrice ?? "100 €" }) : t("Offer 30/30")}</p>
      <ol className="mb-4 flex flex-col gap-2">{lines.map((l, i) => <li key={i} className={cn("text-[20px] leading-[1.35]", i === 1 && "font-semibold")}>{l}</li>)}</ol>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onAnswer(true)} className="flex min-h-14 items-center justify-center gap-2 rounded-[14px] border-2 border-win bg-win text-[17px] font-semibold text-panel hover:opacity-90">{offer === "local" ? t("Yes Local") : t("Yes 30/30")} <span className="text-[12px] font-normal opacity-80">Y</span></button>
        <button type="button" onClick={() => onAnswer(false)} className="flex min-h-14 items-center justify-center gap-2 rounded-[14px] border-2 border-hairline bg-panel text-[17px] font-semibold hover:bg-subtle">{t("No")} <span className="text-[12px] font-normal text-text-3">N</span></button>
      </div>
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

function YesDetails({ outcome, label, needsName, initialName = "", askDate = true, busy, onCancel, onSave }: { outcome: CallOutcome; label: string; needsName: boolean; initialName?: string; askDate?: boolean; busy: boolean; onCancel: () => void; onSave: (b: Record<string, string>) => void }) {
  const t = useT();
  const today = new Date().toLocaleDateString("en-CA");
  const [date, setDate] = React.useState(outcome === "meeting" ? addDays(today, 3) : outcome === "interested" ? addDays(today, 1) : addDays(today, 2));
  const [business, setBusiness] = React.useState(initialName);
  const [contact, setContact] = React.useState("");
  return (
    <form className="flex flex-col gap-3 rounded-[12px] bg-subtle/60 p-3" onSubmit={(e) => { e.preventDefault(); onSave({ follow_up_date: askDate ? date : "", business_name: business, contact_name: contact }); }}>
      {askDate ? <>
      <p className="text-sm font-medium">{outcome === "meeting" ? t("Meeting date") : t("When to call back")}</p>
      <div className="flex flex-wrap gap-2">
        {[["Today", 0], ["Tomorrow", 1], ["In 2 days", 2], ["Next week", 7]].map(([l, d]) => { const v = addDays(today, d as number); return <button key={String(l)} type="button" aria-pressed={date === v} onClick={() => setDate(v)} className={cn("min-h-10 rounded-full border px-3 text-sm", date === v ? "border-ink bg-ink text-panel" : "border-control bg-panel")}>{t(String(l))}</button>; })}
        <Input aria-label={t("Date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-40" />
      </div>
      </> : null}
      {needsName ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input aria-label={t("Business name")} required autoFocus={!initialName} placeholder={t("Business name (required)")} value={business} onChange={(e) => setBusiness(e.target.value)} />
          <Input aria-label={t("Contact name")} placeholder={t("Who you spoke to (optional)")} value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" autoFocus={!needsName || Boolean(initialName)} disabled={busy || (needsName && !business.trim())}>{busy ? t("Saving…") : t("Save · {outcome}", { outcome: label })}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}
