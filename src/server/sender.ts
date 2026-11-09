import type { DataRepository } from "@/data/repository";

/**
 * The address every client email leaves from (D090): the Workspace setting `email_sender_address`, else the
 * EMAIL_SENDER_ADDRESS environment variable (no real address in the repository: build separation), else "".
 * Both founders send from it; each keeps their own signature. No `server-only`: the browser preview runs services too.
 */
export const SENDER_SETTING = "email_sender_address";
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function envSenderAddress(): string {
  const v = typeof process !== "undefined" ? (process.env?.EMAIL_SENDER_ADDRESS ?? "") : "";
  return EMAIL_RE.test(v.trim()) ? v.trim().toLowerCase() : "";
}

export async function senderAddress(repo: DataRepository): Promise<string> {
  const { rows } = await repo.list("SystemSettings");
  const v = rows.find((r) => r.key === SENDER_SETTING && !r.is_archived)?.value?.trim() ?? "";
  return EMAIL_RE.test(v) ? v.toLowerCase() : envSenderAddress();
}

export const sameAddress = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
