"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, FileText, Mail, MessageCircle, Send, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import {
  EMAIL_TEMPLATE_LABELS, gmailComposeLink, isCustomKey, type Lang, type TemplateKey,
} from "@/domain/playbook";
import {
  alreadySent, chipLabel, contextOf, customChips, defaultChannel, docsIn, isEmail, isMobileUA, messageFor, missingInfo, sentTo,
  type Channel, type PlaybookData, type SendTarget, type SentRow,
} from "@/domain/messages";
import { normalizeWhatsApp, whatsappChatUrl } from "@/domain/whatsapp";
import { WhatsAppSend, copyToClipboard, isNewNumber } from "./whatsapp-send";
import { useDateTag, useLocale, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Playbook = PlaybookData;
export type { SendTarget };
type Via = "gmail" | "mail_app" | "whatsapp";
/** A message opened in Gmail or WhatsApp, waiting for the founder's "Yes, sent". */
export type PendingSend = { id: string; channel: Channel; target: SendTarget; template: string; key: string; to: string; subject: string; body: string; business: string; saveAddress?: boolean; savePhone?: boolean };
export type Draft = Omit<PendingSend, "id">;
/** A message confirmed as sent (Gmail sent it, or the founder confirmed "Yes, sent"). */
export type LastSent = { id: string; channel: Channel; to: string; name: string; subject: string; body: string; template: string; accountId: string; via: Via };
const NO_PREVIEW_KEY = "vos-mail-no-preview";
const noPreviewListeners = new Set<() => void>();
const readNoPreview = () => { try { return localStorage.getItem(NO_PREVIEW_KEY) === "1"; } catch { return false; } };
const subscribeNoPreview = (cb: () => void) => { noPreviewListeners.add(cb); return () => { noPreviewListeners.delete(cb); }; };
const setNoPreview = (v: boolean) => { try { localStorage.setItem(NO_PREVIEW_KEY, v ? "1" : "0"); } catch { /* convenience only */ } noPreviewListeners.forEach((l) => l()); };

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);

/**
 * One click = the message goes out. Email: sent by Gmail when connected; otherwise Gmail opens in a new tab,
 * prefilled. WhatsApp: WhatsApp Web on a computer, the app on a phone. Suppression and consent are checked by the
 * server first; nothing counts until confirmed. Coming back to the tab shows "Sent?" with Yes as the default (Enter).
 * A pending confirmation never blocks the next call: it waits in a slim bar.
 */
