import { ConflictError } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import { childId } from "@/lib/ids";
import { isFreeMailDomain, normalizeDomain, normalizeEmail, normalizePhone } from "@/domain/normalize";
import { outreachBlock } from "@/domain/suppression";
import { inboxExcerpt, type WebsiteLead } from "@/domain/website-lead";
import type { AppContext } from "../context";
import { ingestInboxItems, inboxId } from "./inbox";

const SYSTEM = { founder: "system" };
export const submissionId = (eventId: string) => childId("website", eventId);

export type WebsiteOutcome = "created" | "matched" | "suppressed" | "duplicate";

/**
 * One website form event → inbound lead (Stage 4A, D083). Idempotent by event_id: the submission row is written last
 * and every other id is derived from the event id, so a retry after a partial write re-uses what is already there.
 * - Matching: contact email/phone, then business email/phone/domain (free-mail domains never match a business).
 * - Suppression (spec 5.5): an opted-out contact or any suppression match → nothing created or updated, no item to
 *   reply to; the submission is kept with outcome "suppressed" so the founders can see that it happened.
 * - New business: Account (lead_type inbound, lead_source website, brand by site, owner by language/market) + Contact.
 * - Consent: the form's checkbox, sentence and version are stored on the submission; a ticked box sets the contact to
 *   "consented" with that basis; otherwise the basis is the visitor's own request (reply only).
 */
