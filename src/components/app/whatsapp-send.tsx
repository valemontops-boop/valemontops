"use client";
import { Copy, MessageCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { formatE164, normalizeWhatsApp, whatsappChatUrl } from "@/domain/whatsapp";
import { isMobileUA } from "@/domain/messages";
import { normalizePhone } from "@/domain/normalize";
import { useT } from "@/i18n/react";
import { cn } from "@/lib/utils";

/** Clipboard with a fallback for browsers that refuse the async API. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const el = document.createElement("textarea");
    el.value = text; el.setAttribute("readonly", ""); el.style.position = "fixed"; el.style.opacity = "0";
    document.body.appendChild(el); el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch { return false; }
}

/** Opens a NEW WhatsApp chat to that number with the text, from the click itself (no popup blocker). */
export function openWhatsAppChat(e164: string, text: string) {
  window.open(whatsappChatUrl(e164, text, isMobileUA(navigator.userAgent)), "_blank", "noopener");
}

/**
 * The WhatsApp part of every send card (D090): the number (prefilled from the prospect, any number can be typed),
 * read back in E.164 or a visible error, then "Copy the text" and "Open WhatsApp" (a new chat to that number with
 * the text). `onOpen` runs inside the click: open the window there. A number typed for a known business can be
 * kept on its contact (`canSave`; the server checks suppression first).
 */
export function WhatsAppSend({ id, phone, onPhone, market, text, canSave = false, save = false, onSave, onOpen, busy = false, autoFocus = false, extra }: {
  id: string; phone: string; onPhone: (v: string) => void; market: "FR" | "ES" | null; text: string;
  canSave?: boolean; save?: boolean; onSave?: (v: boolean) => void;
  onOpen: (e164: string) => void; busy?: boolean; autoFocus?: boolean; extra?: React.ReactNode;
}) {
  const t = useT();
  const n = normalizeWhatsApp(phone, market);
  const showError = !n.ok && phone.trim().length > 0;
  const copy = async () => toast((await copyToClipboard(text)) ? t("Text copied") : t("Could not copy. Select the text and copy it."));
  const open = () => {
    if (!n.ok) { toast(n.error === "empty" ? t("Add the WhatsApp number first.") : t("This WhatsApp number is not valid.")); document.getElementById(id)?.focus(); return; }
    onOpen(n.e164);
  };
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="WhatsApp">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-2">
        <label htmlFor={id} className="text-[12px] font-medium text-text-2">{t("WhatsApp number")}</label>
        <Input id={id} type="tel" inputMode="tel" autoComplete="off" value={phone} autoFocus={autoFocus} onChange={(e) => onPhone(e.target.value)}
          placeholder={market === "ES" ? "+34 6…" : "+33 6…"} aria-invalid={showError || undefined} aria-describedby={`${id}-state`} className={cn("h-9", showError && "border-bad")} />
        <p id={`${id}-state`} className={cn("text-[12px] sm:col-start-2", showError ? "font-medium text-bad" : "text-text-3")} aria-live="polite">
          {n.ok ? t("WhatsApp opens a new chat with {number}", { number: formatE164(n.e164) }) : showError ? t("Not a valid number: type it with its country code (+33…, +34…) or as 06…, 6…") : t("Type the number, French or Spanish format.")}
        </p>
      </div>
      {canSave && n.ok ? (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={save} onChange={(e) => onSave?.(e.target.checked)} />{t("Save this number on the contact")}
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" variant="primary" disabled={busy} onClick={open} className="min-w-48 flex-1 sm:flex-none"><MessageCircle /> {busy ? t("Opening…") : t("Open WhatsApp")}</Button>
        <Button variant="outline" onClick={() => void copy()}><Copy /> {t("Copy the text")}</Button>
        {extra}
      </div>
    </div>
  );
}

/** True when a typed number differs from the one already on the prospect (then "save it" is offered). */
export function isNewNumber(typed: string, known: string, market: "FR" | "ES" | null): boolean {
  const n = normalizeWhatsApp(typed, market);
  return n.ok && normalizePhone(known, market) !== n.e164;
}