export function useInstantSend(sessionId?: string) {
  const t = useT();
  const qc = useQueryClient();
  const lang: Lang = useLocale() === "es" ? "ES" : "FR";
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean; sender?: string }>("/api/email/status") });
  const [pending, setPending] = React.useState<PendingSend[]>([]);
  const [returned, setReturned] = React.useState(false);
  // The last message that really went out, shown as "Mail sent to X: subject" with the full text one click away (D076).
  const [lastSent, setLastSent] = React.useState<LastSent | null>(null);
  // "Send without preview" (D076): off by default; a per-browser convenience, not business data.
  const noPreview = React.useSyncExternalStore(subscribeNoPreview, readNoPreview, () => false);
  const refresh = () => ["call-summary", "my-day", "email-sends", "email-queue", "call-log"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const payload = (d: Draft, via: Via, checkOnly = false) => ({
    save_address: Boolean(d.saveAddress), save_phone: Boolean(d.savePhone),
    idempotency_key: d.key, channel: d.channel, via, context: contextOf(d.template), account_id: d.target.accountId, call_session_id: sessionId ?? "",
    to: d.to.trim(), subject: d.subject, body: d.body, template_key: d.template, language: lang, market: d.target.market,
    business_name: d.target.accountId ? "" : d.business.trim(), contact_name: d.target.contact, check_only: checkOnly,
  });
  const record = useMutation({
    mutationFn: (a: { d: Draft; via: Via; pendingId?: string }) => api<{ send: { account_id: string } | null }>("/api/email/send", { body: payload(a.d, a.via) }),
    onSuccess: (_r, a) => {
      setLastSent({ id: crypto.randomUUID(), channel: a.d.channel, to: a.d.to.trim(), name: a.d.target.contact || a.d.target.name || a.d.to.trim(), subject: a.d.subject, body: a.d.body, template: a.d.template, accountId: a.d.target.accountId, via: a.via });
      toast(a.via === "gmail" ? t("Email sent to {name}", { name: a.d.target.contact || a.d.target.name || a.d.to }) : a.d.channel === "email" ? t("Email sent and logged") : t("WhatsApp logged"));
      if (a.pendingId) setPending((p) => p.filter((x) => x.id !== a.pendingId));
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError && e.body.error === "consent_required" ? t("Connect Gmail first") : (e as Error).message),
  });
  // Back from Gmail / WhatsApp: the confirmation comes forward, Yes is the default.
  React.useEffect(() => {
    if (!pending.length) return;
    const back = () => { if (document.visibilityState === "visible") setReturned(true); };
    const away = () => { if (document.visibilityState === "hidden") setReturned(false); };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    document.addEventListener("visibilitychange", away);
    return () => { window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back); document.removeEventListener("visibilitychange", away); };
  }, [pending.length]);

  /**
   * Sends or opens the message. Resolves with where it went (Gmail: sent, with the business it was logged on; tab:
   * opened, "Sent?" follows) or false when blocked.
   */
  const send = async (d: Draft): Promise<false | { via: Via; accountId: string }> => {
    if (d.channel === "email" && gmail.data?.connected) {
      try { const r = await record.mutateAsync({ d, via: "gmail" }); return { via: "gmail", accountId: r.send?.account_id ?? d.target.accountId }; } catch { return false; }
    }
    // Open the tab now (still inside the click, so it is not blocked), point it once the server said OK.
    const w = window.open("", "_blank");
    try {
      await api("/api/email/send", { body: payload(d, d.channel === "email" ? "mail_app" : "whatsapp", true) });
    } catch (e) {
      w?.close();
      toast(e instanceof ApiError && e.body.error === "consent_required" ? t("Connect Gmail first") : (e as Error).message);
      return false;
    }
    // Gmail opens on the Valemont sending mailbox (authuser, D090); WhatsApp opens a NEW chat to the E.164 number.
    const wa = d.channel === "whatsapp" ? normalizeWhatsApp(d.to, d.target.market) : null;
    const url = d.channel === "email" ? gmailComposeLink(d.to.trim(), d.subject, d.body, pb.data?.sender ?? "") : whatsappChatUrl(wa?.ok ? wa.e164 : d.to.trim(), d.body, isMobileUA(navigator.userAgent));
    if (w) w.location.href = url; else window.open(url, "_blank", "noopener");
    setReturned(false);
    setPending((p) => [{ ...d, id: crypto.randomUUID() }, ...p.filter((x) => x.key !== d.key)]);
    return { via: d.channel === "email" ? "mail_app" : "whatsapp", accountId: d.target.accountId };
  };
  const confirm = (p: PendingSend) => record.mutate({ d: p, via: p.channel === "email" ? "mail_app" : "whatsapp", pendingId: p.id });
  const dismiss = (p: PendingSend) => setPending((x) => x.filter((y) => y.id !== p.id));
  return {
    send, pending, returned, confirm, dismiss, busy: record.isPending, lastSent, clearLast: () => setLastSent(null), noPreview, setNoPreview, ready: Boolean(pb.data), gmailConnected: Boolean(gmail.data?.connected), gmailKnown: gmail.isSuccess, playbook: pb.data ?? null, lang,
  };
}
export type InstantSend = ReturnType<typeof useInstantSend>;

/**
 * "Sent?" for each message opened in another tab. Slim, never blocking; once the founder is back on the tab it is
 * highlighted and Enter answers Yes (the call screen keeps working: Enter only confirms while this bar is highlighted).
 */
export function ConfirmSent({ s }: { s: InstantSend }) {
  const t = useT();
  const first = s.pending[0];
  React.useEffect(() => {
    if (!first || !s.returned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      s.confirm(first);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  if (!first) return null;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      {s.pending.map((p, i) => (
        <div key={p.id} role="status" className={cn("flex flex-wrap items-center gap-2 rounded-[14px] border px-4 py-2.5", i === 0 && s.returned ? "border-2 border-ink bg-panel" : "border-hairline bg-panel")}>
          {p.channel === "email" ? <Mail className="size-4 text-text-2" /> : <MessageCircle className="size-4 text-text-2" />}
          <p className="min-w-0 flex-1 text-sm">
            <b className="font-semibold">{p.target.contact || p.target.name || p.to}</b> · {templateTitle(t, s.playbook, p.template)} · {p.channel === "email" ? t("Gmail opened. Sent?") : t("WhatsApp opened. Sent?")}
          </p>
          <Button size="sm" variant="primary" disabled={s.busy} onClick={() => s.confirm(p)} autoFocus={i === 0 && s.returned}><Check /> {t("Yes, sent")}{i === 0 && s.returned ? <span className="text-[11px] opacity-70">↵</span> : null}</Button>
          <Button size="sm" variant="ghost" onClick={() => s.dismiss(p)}><X /> {t("Not sent")}</Button>
        </div>
      ))}
    </div>
  );
}

/** Messages already sent to this business, to avoid sending the same thing twice. */
export function useSentRows() {
  return useQuery({ queryKey: ["email-sends"], queryFn: () => api<SentRow[]>("/api/email/sends"), staleTime: 15_000 });
}

/** "Connect Gmail" explained once: it is what makes an email truly one click. Dismissal is a per-browser convenience. */
export function ConnectGmail({ back = "/call", compact = false }: { back?: string; compact?: boolean }) {
  const t = useT();
  const [hidden, setHidden] = React.useState(() => { try { return localStorage.getItem("vos-gmail-hint") === "1"; } catch { return false; } });
  const status = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean; sender?: string }>("/api/email/status") });
  const sender = status.data?.sender ?? "";
  if (compact) return <a className="text-[12px] font-medium underline" href={`/api/auth/google/gmail?back=${back}`}>{t("Connect Gmail")}</a>;
  if (hidden) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-subtle px-4 py-3">
      <Mail className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm"><b className="font-semibold">{t("Connect Gmail: emails leave in one click.")}</b> <span className="text-text-2">{t("No tab to open, nothing to paste. Send only: Valemont OS never reads your inbox.")}</span>{" "}{sender ? <span className="font-medium">{t("Sign in with {sender}: every client email leaves from it.", { sender })}</span> : <span className="text-bad">{t("Set the sending address first: Settings › Workspace.")}</span>}</p>
      <Button asChild size="sm" variant="primary"><a href={`/api/auth/google/gmail?back=${back}`}>{t("Connect Gmail")}</a></Button>
      <Button size="icon" variant="ghost" aria-label={t("Hide")} onClick={() => { setHidden(true); try { localStorage.setItem("vos-gmail-hint", "1"); } catch { /* convenience only */ } }}><X /></Button>
    </div>
  );
}

