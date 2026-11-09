/**
 * WhatsApp numbers (iteration 14, D090): whatever the founder types or the CRM holds — "06 12 34 56 78",
 * "+33 6…", "0033 6…", "0034 612…", "612 345 678" — becomes E.164 before WhatsApp opens, or a visible error.
 * French national numbers are 0 + 9 digits; Spanish ones are 9 digits starting 6/7 (mobile) or 8/9 (landline).
 * A bare 9-digit number is Spanish, except a 6/7 number for a French prospect (the leading 0 was dropped).
 */
export type WaError = "empty" | "invalid";
export type WaNumber = { ok: true; e164: string } | { ok: false; error: WaError };

export function normalizeWhatsApp(raw: string | null | undefined, market?: "FR" | "ES" | null): WaNumber {
  let s = String(raw ?? "").trim().replace(/[\s.\-()/ ]/g, "");
  if (!s) return { ok: false, error: "empty" };
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^\+33/.test(s)) {
    const rest = s.slice(3).replace(/^0/, ""); // "+33 (0)6…" is a common way to write it
    return /^[1-9]\d{8}$/.test(rest) ? { ok: true, e164: `+33${rest}` } : { ok: false, error: "invalid" };
  }
  if (/^\+34/.test(s)) {
    const rest = s.slice(3);
    return /^[6789]\d{8}$/.test(rest) ? { ok: true, e164: `+34${rest}` } : { ok: false, error: "invalid" };
  }
  if (s.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(s) ? { ok: true, e164: s } : { ok: false, error: "invalid" };
  if (!/^\d+$/.test(s)) return { ok: false, error: "invalid" };
  if (/^0[1-9]\d{8}$/.test(s)) return { ok: true, e164: `+33${s.slice(1)}` };
  if (/^33[1-9]\d{8}$/.test(s)) return { ok: true, e164: `+${s}` };
  if (/^34[6789]\d{8}$/.test(s)) return { ok: true, e164: `+${s}` };
  if (/^[6789]\d{8}$/.test(s)) return market === "FR" && /^[67]/.test(s) ? { ok: true, e164: `+33${s}` } : { ok: true, e164: `+34${s}` };
  return { ok: false, error: "invalid" };
}

/** "+33 6 12 34 56 78" / "+34 612 345 678": the number as the founder reads it back. */
export function formatE164(e164: string): string {
  if (/^\+33\d{9}$/.test(e164)) return `+33 ${e164[3]} ${e164.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ")}`;
  if (/^\+34\d{9}$/.test(e164)) return `+34 ${e164.slice(3).replace(/(\d{3})(?=\d)/g, "$1 ")}`;
  return e164;
}

/** A NEW chat to that number with the text prefilled: WhatsApp Web on a computer, wa.me (the app) on a phone. */
export function whatsappChatUrl(e164: string, text: string, mobile: boolean): string {
  const digits = e164.replace(/\D/g, "");
  return mobile ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(text)}`;
}
