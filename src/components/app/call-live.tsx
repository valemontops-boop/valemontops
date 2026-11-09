"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, Check, ChevronLeft, ChevronRight, Mail, MoreHorizontal, Pause, Phone, PhoneOff, Play, RotateCcw, SkipForward, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Input, Panel, Skeleton } from "@/components/ui/form";
import { useLocale, useT } from "@/i18n/react";
import { ConfirmSent, ConnectGmail, InCallMail, MessageCard, SentLine, useInstantSend, type Playbook, type SendTarget } from "./instant-send";
import { CallLog } from "./call-log";
import {
  AFTER_OUTCOME_LABELS, CALL_OUTCOME_LABELS, LADDER_START, MISSED_OUTCOMES, afterOutcomes, ladder, nextStep, resolveAfter, suggestedAfter,
  type AfterOutcome, type CallFlowAction, type CallOutcome, type CallStats, type CallStep, type LadderOffer, type LadderState,
} from "@/domain/calls";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { OBJECTION_GUIDE, VARIANTS, guideOf, objectionGroups, replySteps, type ObjectionType, type VariantStat } from "@/domain/objections";
import { EMAIL_TEMPLATE_LABELS, TEMPLATE_SHORT, fill, findItem, type Lang, type TemplateKey } from "@/domain/playbook";
import { afterCallSuggestion, inCallChips, messageFor, templateChips } from "@/domain/messages";
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
/** Objections during a call: the founder's most frequent first (then the team's); all of them are always shown (D076). */
export function objectionOrder(mine: ObjCount[] | undefined, team: ObjCount[] | undefined): Objection[] {
  const n = (k: string) => (mine?.find((x) => x.key === k)?.count ?? 0) * 1000 + (team?.find((x) => x.key === k)?.count ?? 0);
  return OBJECTION_GUIDE.map((g, i) => ({ k: g.key, s: n(g.key), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.k);
}
const UNDO_SECONDS = 10;
type Pending = { after: AfterOutcome; outcome: CallOutcome; offer: LadderOffer | null };
type After = { target: Target; outcome: CallOutcome | null; objections: Objection[]; offer: LadderOffer | null; sendKey: string; template?: TemplateKey; needsBusiness?: boolean; open: boolean };

/**
 * The live call screen, round 10 (D076, after D071), one click per step:
 * [New call] (Enter, focused) → [Picked up] 1 / [Not picked up] 2 / [Voicemail] 3. A missed call is logged at once and
 * the next prospect comes up with [New call] focused (a "tried to reach you" mail waits in a slim bar, E shows it).
 * Picked up → one viewport, no scrolling: every objection on the left (brush-offs, then real ones, letter keys), on the
 * right the reply (3 steps), the instant-mail chips (hover = preview, click = editable preview, Enter sends), the
 * downsell ladder (O, Y / N) and [Hung up] (X) → one outcome (1–7) → the next prospect, [New call] focused.
 * "← Back" (Esc) goes one step back without logging anything; "Undo the last call" (U) sits in the header for 10 s.
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
  const [dialAt, setDialAt] = React.useState<number | null>(null);
  const [endAt, setEndAt] = React.useState<number | null>(null);
  const [ladderState, setLadder] = React.useState<LadderState>(LADDER_START);
  const mailPreview = React.useRef(false); // the instant-mail preview handles Enter / Esc while open
  const setMailPreview = React.useCallback((v: boolean) => { mailPreview.current = v; }, []);
  const [mailed, setMailed] = React.useState<TemplateKey[]>([]); // sent during this call
  const [known, setKnown] = React.useState<{ accountId: string; email: string; business: string }>({ accountId: "", email: "", business: "" }); // learnt during this call
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID()); // one idempotency key per call, reused on retry
  const [after, setAfter] = React.useState<After | null>(null);
  const [undoRaw, setUndo] = React.useState<{ key: string; outcome: CallOutcome; offer: LadderOffer | null; name: string; until: number } | null>(null);
  const [paused, setPaused] = React.useState<{ since: number } | null>(null);
  const [pausedMs, setPausedMs] = React.useState(0);
  const newCallRef = React.useRef<HTMLButtonElement>(null);
  const phoneRef = React.useRef<HTMLInputElement>(null);
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
  const resetCall = () => { setObjs([]); setFocusObj(null); setVariant({}); setDialAt(null); setEndAt(null); setLadder(LADDER_START); setMailPreview(false); setMailed([]); setKnown({ accountId: "", email: "", business: "" }); setStep("ready"); };
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
  const pickedUp = () => { setEndAt(null); go("picked_up"); };
  /** Not picked up / voicemail: logged at once, then the next prospect with [New call] focused (D076). */
  const logMissed = (o: (typeof MISSED_OUTCOMES)[number]) => { if (!busy) { if (!endAt) setEndAt(Date.now()); log.mutate({ outcome: o, offers_pitched: [] }); } };
  const hangUp = () => {
    if (step === "live") { setEndAt(Date.now()); setFocusObj(null); go("hang_up"); }
    else if (step === "ringing") logMissed("no_answer");
  };
  /** "← Back": one step back in the click path, nothing logged. */
  const back = () => {
    if (log.isPending) return;
    setPending(null);
    if (step === "hungup") setEndAt(null);
    if (step === "ringing") { setDialAt(null); setEndAt(null); }
    if (step === "live") setFocusObj(null);
    go("back");
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
    if (on && focusObj !== o) { setFocusObj(o); return; } // already ticked: a tap brings its reply back first
    setObjs((x) => (on ? x.filter((y) => y !== o) : [...x, o]));
    if (!on) {
      setFocusObj(o);
      setVariant((v) => (v[o] ? v : { ...v, [o]: report.data?.picks[o] ?? 1 }));
    } else setFocusObj(null);
  };
  const cycleVariant = (dir: 1 | -1) => {
    if (!focusObj) return;
    setVariant((v) => ({ ...v, [focusObj]: (((v[focusObj] ?? 1) - 1 + dir + VARIANTS) % VARIANTS) + 1 }));
  };
  const onLadder = (a: "propose" | "yes" | "no" | "reset") => {
    setLadder(ladder(ladderState, a));
    if (a !== "reset") setFocusObj(null);
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

  // Back on the first state (after a missed call, an outcome, a skip): [New call] has the focus, Enter dials.
  React.useEffect(() => {
    if (step === "ready" && !paused && !after?.open && !busy) newCallRef.current?.focus({ preventScroll: true });
  }, [step, current?.accountId, paused, after?.open, busy]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (paused) { if (e.key === "Enter" && !isTyping(e.target)) { e.preventDefault(); resume(); } return; }
      if (mailPreview.current) return; // the mail preview: Enter sends, Esc cancels
      if (e.key === "Escape") {
        if (pending) setPending(null);
        else if (after?.open) setAfter({ ...after, open: false });
        else if (focusObj) setFocusObj(null);
        else if (step !== "ready") back();
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
        else if (!listId && /^[0-9+]$/.test(e.key)) phoneRef.current?.focus(); // free dialling: typing a number fills the field
        return;
      }
      if (step === "ringing" || step === "missed") {
        if (digit === 1) { e.preventDefault(); pickedUp(); }
        else if (digit === 2 || k === "x") { e.preventDefault(); logMissed("no_answer"); }
        else if (digit === 3) { e.preventDefault(); logMissed("voicemail"); }
        return;
      }
      if (step === "hungup") {
        if (digit >= 1 && digit <= outcomes.length) { e.preventDefault(); chooseAfter(outcomes[digit - 1]); }
        else if (k === "enter" && suggested) { e.preventDefault(); chooseAfter(suggested); }
        return;
      }
      // live (M and the digits belong to the instant mail)
      if (k === "x") { e.preventDefault(); hangUp(); return; }
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
  const inCall = step !== "ready" && !done;
  const vars = { business: liveTarget?.name, contact: liveTarget?.contact, founder: pb?.founderName, calendly: pb?.links.calendly, deck: lang === "ES" ? pb?.links.deckES : pb?.links.deckFR, thirty: pb?.links.thirty, local_price: pb?.localPrice };
  const opener = pb ? findItem(pb.items, "opener", "default", lang) : null;
  const groups = objectionGroups(objectionOrder(report.data?.mine, report.data?.team));
  const todayCalls = day.data?.tally.calls ?? 0;
  const target = day.data?.targets?.calls?.target ?? 0;
  const chips = after ? templateChips(after.outcome, after.objections, after.target.market, after.offer) : null;
  const mailChips = liveTarget ? inCallChips({ picked: true, market: liveTarget.market, objections: objs, accepted: ladderState.accepted, sent: mailed }) : null;
  const yesCount = s ? s.interested + s.callBacks + s.meetings : 0;
  const afterTpl = after && chips ? after.template ?? chips.suggested : null;
  const afterText = after && afterTpl && instant.playbook ? messageFor(instant.playbook, instant.lang, "email", afterTpl, { name: after.target.name, contact: after.target.contact }) : null;

  // During the call, right column: the stage (mail preview, ladder pitch, reply or the "listen" hint) keeps one size,
  // so a click never moves the page; then the mail chips, then the ladder and [Hung up].
  const liveRight = (mail: { chips: React.ReactNode; preview: React.ReactNode | null } | null) => (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={cn("flex flex-col", mail?.preview ? "lg:h-[clamp(300px,calc(100dvh-350px),460px)]" : "lg:h-[clamp(230px,calc(100dvh-430px),340px)]")}>
        {mail?.preview ?? (ladderState.at === "local" || ladderState.at === "thirty" ? (
          <PitchCard offer={ladderState.at} pb={pb} lang={lang} vars={vars} onAnswer={(yes) => onLadder(yes ? "yes" : "no")} />
        ) : focusObj && pb ? (
          <ReplyCard objection={focusObj} lang={lang} variant={variant[focusObj] ?? 1} onCycle={cycleVariant} pb={pb} vars={vars} stats={report.data?.variants ?? []} best={report.data?.picks[focusObj] ?? null} onClose={() => setFocusObj(null)} />
        ) : (
          <div className="flex h-full min-h-28 flex-col justify-center gap-2 rounded-[18px] bg-subtle/70 p-5">
            <p className="text-[17px] text-text-2">{t("Listen, then tick what you hear")}</p>
            {opener ? <p className="line-clamp-4 text-[15px] leading-relaxed text-text-2"><span className="text-[12px] font-medium uppercase tracking-wide text-text-3">{t("Opener")}</span> · {fill(opener.body, vars)}</p> : null}
          </div>
        ))}
      </div>
      {mail?.preview ? null : mail?.chips}
      {mailed.length && !mail?.preview ? <SentLine s={instant} up /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <LadderBar state={ladderState} onPropose={() => onLadder("propose")} onReset={() => onLadder("reset")} />
        <Button variant="dark" size="lg" onClick={hangUp} className="ml-auto min-w-44"><PhoneOff /> {t("Hung up")} <span className="text-[11px] opacity-60">X</span></Button>
      </div>
    </div>
  );

  return (
    <div data-call-live className={cn("mx-auto flex flex-col gap-3", step === "live" ? "max-w-6xl" : "max-w-3xl")}>
      {/* Session header, sticky: during a call it carries ← Back, who is on the line and the call timer. */}
      <div className="sticky top-14 z-[5] -mx-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-[14px] bg-canvas/95 px-2 py-1.5 backdrop-blur">
        {inCall && !paused ? <Button variant="outline" onClick={back} disabled={log.isPending} className="border-ink"><ChevronLeft /> {t("Back")} <span className="hidden text-[11px] opacity-60 sm:inline">Esc</span></Button> : null}
        <div className="min-w-0 flex-1">
          {inCall && !paused ? (
            <>
              <h1 className="truncate text-lg font-semibold tracking-tight">{listId ? current?.name : phone || t("Free dialling")}</h1>
              {listId && current ? <p className="truncate text-[12px] text-text-2">{[t(current.why), current.niche ? t(current.niche) : "", current.city, current.contactName ? t("Ask for {name}", { name: current.contactName }) : ""].filter(Boolean).join(" · ")}</p> : null}
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold tracking-tight">{listId ? t("Calling") : t("Free dialling")}</h1>
              <p className="num truncate text-sm text-text-2" aria-live="polite">{fmt(sessionSec)}{listId ? ` · ${t("{n} left in list", { n: queue.data?.remaining ?? "…" })}` : ""}{s ? ` · ${t("{n} picked up", { n: s.pickedUp })} · ${t("{n} yes", { n: yesCount })}` : ""}</p>
            </>
          )}
        </div>
        {inCall && !paused ? <span className="num text-3xl font-semibold" aria-label={t("Call timer")}>{fmt(callSec ?? 0)}</span> : null}
        <div className="flex flex-wrap items-center gap-2">
          {undo ? (
            <Button variant="outline" disabled={undoLast.isPending} onClick={() => undoLast.mutate(undo.key)} title={`${t(undo.offer ? AFTER_OUTCOME_LABELS[undo.offer === "local" ? "local_yes" : "thirty_yes"] : CALL_OUTCOME_LABELS[undo.outcome])}${undo.name ? ` · ${undo.name}` : ""}`} className="border-ink">
              <RotateCcw /> <span className="hidden sm:inline">{t("Undo the last call")}</span><span className="sm:hidden">{t("Undo")}</span> <span className="num text-[11px] opacity-70">U · {Math.min(UNDO_SECONDS, Math.max(0, Math.ceil((undo.until - now) / 1000)))}s</span>
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" aria-label={paused ? t("Resume") : t("Pause")} onClick={paused ? resume : pause}>{paused ? <Play /> : <Pause />}</Button>
          <MoreMenu>
            {instant.gmailKnown ? (instant.gmailConnected ? <span className="px-3 py-2 text-[13px] text-text-2">{t("Gmail connected")}</span> : <span className="px-3 py-2"><ConnectGmail compact /></span>) : null}
            <MenuItem onClick={() => openMessage("deck")} hint="P">{t("Send the deck")}</MenuItem>
            <MenuItem onClick={() => void copyCalendly()} hint="C">{t("Copy my Calendly link")}</MenuItem>
            {listId && current && step === "ready" ? <MenuItem onClick={skip} hint="N">{t("Skip this number")}</MenuItem> : null}
            <label className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2 text-[14px] hover:bg-subtle">
              <span>{t("Send instant mails without preview")}</span>
              <input type="checkbox" checked={instant.noPreview} onChange={(e) => instant.setNoPreview(e.target.checked)} className="size-4 accent-[var(--ink)]" />
            </label>
            <p className="max-w-72 px-3 py-2 text-[12px] text-text-3">{t("Enter new call · 1 picked up · 2 not picked up · 3 voicemail · Esc back · letters objections · ← → other reply · M or 1–6 mail preview, Enter sends · O offer Local then 30/30 · Y / N their answer · X hung up · 1–7 outcome · U undo · E message · N skip")}</p>
          </MoreMenu>
          <Button variant="outline" onClick={() => end.mutate()} disabled={end.isPending}>{t("End session")}</Button>
        </div>
      </div>
      {target > 0 && !inCall ? (
        <div aria-label={t("Calls today")}>
          <div className="flex h-2 overflow-hidden rounded-full bg-subtle"><div className="bg-sales transition-[width]" style={{ width: `${Math.min(100, (todayCalls / target) * 100)}%` }} /></div>
          <p className="num mt-1 text-[12px] text-text-2">{t("{n} / {total} calls today", { n: todayCalls, total: target })}</p>
        </div>
      ) : null}

      <ConfirmSent s={instant} />
      {!inCall ? <SentLine s={instant} /> : null}

      {paused ? (
        <Panel className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-xl font-semibold">{t("Paused")}</p>
          <p className="text-sm text-text-2">{t("The session timer is stopped. Your calls are saved.")}</p>
          <Button size="lg" variant="primary" onClick={resume}><Play /> {t("Resume")} <span className="text-[11px] opacity-70">↵</span></Button>
        </Panel>
      ) : (
        <>
          {/* After a call: the message stays one key away (E), folded, never in the way of the next call; it says what it sends. */}
          {after && chips && instant.ready && step === "ready" ? (after.open ? (
            <MessageCard key={after.sendKey} s={instant} target={after.target} chips={chips.chips} suggested={after.template ?? chips.suggested} sendKey={after.sendKey} keys needsBusiness={after.needsBusiness}
              onDone={() => setAfter(null)} onSkip={() => setAfter(null)}
              footer={listId && current && current.accountId !== after.target.accountId ? <span className="ml-auto text-[12px] text-text-3">{t("Next:")} {current.name}</span> : null} />
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-sales/60 bg-panel px-4 py-2" role="status">
              <Mail className="size-4 shrink-0 text-text-2" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate">{t("Mail ready for {name}", { name: after.target.contact || after.target.name || t("the last call") })}{afterTpl ? <b className="font-semibold"> · {t(EMAIL_TEMPLATE_LABELS[afterTpl])}</b> : null}</p>
                <p className="truncate text-[12px] text-text-2">{after.target.email ? `→ ${after.target.email}` : t("No email yet: you add it before sending")}{afterText?.subject ? ` · « ${afterText.subject} »` : ""}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setAfter({ ...after, open: true })}>{t("See and send")} <span className="text-[11px] opacity-60">E</span></Button>
              <Button size="icon" variant="ghost" aria-label={t("No message")} onClick={() => setAfter(null)}><X /></Button>
            </div>
          )) : null}

          <Panel className={cn("flex flex-col gap-4", inCall && "p-4 sm:p-4")}>
            {listId && queue.isPending ? <Skeleton className="h-20" /> : done ? (
              <EmptyState title={t("List finished")} action={<Button variant="primary" size="sm" onClick={() => end.mutate()}>{t("See the session summary")}</Button>}>{t("Everyone in this list has been called today.")}</EmptyState>
            ) : (
              <>
                {step === "ready" ? (
                  <>
                    {listId && current ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[12px] text-text-2">{t(current.why)}{current.niche ? ` · ${t(current.niche)}` : ""}{current.city ? ` · ${current.city}` : ""}</p>
                          <p className="truncate text-2xl font-semibold tracking-tight">{current.name}</p>
                          {current.contactName ? <p className="text-sm text-text-2">{t("Ask for {name}", { name: current.contactName })}</p> : null}
                        </div>
                        <Button variant="ghost" size="sm" aria-label={t("Skip this number (N)")} onClick={skip}><SkipForward /> {t("Skip")}</Button>
                      </div>
                    ) : null}
                    {!listId ? <Input ref={phoneRef} aria-label={t("Number (optional, never stored for a refusal)")} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); newCall(); } }} placeholder={t("Number (optional, never stored for a refusal)")} className="num h-12 text-lg" /> : null}
                    {opener ? (
                      <div className="rounded-[16px] bg-subtle/70 p-4">
                        <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-text-3">{t("Opener")}</p>
                        <p className="text-[18px] leading-relaxed">{fill(opener.body, vars)}</p>
                      </div>
                    ) : null}
                    <Button ref={newCallRef} size="lg" variant="primary" onClick={newCall} disabled={busy} className="h-16 w-full text-lg focus-visible:ring-4 focus-visible:ring-sales/50"><Phone /> {t("New call")} {listId && current ? <span className="num font-normal opacity-90">{current.phone}</span> : null}<span className="text-[12px] opacity-70">↵</span></Button>
                    <button type="button" onClick={logWithoutDial} className="self-center text-[13px] text-text-2 underline">{t("Already called? Log the outcome")}</button>
                  </>
                ) : null}

                {step === "ringing" || step === "missed" ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <BigChoice onClick={pickedUp} tone="win" hint="1">{t("They picked up")}</BigChoice>
                      <BigChoice onClick={() => logMissed("no_answer")} hint="2" disabled={log.isPending}>{t("They did not pick up")}</BigChoice>
                      <BigChoice onClick={() => logMissed("voicemail")} hint="3" disabled={log.isPending}>{t("Voicemail")}</BigChoice>
                    </div>
                    <p className="text-center text-[13px] text-text-2">{t("Not picked up or voicemail: logged at once, the next prospect comes up.")}</p>
                  </>
                ) : null}

                {step === "live" ? (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
                    <ObjectionList groups={groups} on={objs} focus={focusObj} onToggle={toggleObj} className="order-2 lg:order-1" />
                    <div className="order-1 min-w-0 lg:order-2">
                      {liveTarget && mailChips && instant.ready ? (
                        <InCallMail key={key} s={instant} target={liveTarget} chips={mailChips.chips} suggested={mailChips.suggested} sent={mailed} keys needsBusiness={!listId && !known.accountId} onSent={onMailSent} onPreview={setMailPreview} layout={liveRight} />
                      ) : liveRight(null)}
                    </div>
                  </div>
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

      {inCall ? null : <CallLog sessionId={id} title="This session's calls" />}
    </div>
  );
}

/** Every objection at once, grouped (brush-offs, then real objections), each with its letter: no scrolling, no "Others". */
function ObjectionList({ groups, on, focus, onToggle, className }: { groups: { type: ObjectionType; keys: Objection[] }[]; on: Objection[]; focus: Objection | null; onToggle: (o: Objection) => void; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex flex-col gap-3", className)} role="group" aria-label={t("Objections")}>
      {groups.map((g) => (
        <div key={g.type}>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-3">{g.type === "brush_off" ? t("Brush-offs: test them") : t("Real objections: explore")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {g.keys.map((k) => {
              const gd = guideOf(k)!;
              const sel = on.includes(k);
              return (
                <button key={k} type="button" aria-pressed={sel} onClick={() => onToggle(k)} title={t(gd.meaning)}
                  className={cn("flex min-h-11 items-center justify-between gap-2 rounded-[12px] border px-3 py-1 text-left text-[14px] font-medium leading-tight transition-colors", sel ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle", focus === k && "ring-2 ring-sales ring-offset-2 ring-offset-panel")}>
                  <span>{t(OBJECTION_LABELS[k])}</span><span className={cn("shrink-0 rounded border px-1 text-[11px] uppercase", sel ? "border-panel/40 text-panel/70" : "border-hairline text-text-3")}>{gd.hotkey}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[12px] text-text-3">{t("Tap an objection or its letter: its reply shows at once. ← → other reply.")}</p>
    </div>
  );
}

function BigChoice({ onClick, tone, hint, disabled, children }: { onClick: () => void; tone?: "win"; hint: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn("flex min-h-[96px] flex-col disabled:opacity-50 items-center justify-center rounded-[18px] border-2 text-[22px] font-semibold transition-colors", tone === "win" ? "border-win bg-win text-panel hover:opacity-90" : "border-ink bg-panel text-ink hover:bg-subtle")}>
      {children}<span className={cn("text-[13px] font-normal", tone === "win" ? "text-panel/80" : "text-text-3")}>{hint}</span>
    </button>
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
    <div className="flex h-full flex-col rounded-[18px] border-2 border-ink bg-panel p-4" aria-live="assertive">
      <p className="mb-3 text-[15px] font-semibold">{offer === "local" ? t("Offer Local · {price} per month", { price: pb?.localPrice ?? "100 €" }) : t("Offer 30/30")}</p>
      <ol className="mb-3 flex flex-1 flex-col gap-2">{lines.map((l, i) => <li key={i} className={cn("text-[19px] leading-[1.35]", i === 1 && "font-semibold")}>{l}</li>)}</ol>
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
    <div className="h-full overflow-hidden rounded-[18px] border-2 border-ink bg-panel p-4" aria-live="assertive">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[15px] font-semibold">« {t(OBJECTION_LABELS[objection])} »{g?.type === "brush_off" ? <span className="ml-2 text-[13px] font-normal text-text-2">{t("brush-off: test it")}</span> : null}</p>
        <span className="flex items-center gap-1 text-[12px] text-text-3">
          <button type="button" aria-label={t("Previous reply")} onClick={() => onCycle(-1)} className="rounded p-1.5 hover:bg-subtle"><ChevronLeft className="size-5" /></button>
          <span className="num">{t("reply {n}", { n: variant })}{best === variant ? ` · ${t("best")}` : ""}{st ? ` · ${st.won}/${st.uses}` : ""}</span>
          <button type="button" aria-label={t("Next reply")} onClick={() => onCycle(1)} className="rounded p-1.5 hover:bg-subtle"><ChevronRight className="size-5" /></button>
          <button type="button" aria-label={t("Close")} onClick={onClose} className="rounded p-1.5 hover:bg-subtle"><X className="size-5" /></button>
        </span>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span className={cn("mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold", i === 1 ? "bg-ink text-panel" : "bg-subtle text-text-2")}>{i + 1}</span>
            <span>
              <span className="block text-[12px] font-semibold uppercase tracking-wide text-text-3">{t(STEP_NAMES[i] ?? "")}</span>
              <span className={cn("block text-[19px] leading-[1.35]", i === 1 ? "font-semibold" : "font-normal")}>{line}</span>
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
