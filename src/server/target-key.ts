import { createHmac } from "node:crypto";
import { normalizePhone } from "@/domain/normalize";

/**
 * Keyed hash of a dialled number (call mode). Lets us count distinct businesses called without storing
 * the number of someone who said no (data minimisation, spec 3.9).
 */
export function targetKey(phone: string, market?: "FR" | "ES" | null): string {
  const n = normalizePhone(phone, market ?? null);
  if (!n) return "";
  const secret = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SESSION_SECRET ?? "valemont-os-target-key";
  return createHmac("sha256", secret).update(n).digest("hex").slice(0, 32);
}