/** A template's full title: the built-in label (translated) or the founder's own name for a custom template. */
export function templateTitle(t: (k: string, v?: Record<string, string | number>) => string, pb: PlaybookData | null | undefined, k: string): string {
  if (isCustomKey(k)) return chipLabel(pb, k).text;
  return EMAIL_TEMPLATE_LABELS[k as TemplateKey] ? t(EMAIL_TEMPLATE_LABELS[k as TemplateKey]) : k;
}
/** A chip's short label: built-in (translated) or custom (the founders' own words, never translated). */
export function chipText(t: (k: string) => string, pb: PlaybookData | null | undefined, k: string): string {
  const l = chipLabel(pb, k);
  return l.custom ? l.text : t(l.text);
}

/** "Sent from contact@…" (D090): every client email leaves from the shared Valemont address. */
export function SenderLine({ sender, className }: { sender: string | undefined; className?: string }) {
  const t = useT();
  return sender
    ? <span className={cn("text-text-3", className)}>{t("Sent from {address}", { address: sender })}</span>
    : <span className={cn("text-bad", className)}>{t("No sending address yet: set it in Settings › Workspace.")}</span>;
}

/**
 * The message card, inline (no dialog): who it goes to (editable, missing info asked right there), template chips
 * (the suggested one first, then the founders' own templates), subject and text editable in place, the founder's
 * signature and language, the documents travelling as links, and one big Send with the channel. WhatsApp (D090): the
 * number (any number can be typed, read back in E.164), "Copy the text" and "Open WhatsApp" (a new chat with the text).
 * Keys when `keys`: E email, W WhatsApp, Esc skip.
 */
