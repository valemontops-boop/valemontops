import { normalizeDomain, normalizeEmail, normalizePhone } from "./normalize";

export interface SuppressionEntry {
  kind: "contact" | "email" | "phone" | "domain";
  value_normalized: string;
  contact_id: string;
  account_id: string;
  is_archived: boolean;
}
export interface ContactRef {
  id: string;
  email: string;
  phone: string;
  consent_status: string;
  account_id: string;
}
export interface AccountRef {
  id: string;
  email: string;
  phone: string;
  website: string;
  domain_normalized: string;
  country: "FR" | "ES" | null;
}

export interface BlockResult {
  blocked: boolean;
  reason: string | null;
}

/**
 * Hard block (spec 5.5): an opted-out contact or any suppression match blocks outreach
 * logging and queueing for every founder and channel.
 */
export function outreachBlock(
  contact: ContactRef | null,
  account: AccountRef | null,
  list: SuppressionEntry[],
): BlockResult {
  if (contact?.consent_status === "opted_out") return { blocked: true, reason: "This contact opted out." };
  const active = list.filter((e) => !e.is_archived);
  const emails = new Set([normalizeEmail(contact?.email), normalizeEmail(account?.email)].filter(Boolean));
  const phones = new Set(
    [normalizePhone(contact?.phone, account?.country), normalizePhone(account?.phone, account?.country)].filter(Boolean),
  );
  const domain = account?.domain_normalized || normalizeDomain(account?.website);
  for (const e of active) {
    if (e.kind === "contact" && contact && e.contact_id === contact.id) return { blocked: true, reason: "This contact is on the suppression list." };
    if (e.account_id && account && e.account_id === account.id && e.kind !== "contact") return { blocked: true, reason: "This business is on the suppression list." };
    if (e.kind === "email" && emails.has(e.value_normalized)) return { blocked: true, reason: "This email address is on the suppression list." };
    if (e.kind === "phone" && phones.has(e.value_normalized)) return { blocked: true, reason: "This phone number is on the suppression list." };
    if (e.kind === "domain" && domain && e.value_normalized === domain) return { blocked: true, reason: "This business domain is on the suppression list." };
  }
  return { blocked: false, reason: null };
}