export async function ingestWebsiteLead(ctx: AppContext, lead: WebsiteLead, now = new Date()): Promise<{ status: WebsiteOutcome; account_id: string; contact_id: string }> {
  const subId = submissionId(lead.event_id);
  const done = await ctx.repo.get("WebsiteSubmissions", subId, { fresh: true });
  if (done) return { status: "duplicate", account_id: done.account_id, contact_id: done.contact_id };

  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList"], { fresh: true });
  const market = lead.country || lead.language || null;
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone, market);
  const emailDomain = normalizeDomain(email);
  const domain = normalizeDomain(lead.website) || (emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : "");
  const accounts = t.Accounts.rows.filter((a) => !a.is_archived);
  const accById = new Map(accounts.map((a) => [a.id, a]));

  // Our own earlier partial run of this event (ids derived from the event id) wins over any other match.
  const newAccountId = childId("website-account", lead.event_id);
  const newContactId = childId("website-contact", lead.event_id);
  let contact: Row<"Contacts"> | null = t.Contacts.rows.find((c) => c.id === newContactId) ?? null;
  contact ??= t.Contacts.rows.find((c) => !c.is_archived && ((email && normalizeEmail(c.email) === email) || (phone && normalizePhone(c.phone, accById.get(c.account_id)?.country) === phone))) ?? null;
  let account: Row<"Accounts"> | null = accById.get(newAccountId) ?? (contact ? accById.get(contact.account_id) ?? null : null);
  account ??= accounts.find((a) => (email && normalizeEmail(a.email) === email) || (phone && normalizePhone(a.phone, a.country) === phone) || (domain && (a.domain_normalized || normalizeDomain(a.website)) === domain)) ?? null;

  const submission = (outcome: "created" | "matched" | "suppressed", accountId: string, contactId: string, inboxItemId: string) => ({
    id: subId, event_id: lead.event_id, site: lead.site, form_type: lead.form_type, language: lead.language, submitted_at: (lead.submitted_at ? new Date(lead.submitted_at) : now).toISOString(),
    outcome, account_id: accountId, contact_id: contactId, inbox_item_id: inboxItemId, page_url: lead.page_url, referrer: lead.referrer,
    utm_source: lead.utm.source ?? "", utm_medium: lead.utm.medium ?? "", utm_campaign: lead.utm.campaign ?? "", utm_term: lead.utm.term ?? "", utm_content: lead.utm.content ?? "",
    consent_marketing: lead.consent.marketing, consent_text: lead.consent.text, consent_version: lead.consent.version,
  });

  // Hard block: checked against what the form says AND what we already hold.
  const probeContact = { id: contact?.id ?? "", email: lead.email || contact?.email || "", phone: lead.phone || contact?.phone || "", consent_status: contact?.consent_status ?? "unknown", account_id: account?.id ?? "" };
  const probeAccount = { id: account?.id ?? "", email: account?.email || lead.email, phone: account?.phone || lead.phone, website: account?.website || lead.website, domain_normalized: account?.domain_normalized || domain, country: account?.country ?? (market || null) };
  if (outreachBlock(probeContact, probeAccount, t.SuppressionList.rows).blocked) {
    await ctx.repo.insert("WebsiteSubmissions", [submission("suppressed", account?.id ?? "", contact?.id ?? "", "")], SYSTEM);
    return { status: "suppressed", account_id: account?.id ?? "", contact_id: contact?.id ?? "" };
  }

  const owner = market === "ES" ? ("pablo" as const) : market === "FR" ? ("theo" as const) : null;
  const created = !account || account.id === newAccountId;
  if (!account) {
    const row = {
      id: newAccountId, name: lead.company || lead.name || lead.email || lead.phone, sector: lead.sector, niche: "", country: market, city: lead.city, website: lead.website,
      domain_normalized: domain, phone: lead.phone, email: lead.email, linkedin_url: "", lead_source: "website", lead_type: "inbound" as const,
      brand: lead.site === "thirty" ? ("thirty" as const) : ("consulting" as const), owner_founder: owner, lead_status: "new" as const, observed_problem: "", problem_evidence: "",
      language: market ? market.toLowerCase() : "", notes: "", import_batch_id: "", list_id: "",
    };
    [account] = await ctx.repo.insert("Accounts", [row], SYSTEM);
  } else if (!created) {
    // Existing business: fill blanks only (never overwrite what a founder typed); a conflict leaves it as it is.
    const patch: Record<string, string> = {};
    if (!account.phone && lead.phone) patch.phone = lead.phone;
    if (!account.website && lead.website) patch.website = lead.website;
    if (!account.email && lead.email) patch.email = lead.email;
    if (!account.domain_normalized && domain) patch.domain_normalized = domain;
    if (Object.keys(patch).length) await ctx.repo.update("Accounts", account.id, account.version, patch, SYSTEM).catch((e) => { if (!(e instanceof ConflictError)) throw e; });
  }

  const basis = lead.consent.marketing ? `Consent on the website form${lead.consent.version ? ` (${lead.consent.version})` : ""}, ${now.toISOString().slice(0, 10)}` : "Request sent through the website form (reply to it)";
  if (!contact) {
    const row = {
      id: newContactId, account_id: account!.id, full_name: lead.name, role: "", is_decision_maker: false, phone: lead.phone, email: lead.email, linkedin_url: "",
      contact_type: lead.name ? ("professional_named" as const) : ("company_generic" as const), language: market ? market.toLowerCase() : "",
      consent_status: lead.consent.marketing ? ("consented" as const) : ("unknown" as const), lawful_basis: basis, source: "website", retention_review_at: null, import_batch_id: "",
    };
    [contact] = await ctx.repo.insert("Contacts", [row], SYSTEM);
  } else if (lead.consent.marketing && contact.consent_status === "unknown") {
    await ctx.repo.update("Contacts", contact.id, contact.version, { consent_status: "consented", lawful_basis: basis }, SYSTEM).catch((e) => { if (!(e instanceof ConflictError)) throw e; });
  }

  // A brand-new lead re-uses the id of the derived "new website lead" item, so it shows once, with the message.
  const externalId = created ? `lead:${account!.id}` : `website:${lead.event_id}`;
  await ingestInboxItems(ctx, [{
    source: "website_form", external_id: externalId, account_label: lead.site === "thirty" ? "Website 30/30" : "Website Valemont",
    from_name: (lead.name || lead.company).slice(0, 200), excerpt: inboxExcerpt(lead), url: "", received_at: lead.submitted_at, assigned_founder: account!.owner_founder ?? owner,
  }], SYSTEM);
  await ctx.repo.insert("WebsiteSubmissions", [submission(created ? "created" : "matched", account!.id, contact!.id, inboxId(externalId))], SYSTEM);
  return { status: created ? "created" : "matched", account_id: account!.id, contact_id: contact!.id };
}
