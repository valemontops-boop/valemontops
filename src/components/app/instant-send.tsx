"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fill, findItem, gmailComposeLink, whatsappLink, type Lang, type PlaybookItem, type TemplateKey } from "@/domain/playbook";
import { useLocale, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";

export type Playbook = { items: PlaybookItem[]; links: { calendly: string; deckFR: string; deckES: string }; founderName: string; signature: string };
export type SendTarget = { accountId: string; name: string; contact: string; email: string; phone: string; market: Lang };
type Pending = { channel: "email" | "whatsapp"; target: SendTarget; template: TemplateKey; key: string; subject: string; body: string };

/** Subject and body of a template, in the founder's language, with their signature, for this person. */
export function messageFor(pb: Playbook, lang: Lang, channel: "email" | "whatsapp", template: TemplateKey, target: SendTarget) {
  const it = findItem(pb.items, channel === "whatsapp" ? "whatsapp" : "email", template, lang);
  const v = { business: target.name, contact: target.contact, founder: pb.founderName, signature: pb.signature, calendly: pb.links.calendly, deck: lang === "ES" ? pb.links.deckES : pb.links.deckFR };
  return { subject: fill(it?.subject ?? "", v), body: fill(it?.body ?? "", v) };
}

/**
 * One click = the message goes out. Email: sent by Gmail when connected; otherwise Gmail opens in a new tab,
 * prefilled (right person, subject, language, signature), and the founder confirms "sent". WhatsApp opens the
 * chat prefilled. Suppression and consent are checked by the server first; nothing counts until confirmed.
 */
export function useInstantSend(sessionId?: string) {
  const t = useT();
  const qc = useQueryClient();
  const lang: Lang = useLocale() === "es" ? "ES" : "FR";
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const gmail = useQuery({ queryKey: ["gmail-status"], queryFn: () => api<{ connected: boolean }>("/api/email/status") });
  const [pending, setPending] = React.useState<Pending | null>(null);
  const refresh = () => ["call-summary", "my-day", "email-sends", "email-queue", "call-log"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const payload = (p: Pending, via: "gmail" | "mail_app" | "whatsapp", checkOnly = false) => ({
    idempotency_key: p.key, channel: p.channel, via, context: p.template === "missed" ? "cold" : "after_call", account_id: p.target.accountId, call_session_id: sessionId ?? "",
    to: p.channel === "email" ? p.target.email : p.target.phone, subject: p.subject, body: p.body, template_key: p.template, language: lang, market: p.target.market, check_only: checkOnly,
  });
  const record = useMutation({
    mutationFn: (a: { p: Pending; via: "gmail" | "mail_app" | "whatsapp" }) => api("/api/email/send", { body: payload(a.p, a.via) }),
    onSuccess: (_r, a) => { toast(a.via === "gmail" ? t("Email sent to {name}", { name: a.p.target.name || a.p.target.email }) : a.p.channel === "email" ? t("Email sent and logged") : t("WhatsApp logged")); setPending(null); refresh(); },
    onError: (e) => toast(e instanceof ApiError && e.body.error === "consent_required" ? t("Connect Gmail first") : (e as Error).message),
  });
  /** Returns false when information is missing (no address / number): the caller opens the editor instead. */
  const send = (channel: "email" | "whatsapp", target: SendTarget, template: TemplateKey, key: string = crypto.randomUUID()): boolean => {
    if (!pb.data) return false;
    const to = channel === "email" ? target.email : target.phone;
    if (!to || !target.accountId) return false;
    const msg = messageFor(pb.data, lang, channel, template, target);
    if (/\[add (your Calendly|the deck) link/.test(msg.body)) { toast(t("A link is missing. Add it in Settings › Workspace.")); return true; }
    const p: Pending = { channel, target, template, key, ...msg };
    if (channel === "email" && gmail.data?.connected) { record.mutate({ p, via: "gmail" }); return true; }
    // Open the tab now (still inside the click, so it is not blocked), point it once the server said OK.
    const w = window.open("", "_blank");
    void api("/api/email/send", { body: payload(p, channel === "email" ? "mail_app" : "whatsapp", true) })
      .then(() => {
        const url = channel === "email" ? gmailComposeLink(to, msg.subject, msg.body) : whatsappLink(to, msg.body);
        if (w) w.location.href = url; else window.open(url, "_blank", "noopener");
        setPending(p);
      })
      .catch((e) => { w?.close(); toast((e as Error).message); });
    return true;
  };
  const confirm = () => pending && record.mutate({ p: pending, via: pending.channel === "email" ? "mail_app" : "whatsapp" });
  return { send, pending, confirm, dismiss: () => setPending(null), busy: record.isPending, ready: Boolean(pb.data), gmailConnected: Boolean(gmail.data?.connected), playbook: pb.data ?? null, lang };
}

/** "Did you send it?" after Gmail or WhatsApp opened in another tab. */
export function ConfirmSent({ s }: { s: ReturnType<typeof useInstantSend> }) {
  const t = useT();
  if (!s.pending) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-hairline bg-panel px-4 py-3" role="status">
      <p className="min-w-0 flex-1 text-sm">{s.pending.channel === "email" ? t("Gmail opened with the email for {name}. Sent?", { name: s.pending.target.name }) : t("WhatsApp opened with the message for {name}. Sent?", { name: s.pending.target.name })}</p>
      <Button size="sm" variant="primary" disabled={s.busy} onClick={s.confirm}><Check /> {t("Yes, sent")}</Button>
      <Button size="sm" variant="ghost" onClick={s.dismiss}><X /> {t("Not sent")}</Button>
    </div>
  );
}