export function MessageCard({ s, target, chips: baseChips, suggested, sendKey, needsBusiness = false, keys = false, gmailHint = true, title, onDone, onSkip, footer }: {
  s: InstantSend; target: SendTarget; chips: readonly string[]; suggested: string | null; sendKey: string; needsBusiness?: boolean; keys?: boolean; gmailHint?: boolean; title?: React.ReactNode;
  onDone: (channel: Channel) => void; onSkip?: () => void; footer?: React.ReactNode;
}) {
  const t = useT();
  const tag = useDateTag();
  const pb = s.playbook;
  const lang = s.lang;
  const sends = useSentRows();
  const [channel, setChannel] = React.useState<Channel>(() => defaultChannel(target));
  // Built-in chips, then the founders' own templates for this channel (Settings › Templates).
  const chips = React.useMemo(() => [...baseChips, ...customChips(pb, channel, lang)], [baseChips, pb, channel, lang]);
  const [tplState, setTpl] = React.useState<string>(suggested ?? baseChips[0] ?? "thanks");
  // A custom template belongs to one channel: switching channel falls back to the first chip.
  const tpl = chips.includes(tplState) ? tplState : chips[0] ?? "thanks";
  const [email, setEmail] = React.useState(target.email);
  const [phone, setPhone] = React.useState(target.phone);
  const [savePhone, setSavePhone] = React.useState(false);
  const [business, setBusiness] = React.useState(target.name);
  const textOf = React.useCallback((c: Channel, k: string) => (pb ? messageFor(pb, lang, c, k, { name: business, contact: target.contact }) : { subject: "", body: "" }), [pb, lang, business, target.contact]);
  // The text follows the template, channel and playbook until the founder edits it (an edit sticks to that channel + template).
  const [draft, setDraft] = React.useState<{ k: string; subject: string; body: string } | null>(null);
  const draftKey = `${channel}:${tpl}`;
  const edited = draft?.k === draftKey;
  const text = edited ? draft : textOf(channel, tpl);
  const setText = (v: { subject: string; body: string }) => setDraft({ k: draftKey, subject: v.subject, body: v.body });
  const [busy, setBusy] = React.useState(false);
  const missing = channel === "email" ? missingInfo("email", email, { needsBusiness, business, body: text.body }) : missingInfo("whatsapp", "00000000", { needsBusiness, business, body: text.body });
  const docs = pb ? docsIn(text.body, pb.links) : [];
  const deckUrl = pb ? (lang === "ES" ? pb.links.deckES : pb.links.deckFR) : "";
  const history = sentTo(sends.data ?? [], target.accountId);
  const dup = alreadySent(sends.data ?? [], target.accountId, tpl);
  const pick = (k: string) => setTpl(k);
  const switchTo = (c: Channel) => setChannel(c);
  const addDoc = (kind: "deck" | "calendly") => {
    const url = kind === "deck" ? deckUrl : pb?.links.calendly ?? "";
    if (!url || text.body.includes(url)) return;
    const label = kind === "deck" ? (lang === "ES" ? "Presentación:" : "Présentation :") : lang === "ES" ? "Reservar 15 minutos:" : "Réserver 15 minutes :";
    const sig = text.body.lastIndexOf("\n\n");
    const body = channel === "whatsapp" || sig < 0 ? `${text.body} ${url}` : `${text.body.slice(0, sig)}\n\n${label} ${url}${text.body.slice(sig)}`;
    setText({ ...text, body });
  };
  // One key per channel: a WhatsApp confirmed for this person never swallows a later email (or the reverse).
  const [keyOf] = React.useState(() => ({ email: sendKey, whatsapp: crypto.randomUUID() }));
  const go = async (c: Channel = channel) => {
    if (busy || !pb) return;
    // E / W send right away on that channel, unless the founder edited the other channel's text (then: switch first).
    if (c !== channel && edited) { switchTo(c); return; }
    const k = c === channel ? tpl : chips.includes(tpl) && !isCustomKey(tpl) ? tpl : baseChips[0] ?? tpl;
    const msg = c === channel ? text : textOf(c, k);
    const wa = c === "whatsapp" ? normalizeWhatsApp(phone, target.market) : null;
    const dest = c === "email" ? email : wa?.ok ? wa.e164 : "";
    const miss = missingInfo(c, dest, { needsBusiness, business, body: msg.body });
    if (miss.length) {
      if (c !== channel) switchTo(c);
      toast(miss.includes("link") ? t("A link is missing. Add it in Settings › Workspace.") : miss.includes("business") ? t("Name the business first.") : c === "email" ? t("Add the email address first.") : phone.trim() ? t("This WhatsApp number is not valid.") : t("Add the WhatsApp number first."));
      setTimeout(() => document.getElementById(miss.includes("business") ? `mc-biz-${sendKey}` : c === "email" ? `mc-to-${sendKey}` : `mc-wa-${sendKey}`)?.focus(), 0);
      return;
    }
    setBusy(true);
    const canSave = c === "whatsapp" && Boolean(target.accountId) && isNewNumber(phone, target.phone, target.market);
    const ok = await s.send({ channel: c, target: { ...target, name: business, email, phone: dest || phone }, template: k, key: keyOf[c], to: dest, subject: msg.subject, body: msg.body, business, savePhone: canSave && savePhone });
    setBusy(false);
    if (ok) onDone(c);
  };
  React.useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "e") { e.preventDefault(); void go("email"); }
      else if (k === "w") { e.preventDefault(); void go("whatsapp"); }
      else if (e.key === "Enter") { e.preventDefault(); void go(); }
      else if (e.key === "Escape" && onSkip) { e.preventDefault(); onSkip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const sendLabel = s.gmailConnected ? t("Send with Gmail") : t("Open in Gmail");
  return (
    <section aria-label={t("Message card")} className="flex flex-col gap-3 rounded-[18px] border-2 border-sales bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{title ?? t("Message for {name}", { name: target.contact || target.name || t("the last call") })}</p>
          {history.length ? (
            <p className={cn("text-[12px]", dup ? "font-medium text-bad" : "text-text-2")}>
              {dup ? t("Already sent:") : t("Sent before:")} {history.slice(0, 3).map((h) => `${chipText(t, pb, h.template)} (${h.channel === "email" ? t("Email") : "WhatsApp"}, ${new Date(h.at).toLocaleDateString(tag, { day: "numeric", month: "short" })})`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div role="radiogroup" aria-label={t("Channel")} className="inline-flex rounded-full bg-subtle p-1">
          {(["email", "whatsapp"] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => switchTo(c)} className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium", channel === c ? "bg-panel text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-2")}>
              {c === "email" ? <Mail className="size-3.5" /> : <MessageCircle className="size-3.5" />}{c === "email" ? t("Email") : "WhatsApp"}<span className="text-[11px] opacity-60">{c === "email" ? "E" : "W"}</span>
            </button>
          ))}
        </div>
      </div>

      {channel === "email" || needsBusiness ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
          {channel === "email" ? (
            <>
              <label htmlFor={`mc-to-${sendKey}`} className="text-[12px] font-medium text-text-2">{t("To")}</label>
              <Input id={`mc-to-${sendKey}`} type="email" value={email} autoFocus={missing.includes("email")} onChange={(e) => setEmail(e.target.value)}
                placeholder={t("Their email address")} className={cn("h-9", missing.includes("email") && "border-bad")} />
            </>
          ) : null}
          {needsBusiness ? (
            <>
              <label htmlFor={`mc-biz-${sendKey}`} className="text-[12px] font-medium text-text-2">{t("Business")}</label>
              <Input id={`mc-biz-${sendKey}`} value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={t("Business name (required to follow up)")} className={cn("h-9", missing.includes("business") && "border-bad")} />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Template")}>
        {chips.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={tpl === k} onClick={() => pick(k)}
            className={cn("min-h-8 rounded-full border px-3 text-[13px]", tpl === k ? "border-ink bg-ink text-panel" : isCustomKey(k) ? "border-dashed border-control bg-panel hover:bg-subtle" : "border-control bg-panel hover:bg-subtle")}>
            {chipText(t, pb, k)}{k === suggested ? <span className={cn("ml-1 text-[11px]", tpl === k ? "text-panel/70" : "text-text-3")}>· {t("suggested")}</span> : null}
          </button>
        ))}
      </div>

      {channel === "email" ? <Input aria-label={t("Subject")} value={text.subject} onChange={(e) => setText({ ...text, subject: e.target.value })} className="h-9 font-medium" /> : null}
      <Textarea aria-label={t("Message")} rows={channel === "email" ? 7 : 4} value={text.body} onChange={(e) => setText({ ...text, body: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go(); } }} className="text-[14px] leading-relaxed" />

      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="text-text-3">{t("Documents:")}</span>
        {(["deck", "calendly"] as const).map((k) => {
          const on = docs.some((d) => d.kind === k);
          const url = k === "deck" ? deckUrl : pb?.links.calendly;
          return (
            <button key={k} type="button" disabled={on || !url} onClick={() => addDoc(k)} title={url || t("Add the link in Settings › Workspace")}
              className={cn("flex min-h-7 items-center gap-1 rounded-full border px-2.5", on ? "border-sales bg-sales/10 text-ink" : "border-dashed border-control text-text-2 hover:bg-subtle", !url && "opacity-50")}>
              {k === "deck" ? <FileText className="size-3.5" /> : <CalendarDays className="size-3.5" />}{k === "deck" ? t("Deck") : "Calendly"}{on ? <Check className="size-3" /> : " +"}
            </button>
          );
        })}
        <span className="ml-auto text-text-3">{t("Signed {name}", { name: pb?.founderName ?? "" })} · {lang === "ES" ? t("in Spanish") : t("in French")}</span>
        {channel === "email" ? <SenderLine sender={pb?.sender} className="basis-full text-right" /> : null}
      </div>
      {missing.includes("link") ? <p className="text-[12px] text-bad">{t("A link is missing. Add it in Settings › Workspace.")}</p> : null}
      {gmailHint && channel === "email" && s.gmailKnown && !s.gmailConnected ? <ConnectGmail /> : null}

      {channel === "whatsapp" ? (
        <WhatsAppSend id={`mc-wa-${sendKey}`} phone={phone} onPhone={setPhone} market={target.market} text={text.body} busy={busy || s.busy || !pb}
          canSave={Boolean(target.accountId) && isNewNumber(phone, target.phone, target.market)} save={savePhone} onSave={setSavePhone}
          onOpen={() => void go("whatsapp")}
          extra={<>{onSkip ? <Button variant="ghost" onClick={onSkip}>{t("No message")} <span className="text-[11px] opacity-60">Esc</span></Button> : null}{footer}</>} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" variant="primary" disabled={busy || s.busy || !pb} onClick={() => void go()} className="min-w-48 flex-1 sm:flex-none">
            {s.gmailConnected ? <Send /> : <Mail />} {busy ? t("Sending…") : sendLabel} {keys ? <span className="text-[11px] opacity-70">↵</span> : null}
          </Button>
          <Button variant="ghost" onClick={async () => { toast((await copyToClipboard(`${text.subject}\n\n${text.body}`)) ? t("Copied") : t("Could not copy. Select the text and copy it.")); }}><Copy /> {t("Copy")}</Button>
          {onSkip ? <Button variant="ghost" onClick={onSkip}>{t("No message")} <span className="text-[11px] opacity-60">Esc</span></Button> : null}
          {footer}
        </div>
      )}
      {lang === "ES" && contextOf(tpl) === "cold" ? <p className="text-[12px] text-text-3">{t("Spain: a message to someone you have not talked to needs prior consent (LSSI art. 21).")}</p> : null}
    </section>
  );
}

/** Small helper for callers: the suggested template's label. */
export const templateLabel = (k: TemplateKey) => EMAIL_TEMPLATE_LABELS[k];

/**
 * "Mail sent to X: subject", with the exact text one click away ("See it", a floating card: no layout jump).
 * `up` opens the card above the line (used low on the call screen).
 */
export function SentLine({ s, up = false }: { s: InstantSend; up?: boolean }) {
  const t = useT();
  const l = s.lastSent;
  const [show, setShow] = React.useState<string | null>(null);
  if (!l) return null;
  const open = show === l.id;
  return (
    <div role="status" aria-live="polite" className="relative flex min-h-9 items-center gap-2 rounded-[12px] bg-win/10 px-3 text-[13px]">
      <Check className="size-4 shrink-0 text-win" />
      <span className="min-w-0 flex-1 truncate">{l.channel === "email" ? t("Mail sent to {name}: {subject}", { name: l.name, subject: l.subject || chipText(t, s.playbook, l.template) }) : t("WhatsApp sent to {name}", { name: l.name })}</span>
      <button type="button" aria-expanded={open} onClick={() => setShow(open ? null : l.id)} className="shrink-0 font-medium underline">{open ? t("Hide") : t("See it")}</button>
      <button type="button" aria-label={t("Close")} onClick={() => { setShow(null); s.clearLast(); }} className="shrink-0 rounded p-1 text-text-2 hover:bg-panel"><X className="size-4" /></button>
      {open ? (
        <div className={cn("absolute inset-x-0 z-30 max-h-80 overflow-auto rounded-[14px] border border-hairline bg-panel p-3 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.12)]", up ? "bottom-full mb-1" : "top-full mt-1")}>
          <p><span className="text-text-3">{t("To")}</span> {l.to}</p>
          {l.subject ? <p className="font-semibold">{l.subject}</p> : null}
          <p className="mt-2 whitespace-pre-line leading-relaxed">{l.body}</p>
        </div>
      ) : null}
    </div>
  );
}

type PreviewValues = { to: string; business: string; subject: string; body: string };
/**
 * Exactly what goes out, before it goes (D076): recipient, subject and full text in the founder's language with their
 * signature, all editable in place. Send = Enter (the Send button has the focus; Ctrl/⌘ + Enter from the text);
 * Cancel = Esc. A missing address (or business, in free dialling) gets the focus first.
 */
export function MailPreview({ s, template, initial, needsBusiness, busy, onSend, onCancel, className }: {
  s: InstantSend; template: string; initial: PreviewValues; needsBusiness: boolean; busy: boolean; onSend: (v: PreviewValues) => void; onCancel: () => void; className?: string;
}) {
  const t = useT();
  const [v, setV] = React.useState(initial);
  const okTo = isEmail(v.to);
  const okBiz = !needsBusiness || Boolean(v.business.trim());
  const id = React.useId();
  const submit = () => {
    if (!okTo) { if (v.to.trim()) toast(t("Check the email address.")); document.getElementById(`${id}-to`)?.focus(); return; }
    if (!okBiz) { document.getElementById(`${id}-biz`)?.focus(); return; }
    onSend(v);
  };
  return (
    <form aria-label={t("Mail preview")} onSubmit={(e) => { e.preventDefault(); submit(); }} className={cn("flex flex-col gap-2 rounded-[18px] border-2 border-sales bg-panel p-3", className)}>
      <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
        <Mail className="size-4 text-text-2" />
        <span className="font-semibold">{templateTitle(t, s.playbook, template)}</span>
        <span className="ml-auto text-text-3">{t("Signed {name}", { name: s.playbook?.founderName ?? "" })} · {s.lang === "ES" ? t("in Spanish") : t("in French")}</span>
        <SenderLine sender={s.playbook?.sender} className="basis-full text-right text-[12px]" />
      </p>
      <div className={cn("grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5", needsBusiness && "sm:grid-cols-[auto_1fr_auto_1fr]")}>
        <label htmlFor={`${id}-to`} className="text-[12px] font-medium text-text-2">{t("To")}</label>
        <Input id={`${id}-to`} type="email" inputMode="email" autoComplete="off" value={v.to} placeholder={t("Their email address")} autoFocus={!okTo}
          onChange={(e) => setV({ ...v, to: e.target.value })} className={cn("h-9", !okTo && v.to.trim() && "border-bad")} />
        {needsBusiness ? (
          <>
            <label htmlFor={`${id}-biz`} className="text-[12px] font-medium text-text-2">{t("Business")}</label>
            <Input id={`${id}-biz`} value={v.business} placeholder={t("Business name (required to follow up)")} autoFocus={okTo && !okBiz} onChange={(e) => setV({ ...v, business: e.target.value })} className="h-9" />
          </>
        ) : null}
        <label htmlFor={`${id}-subj`} className="text-[12px] font-medium text-text-2">{t("Subject")}</label>
        <Input id={`${id}-subj`} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} className={cn("h-9 font-medium", needsBusiness && "sm:col-span-3")} />
      </div>
      <Textarea aria-label={t("Message")} rows={5} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} className="min-h-[120px] flex-1 resize-none text-[13px] leading-relaxed" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || !s.playbook} autoFocus={okTo && okBiz}>
          {s.gmailConnected ? <Send /> : <Mail />} {busy ? t("Sending…") : s.gmailConnected ? t("Send with Gmail") : t("Open in Gmail")} <span className="text-[11px] opacity-70">↵</span>
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("Cancel")} <span className="text-[11px] opacity-60">Esc</span></Button>
        <span className="ml-auto text-[12px] text-text-3">{s.gmailConnected ? t("sent by Gmail") : t("opens Gmail")}</span>
      </div>
    </form>
  );
}

