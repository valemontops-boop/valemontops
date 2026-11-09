/** Normalisers used for duplicate detection and suppression matching. Never applied to stored data. */

export function normalizeEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function normalizeDomain(v: string | null | undefined): string {
  let s = (v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop() ?? "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#:]/)[0] ?? "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : "";
}

const FREE_MAIL = new Set(["gmail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "yahoo.com", "yahoo.fr", "yahoo.es", "orange.fr", "free.fr", "wanadoo.fr", "icloud.com", "live.com", "laposte.net", "sfr.fr"]);
export function isFreeMailDomain(d: string): boolean {
  return FREE_MAIL.has(d);
}

/** E.164-ish normalisation for matching. FR/ES national numbers gain their country code. */
export function normalizePhone(v: string | null | undefined, market?: "FR" | "ES" | null): string {
  let s = (v ?? "").trim().replace(/[\s.\-()/]/g, "");
  if (!s) return "";
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) return /^\+\d{6,15}$/.test(s) ? s : "";
  if (!/^\d{6,15}$/.test(s)) return "";
  if (s.length === 10 && s.startsWith("0") && market !== "ES") return "+33" + s.slice(1);
  if (s.length === 9 && /^[6789]/.test(s) && market !== "FR") return "+34" + s;
  return s;
}
