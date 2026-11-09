"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, FileText, Mail, MessageCircle, Send, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import {
  EMAIL_TEMPLATE_LABELS, TEMPLATE_SHORT, gmailComposeLink, whatsappSendLink, type Lang, type TemplateKey,
} from "@/domain/playbook";
import {
  alreadySent, contextOf, defaultChannel, docsIn, isMobileUA, messageFor, missingInfo, sentTo,
  type Channel, type PlaybookData, type SendTarget, type SentRow,
} from "@/domain/messages";
import { useDateTag, useLocale, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Playbook = PlaybookData;
export type { SendTarget };
type Via = "gmail" | "mail_app" | "whatsapp";
/** A message opened in Gmail or WhatsApp, waiting for the founder's "Yes, sent". */
export type PendingSend = { id: string; channel: Channel; target: SendTarget; template: TemplateKey; key: string; to: string; subject: string; body: string; business: string };
export type Draft = Omit<PendingSend, "id">;

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
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean }>("/api/email/status") });
  const [pending, setPending] = React.useState<PendingSend[]>([]);
  const [returned, setReturned] = React.useState(false);
  const refresh = () => ["call-summary", "my-day", "email-sends", "email-queue", "call-log"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const payload = (d: Draft, via: Via, checkOnly = false) => ({
    idempotency_key: d.key, channel: d.channel, via, context: contextOf(d.template), account_id: d.target.accountId, call_session_id: sessionId ?? "",
    to: d.to.trim(), subject: d.subject, body: d.body, template_key: d.template, language: lang, market: d.target.market,
    business_name: d.target.accountId ? "" : d.business.trim(), contact_name: d.target.contact, check_only: checkOnly,
  });
  const record = useMutation({
    mutationFn: (a: { d: Draft; via: Via; pendingId?: string }) => api("/api/email/send", { body: payload(a.d, a.via) }),
    onSuccess: (_r, a) => {
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

  /** Sends or opens the message. Resolves true when it left (Gmail) or opened (tab); false when blocked. */
  const send = async (d: Draft): Promise<boolean> => {
    if (d.channel === "email" && gmail.data?.connected) {
      try { await record.mutateAsync({ d, via: "gmail" }); return true; } catch { return false; }
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
    const url = d.channel === "email" ? gmailComposeLink(d.to.trim(), d.subject, d.body) : whatsappSendLink(d.to.trim(), d.body, isMobileUA(navigator.userAgent));
    if (w) w.location.href = url; else window.open(url, "_blank", "noopener");
    setReturned(false);
    setPending((p) => [{ ...d, id: crypto.randomUUID() }, ...p.filter((x) => x.key !== d.key)]);
    return true;
  };
  const confirm = (p: PendingSend) => record.mutate({ d: p, via: p.channel === "email" ? "mail_app" : "whatsapp", pendingId: p.id });
  const dismiss = (p: PendingSend) => setPending((x) => x.filter((y) => y.id !== p.id));
  return {
    send, pending, returned, confirm, dismiss, busy: record.isPending, ready: Boolean(pb.data), gmailConnected: Boolean(gmail.data?.connected), gmailKnown: gmail.isSuccess, playbook: pb.data ?? null, lang,
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
            <b className="font-semibold">{p.target.contact || p.target.name || p.to}</b> · {t(EMAIL_TEMPLATE_LABELS[p.template])} · {p.channel === "email" ? t("Gmail opened. Sent?") : t("WhatsApp opened. Sent?")}
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
  if (compact) return <a className="text-[12px] font-medium underline" href={`/api/auth/google/gmail?back=${back}`}>{t("Connect Gmail")}</a>;
  if (hidden) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-subtle px-4 py-3">
      <Mail className="size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm"><b className="font-semibold">{t("Connect Gmail: emails leave in one click.")}</b> <span className="text-text-2">{t("No tab to open, nothing to paste. Send only: Valemont OS never reads your inbox.")}</span></p>
      <Button asChild size="sm" variant="primary"><a href={`/api/auth/google/gmail?back=${back}`}>{t("Connect Gmail")}</a></Button>
      <Button size="icon" variant="ghost" aria-label={t("Hide")} onClick={() => { setHidden(true); try { localStorage.setItem("vos-gmail-hint", "1"); } catch { /* convenience only */ } }}><X /></Button>
    </div>
  );
}

/**
 * The message card, inline (no dialog): who it goes to (editable, missing info asked right there), template chips
 * (the suggested one first), subject and text editable in place, the founder's signature and language, the documents
 * travelling as links, and one big Send with the channel. Keys when `keys`: E email, W WhatsApp, Esc skip.
 */
export function MessageCard({ s, target, chips, suggested, sendKey, needsBusiness = false, keys = false, gmailHint = true, title, onDone, onSkip, footer }: {
  s: InstantSend; target: SendTarget; chips: TemplateKey[]; suggested: TemplateKey | null; sendKey: string; needsBusiness?: boolean; keys?: boolean; gmailHint?: boolean; title?: React.ReactNode;
  onDone: (channel: Channel) => void; onSkip?: () => void; footer?: React.ReactNode;
}) {
  const t = useT();
  const tag = useDateTag();
  const pb = s.playbook;
  const lang = s.lang;
  const sends = useSentRows();
  const [channel, setChannel] = React.useState<Channel>(() => defaultChannel(target));
  const [tpl, setTpl] = React.useState<TemplateKey>(suggested ?? chips[0] ?? "thanks");
  const [email, setEmail] = React.useState(target.email);
  const [phone, setPhone] = React.useState(target.phone);
  const [business, setBusiness] = React.useState(target.name);
  const textOf = React.useCallback((c: Channel, k: TemplateKey) => (pb ? messageFor(pb, lang, c, k, { name: business, contact: target.contact }) : { subject: "", body: "" }), [pb, lang, business, target.contact]);
  // The text follows the template, channel and playbook until the founder edits it (an edit sticks to that channel + template).
  const [draft, setDraft] = React.useState<{ k: string; subject: string; body: string } | null>(null);
  const draftKey = `${channel}:${tpl}`;
  const edited = draft?.k === draftKey;
  const text = edited ? draft : textOf(channel, tpl);
  const setText = (v: { subject: string; body: string }) => setDraft({ k: draftKey, subject: v.subject, body: v.body });
  const [busy, setBusy] = React.useState(false);
  const to = channel === "email" ? email : phone;
  const missing = missingInfo(channel, to, { needsBusiness, business, body: text.body });
  const docs = pb ? docsIn(text.body, pb.links) : [];
  const deckUrl = pb ? (lang === "ES" ? pb.links.deckES : pb.links.deckFR) : "";
  const history = sentTo(sends.data ?? [], target.accountId);
  const dup = alreadySent(sends.data ?? [], target.accountId, tpl);
  const pick = (k: TemplateKey) => setTpl(k);
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
    const msg = c === channel ? text : textOf(c, tpl);
    const dest = c === "email" ? email : phone;
    const miss = missingInfo(c, dest, { needsBusiness, business, body: msg.body });
    if (miss.length) {
      if (c !== channel) switchTo(c);
      toast(miss.includes("link") ? t("A link is missing. Add it in Settings › Workspace.") : miss.includes("business") ? t("Name the business first.") : c === "email" ? t("Add the email address first.") : t("Add the WhatsApp number first."));
      setTimeout(() => document.getElementById(miss.includes("business") ? `mc-biz-${sendKey}` : `mc-to-${sendKey}`)?.focus(), 0);
      return;
    }
    setBusy(true);
    const ok = await s.send({ channel: c, target: { ...target, name: business, email, phone }, template: tpl, key: keyOf[c], to: dest, subject: msg.subject, body: msg.body, business });
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
  const sendLabel = channel === "whatsapp" ? t("Open WhatsApp") : s.gmailConnected ? t("Send with Gmail") : t("Open in Gmail");
  return (
    <section aria-label={t("Message card")} className="flex flex-col gap-3 rounded-[18px] border-2 border-sales bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{title ?? t("Message for {name}", { name: target.contact || target.name || t("the last call") })}</p>
          {history.length ? (
            <p className={cn("text-[12px]", dup ? "font-medium text-bad" : "text-text-2")}>
              {dup ? t("Already sent:") : t("Sent before:")} {history.slice(0, 3).map((h) => `${t(TEMPLATE_SHORT[h.template as TemplateKey] ?? h.template)} (${h.channel === "email" ? t("Email") : "WhatsApp"}, ${new Date(h.at).toLocaleDateString(tag, { day: "numeric", month: "short" })})`).join(" · ")}
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
        <label htmlFor={`mc-to-${sendKey}`} className="text-[12px] font-medium text-text-2">{channel === "email" ? t("To") : t("WhatsApp number")}</label>
        <Input id={`mc-to-${sendKey}`} type={channel === "email" ? "email" : "tel"} value={to} autoFocus={missing.includes("email") || missing.includes("phone")}
          onChange={(e) => (channel === "email" ? setEmail(e.target.value) : setPhone(e.target.value))}
          placeholder={channel === "email" ? t("Their email address") : "+33 6…"}
          className={cn("h-9", (missing.includes("email") || missing.includes("phone")) && "border-bad")} />
        {needsBusiness ? (
          <>
            <label htmlFor={`mc-biz-${sendKey}`} className="text-[12px] font-medium text-text-2">{t("Business")}</label>
            <Input id={`mc-biz-${sendKey}`} value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={t("Business name (required to follow up)")} className={cn("h-9", missing.includes("business") && "border-bad")} />
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Template")}>
        {chips.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={tpl === k} onClick={() => pick(k)}
            className={cn("min-h-8 rounded-full border px-3 text-[13px]", tpl === k ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle")}>
            {t(TEMPLATE_SHORT[k])}{k === suggested ? <span className={cn("ml-1 text-[11px]", tpl === k ? "text-panel/70" : "text-text-3")}>· {t("suggested")}</span> : null}
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
      </div>
      {missing.includes("link") ? <p className="text-[12px] text-bad">{t("A link is missing. Add it in Settings › Workspace.")}</p> : null}
      {gmailHint && channel === "email" && s.gmailKnown && !s.gmailConnected ? <ConnectGmail /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" variant="primary" disabled={busy || s.busy || !pb} onClick={() => void go()} className="min-w-48 flex-1 sm:flex-none">
          {channel === "email" ? (s.gmailConnected ? <Send /> : <Mail />) : <MessageCircle />} {busy ? t("Sending…") : sendLabel} {keys ? <span className="text-[11px] opacity-70">↵</span> : null}
        </Button>
        <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(channel === "email" ? `${text.subject}\n\n${text.body}` : text.body); toast(t("Copied")); } catch { /* clipboard blocked */ } }}><Copy /> {t("Copy")}</Button>
        {onSkip ? <Button variant="ghost" onClick={onSkip}>{t("No message")} <span className="text-[11px] opacity-60">Esc</span></Button> : null}
        {footer}
      </div>
      {lang === "ES" && contextOf(tpl) === "cold" ? <p className="text-[12px] text-text-3">{t("Spain: a message to someone you have not talked to needs prior consent (LSSI art. 21).")}</p> : null}
    </section>
  );
}

/** Small helper for callers: the suggested template's label. */
export const templateLabel = (k: TemplateKey) => EMAIL_TEMPLATE_LABELS[k];