/**
 * Instant mail while still on the phone (D071, iteration 10 D076). Hovering or focusing a chip shows what it sends
 * (floating card, no layout jump); a click (or its digit, or M for the suggested one) opens the editable preview with
 * Send (Enter) / Cancel (Esc). "Send without preview" (… menu, off by default) sends at once when the address is known.
 * No address known: the preview asks for it (kept on the business, `save_address`). Logged in EmailSends with the call
 * session and the business; one idempotency key per chip and call. `layout` places the preview and the chips.
 */
export function InCallMail({ s, target, chips, suggested, sent, keys, needsBusiness, onSent, onPreview, layout }: {
  s: InstantSend; target: SendTarget; chips: TemplateKey[]; suggested: TemplateKey | null; sent: readonly TemplateKey[]; keys: boolean; needsBusiness: boolean;
  onSent: (k: TemplateKey, r: { accountId: string; email: string; business: string }) => void;
  onPreview?: (open: boolean) => void;
  layout?: (p: { chips: React.ReactNode; preview: React.ReactNode | null }) => React.ReactNode;
}) {
  const t = useT();
  const pb = s.playbook;
  const [email, setEmail] = React.useState(target.email);
  const [business, setBusiness] = React.useState(target.name);
  const [open, setOpenState] = React.useState<TemplateKey | null>(null);
  const [peek, setPeek] = React.useState<TemplateKey | null>(null);
  const [busy, setBusy] = React.useState<TemplateKey | null>(null);
  const [keyOf] = React.useState(() => new Map<TemplateKey, string>());
  const idem = (k: TemplateKey) => { if (!keyOf.has(k)) keyOf.set(k, crypto.randomUUID()); return keyOf.get(k)!; };
  const textOf = (k: TemplateKey) => (pb ? messageFor(pb, s.lang, "email", k, { name: business, contact: target.contact }) : { subject: "", body: "" });
  // The caller hears about it at once (not after the next render), so a key pressed right after Esc is not swallowed.
  // `onPreview` must be stable (useCallback).
  const setOpen = (k: TemplateKey | null) => { setOpenState(k); onPreview?.(k !== null); };
  React.useEffect(() => () => onPreview?.(false), [onPreview]);
  const send = async (k: TemplateKey, v: PreviewValues) => {
    if (busy || !pb) return;
    if (missingInfo("email", v.to, { body: v.body }).includes("link")) { toast(t("A link is missing. Add it in Settings › Workspace.")); return; }
    setBusy(k);
    const to = v.to.trim();
    const r = await s.send({ channel: "email", target: { ...target, name: v.business, email: to }, template: k, key: idem(k), to, subject: v.subject, body: v.body, business: v.business, saveAddress: to !== target.email.trim() });
    setBusy(null);
    if (r) { setEmail(to); setBusiness(v.business); setOpen(null); onSent(k, { accountId: r.accountId, email: to, business: v.business }); }
  };
  const choose = (k: TemplateKey | undefined) => {
    if (!k || busy || !pb || sent.includes(k)) return;
    setPeek(null);
    if (s.noPreview && isEmail(email) && (!needsBusiness || business.trim())) { void send(k, { to: email, business, ...textOf(k) }); return; }
    setOpen(k);
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (open) {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setOpen(null); }
        return;
      }
      if (!keys || isTyping(e.target)) return;
      const d = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2];
      if (d && Number(d) <= chips.length) { e.preventDefault(); e.stopImmediatePropagation(); choose(chips[Number(d) - 1]); }
      else if (e.key.toLowerCase() === "m") { e.preventDefault(); e.stopImmediatePropagation(); choose(suggested ?? chips.find((k) => !sent.includes(k))); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const peekText = peek && !open ? textOf(peek) : null;
  const chipsEl = (
    <div className="relative flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Instant mail")}>
      <span className="flex max-w-[40%] items-center gap-1 text-[12px] text-text-2" title={isEmail(email) ? email : t("No email yet: type it as they spell it")}>
        <Mail className="size-4 shrink-0" /><span className="truncate">{isEmail(email) ? email : t("no email")}</span>
      </span>
      {chips.map((k) => {
        const done = sent.includes(k);
        return (
          <button key={k} type="button" disabled={done || busy !== null} onClick={() => choose(k)} aria-label={`${chipText(t, pb, k)}${done ? ` · ${t("sent")}` : ""}`} aria-expanded={open === k}
            onMouseEnter={() => setPeek(k)} onMouseLeave={() => setPeek((p) => (p === k ? null : p))} onFocus={() => setPeek(k)} onBlur={() => setPeek((p) => (p === k ? null : p))}
            className={cn("flex min-h-9 items-center gap-1 rounded-full border px-3 text-[13px] font-medium transition-colors disabled:cursor-default",
              done ? "border-win bg-win/10 text-ink" : open === k ? "border-sales bg-sales/10" : k === suggested ? "border-ink bg-ink text-panel hover:opacity-90" : "border-control bg-panel hover:bg-subtle")}>
            {done ? <Check className="size-4" /> : busy === k ? <Send className="size-4 animate-pulse" /> : null}
            {chipText(t, pb, k)}
          </button>
        );
      })}
      {peekText && peek ? (
        <div aria-hidden className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-full max-w-xl rounded-[14px] border border-hairline bg-panel p-3 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <p className="text-text-2">{templateTitle(t, pb, peek)} · <span className="text-text-3">{t("To")}</span> {isEmail(email) ? email : t("address asked before sending")}</p>
          <p className="mt-1 font-semibold">{peekText.subject}</p>
          <p className="mt-1 line-clamp-6 whitespace-pre-line leading-relaxed">{peekText.body}</p>
          <p className="mt-2 text-[12px] text-text-3">{t("Click: check and send")}</p>
        </div>
      ) : null}
    </div>
  );
  const preview = open && pb ? (
    <MailPreview key={open} s={s} template={open} initial={{ to: email, business, ...textOf(open) }} needsBusiness={needsBusiness} busy={busy !== null || s.busy}
      onSend={(v) => void send(open, v)} onCancel={() => setOpen(null)} className="h-full" />
  ) : null;
  if (layout) return <>{layout({ chips: chipsEl, preview })}</>;
  return <div className="flex flex-col gap-2">{preview}{chipsEl}</div>;
}

const GMAIL_ERRORS: Record<string, string> = {
  wrong_account: "Sign in with {sender} (Valemont's sending address).",
  no_sender: "Set the sending address first: Settings › Workspace.",
  unverified: "Google did not confirm this address. Sign in with {sender} (Valemont's sending address).",
  no_email: "Google did not say which mailbox you used. Sign in with {sender} (Valemont's sending address).",
  not_granted: "Gmail sending was not allowed. Try again and tick “Send email on your behalf”.",
  state: "The Gmail connection expired. Try again.",
  oauth: "Google refused the connection. Try again.",
  unavailable: "Gmail cannot be connected here.",
};
/**
 * Back from the Gmail consent with `?gmail_error=` (D090): says why in plain words (the wrong mailbox names the
 * sending address to use), once, then cleans the address bar. Mounted once in the shell.
 */
export function GmailErrorNotice() {
  const t = useT();
  React.useEffect(() => {
    const u = new URL(window.location.href);
    const e = u.searchParams.get("gmail_error");
    if (!e) return;
    const sender = u.searchParams.get("gmail_sender") ?? "";
    toast(t(GMAIL_ERRORS[e] ?? GMAIL_ERRORS.oauth, { sender: sender || "…" }), { duration: 20_000 });
    u.searchParams.delete("gmail_error");
    u.searchParams.delete("gmail_sender");
    window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
  }, [t]);
  return null;
}
