import { z } from "zod";
import type { DataRepository, NewRow } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import { childId, newId } from "@/lib/ids";
import {
  BRANDS, CONTACT_TYPES, FOUNDERS, LEAD_STATUSES, LEAD_TYPES, MARKETS, STAGES, type FounderKey,
} from "@/domain/constants";
import { dedupeEvents } from "@/domain/activity";
import { normalizeDomain, normalizeEmail, normalizePhone } from "@/domain/normalize";
import { stageChangeErrors } from "@/domain/pipeline";
import { outreachBlock } from "@/domain/suppression";
import { RuleError } from "../errors";
import { patchOf } from "@/lib/zod";
import { stageProbabilities } from "./common";

const t200 = z.string().trim().max(200).default("");
const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default("");

export const accountInput = z.object({
  name: z.string().trim().min(1).max(200),
  sector: z.string().trim().max(120).default(""),
  niche: z.string().trim().max(120).default(""),
  country: z.enum(MARKETS).nullable().default(null),
  city: z.string().trim().max(120).default(""),
  website: z.string().trim().max(300).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  linkedin_url: z.string().trim().max(300).default(""),
  lead_source: z.string().trim().max(120).default(""),
  lead_type: z.enum(LEAD_TYPES).nullable().default(null),
  brand: z.enum(BRANDS).nullable().default(null),
  owner_founder: z.enum(FOUNDERS).nullable().default(null),
  lead_status: z.enum(LEAD_STATUSES).default("new"),
  observed_problem: z.string().trim().max(1_000).default(""),
  problem_evidence: z.string().trim().max(1_000).default(""),
  language: z.string().trim().max(10).default(""),
  notes: z.string().trim().max(4_000).default(""),
});

export const contactInput = z.object({
  full_name: t200,
  role: z.string().trim().max(120).default(""),
  is_decision_maker: z.boolean().default(false),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  linkedin_url: z.string().trim().max(300).default(""),
  contact_type: z.enum(CONTACT_TYPES).default("professional_named"),
  language: z.string().trim().max(10).default(""),
  lawful_basis: z.string().trim().max(300).default(""),
  source: z.string().trim().max(120).default(""),
});

export const opportunityInput = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.enum(BRANDS),
  market: z.enum(MARKETS).nullable().default(null),
  stage: z.enum(STAGES).default("targeted"),
  owner_founder: z.enum(FOUNDERS).nullable().default(null),
  value_eur: z.number().min(0).max(10_000_000).nullable().default(null),
  expected_close: day,
  next_action: z.string().trim().max(300).default(""),
  next_action_due: day,
  next_action_priority: z.enum(["high", "normal"]).default("normal"),
  primary_contact_id: z.union([z.literal(""), z.string().uuid()]).default(""),
});

export const createAccountSchema = z.object({
  id: z.string().uuid(), // client-generated: a retried create is a no-op (D006)
  account: accountInput,
  contact: contactInput.nullable().default(null),
  opportunity: opportunityInput.omit({ primary_contact_id: true }).nullable().default(null),
});

export async function createAccount(repo: DataRepository, founder: FounderKey, input: z.infer<typeof createAccountSchema>) {
  const actor = { founder };
  const existing = await repo.get("Accounts", input.id, { fresh: true });
  if (existing) return { account: existing, duplicate: true };
  const a = input.account;
  const [account] = await repo.insert(
    "Accounts",
    [{ id: input.id, ...a, domain_normalized: normalizeDomain(a.website) || normalizeDomain(a.email), import_batch_id: "" }],
    actor,
  );
  let contactId = "";
  if (input.contact && (input.contact.full_name || input.contact.phone || input.contact.email)) {
    contactId = childId(input.id, "contact");
    await repo.insert("Contacts", [{ id: contactId, account_id: input.id, ...input.contact, consent_status: "unknown", retention_review_at: null, import_batch_id: "" }], actor);
  }
  if (input.opportunity) {
    const o = input.opportunity;
    await createOpportunityRow(repo, founder, childId(input.id, "opportunity"), input.id, { ...o, primary_contact_id: contactId, market: o.market ?? a.country });
  }
  return { account, duplicate: false };
}

async function createOpportunityRow(repo: DataRepository, founder: FounderKey, id: string, accountId: string, o: z.infer<typeof opportunityInput>) {
  const { value_eur, ...rest } = o;
  const row: NewRow<"Opportunities"> = {
    id, account_id: accountId, ...rest, value_minor: value_eur === null ? null : Math.round(value_eur * 100), currency: "EUR",
    expected_close: o.expected_close || null, next_action_due: o.next_action_due || null, lost_reason: "", next_action_reason: "",
    anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "",
  };
  const [opp] = await repo.insert("Opportunities", [row], { founder });
  await repo.insert(
    "OpportunityStageEvents",
    [{ id: childId(id, "created"), opportunity_id: id, from_stage: null, to_stage: o.stage, changed_at: opp.created_at, changed_by: founder, reason: "Created" }],
    { founder },
  );
  return opp;
}

export const createOpportunitySchema = z.object({ id: z.string().uuid(), account_id: z.string().uuid(), opportunity: opportunityInput });

export async function createOpportunity(repo: DataRepository, founder: FounderKey, input: z.infer<typeof createOpportunitySchema>) {
  const existing = await repo.get("Opportunities", input.id, { fresh: true });
  if (existing) return existing;
  const acc = await repo.get("Accounts", input.account_id);
  if (!acc) throw new RuleError("Business not found");
  return createOpportunityRow(repo, founder, input.id, input.account_id, { ...input.opportunity, market: input.opportunity.market ?? acc.country });
}

export const updateAccountSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: patchOf(accountInput) });

export async function updateAccount(repo: DataRepository, founder: FounderKey, input: z.infer<typeof updateAccountSchema>) {
  const patch: Partial<Row<"Accounts">> = { ...input.patch };
  if (input.patch.website !== undefined || input.patch.email !== undefined) {
    const cur = await repo.get("Accounts", input.id, { fresh: true });
    patch.domain_normalized = normalizeDomain(input.patch.website ?? cur?.website) || normalizeDomain(input.patch.email ?? cur?.email);
  }
  return repo.update("Accounts", input.id, input.expected_version, patch, { founder });
}

export const updateOpportunitySchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  patch: patchOf(opportunityInput)
    .extend({
      lost_reason: z.string().trim().max(500).optional(),
      anum_authority: z.string().trim().max(500).optional(),
      anum_need: z.string().trim().max(500).optional(),
      anum_urgency: z.string().trim().max(500).optional(),
      anum_money: z.string().trim().max(500).optional(),
      next_action_reason: z.string().trim().max(300).optional(),
      is_archived: z.boolean().optional(),
    }),
  stage_reason: z.string().trim().max(500).default(""),
});

export async function updateOpportunity(repo: DataRepository, founder: FounderKey, input: z.infer<typeof updateOpportunitySchema>) {
  const cur = await repo.get("Opportunities", input.id, { fresh: true });
  if (!cur) throw new RuleError("Opportunity not found");
  const { value_eur, expected_close, next_action_due, ...rest } = input.patch;
  const patch: Partial<Row<"Opportunities">> = { ...rest };
  if (value_eur !== undefined) patch.value_minor = value_eur === null ? null : Math.round(value_eur * 100);
  if (expected_close !== undefined) patch.expected_close = expected_close || null;
  if (next_action_due !== undefined) patch.next_action_due = next_action_due || null;
  const merged = { ...cur, ...patch };
  // Rescheduling a high-priority follow-up later needs a reason (it counts as handled for the day only then).
  if (cur.next_action_priority === "high" && cur.next_action_due && patch.next_action_due && patch.next_action_due > cur.next_action_due && !(input.patch.next_action_reason ?? "").trim()) {
    throw new RuleError("Moving a high-priority follow-up later needs a reason.");
  }
  const stageChanged = input.patch.stage !== undefined && input.patch.stage !== cur.stage;
  if (stageChanged) {
    const errs = stageChangeErrors(merged, input.patch.stage!, merged.lost_reason);
    if (errs.length) throw new RuleError(errs[0], errs);
  }
  // Version check happens in the adapter: a stale expected_version is a visible conflict.
  const updated = await repo.update("Opportunities", input.id, input.expected_version, patch, { founder });
  if (stageChanged) {
    await repo.insert(
      "OpportunityStageEvents",
      [{ id: childId(input.id, "stage", String(updated.version)), opportunity_id: input.id, from_stage: cur.stage, to_stage: input.patch.stage!, changed_at: updated.updated_at, changed_by: founder, reason: input.stage_reason || input.patch.lost_reason || "" }],
      { founder },
    );
  }
  return updated;
}

export const createContactSchema = z.object({ id: z.string().uuid(), account_id: z.string().uuid(), contact: contactInput });
export async function createContact(repo: DataRepository, founder: FounderKey, input: z.infer<typeof createContactSchema>) {
  const existing = await repo.get("Contacts", input.id, { fresh: true });
  if (existing) return existing;
  const [c] = await repo.insert("Contacts", [{ id: input.id, account_id: input.account_id, ...input.contact, consent_status: "unknown", retention_review_at: null, import_batch_id: "" }], { founder });
  return c;
}

export const updateContactSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: patchOf(contactInput) });
export async function updateContact(repo: DataRepository, founder: FounderKey, input: z.infer<typeof updateContactSchema>) {
  return repo.update("Contacts", input.id, input.expected_version, input.patch, { founder });
}

export const optOutSchema = z.object({ contact_id: z.string().uuid(), reason: z.string().trim().max(300).default("Contact asked not to be contacted") });

/** Opt-out: sets consent status and appends suppression entries for the contact, its email and phone (D015). */
export async function optOutContact(repo: DataRepository, founder: FounderKey, input: z.infer<typeof optOutSchema>) {
  const c = await repo.get("Contacts", input.contact_id, { fresh: true });
  if (!c) throw new RuleError("Contact not found");
  const acc = c.account_id ? await repo.get("Accounts", c.account_id) : null;
  const { rows: supp } = await repo.list("SuppressionList", { fresh: true });
  const entries: NewRow<"SuppressionList">[] = [
    { kind: "contact" as const, value_normalized: c.id },
    { kind: "email" as const, value_normalized: normalizeEmail(c.email) },
    { kind: "phone" as const, value_normalized: normalizePhone(c.phone, acc?.country) },
  ]
    .filter((e) => e.value_normalized)
    .map((e) => ({ id: childId("suppress", e.kind, e.value_normalized), ...e, contact_id: c.id, account_id: "", reason: input.reason, added_by: founder }))
    .filter((e) => !supp.some((s) => s.id === e.id));
  if (entries.length) await repo.insert("SuppressionList", entries, { founder });
  if (c.consent_status !== "opted_out") await repo.update("Contacts", c.id, c.version, { consent_status: "opted_out" }, { founder });
  await repo.insert("AuditLog", [{ id: newId(), actor: founder, action: "contact.opt_out", table_name: "Contacts", record_id: c.id, fields: "consent_status", correlation_id: "" }], { founder });
  return { suppressed: entries.length };
}

export const suppressSchema = z.object({ kind: z.enum(["email", "phone", "domain"]), value: z.string().trim().min(3).max(300), reason: z.string().trim().max(300).default("") });
export async function addSuppression(repo: DataRepository, founder: FounderKey, input: z.infer<typeof suppressSchema>) {
  const v = input.kind === "email" ? normalizeEmail(input.value) : input.kind === "phone" ? normalizePhone(input.value) : normalizeDomain(input.value);
  if (!v) throw new RuleError(`That ${input.kind} could not be recognised.`);
  const id = childId("suppress", input.kind, v);
  const { rows } = await repo.list("SuppressionList", { fresh: true });
  if (rows.some((r) => r.id === id)) return { added: false };
  await repo.insert("SuppressionList", [{ id, kind: input.kind, value_normalized: v, contact_id: "", account_id: "", reason: input.reason, added_by: founder }], { founder });
  return { added: true };
}

/** Everything the CRM screens need in one batched read. */
export async function crmSnapshot(repo: DataRepository) {
  const t = await repo.listMany(["Accounts", "Contacts", "Opportunities", "SuppressionList", "ChannelRules", "ActivityEvents"]);
  const probs = await stageProbabilities(repo);
  const events = dedupeEvents(t.ActivityEvents.rows);
  const last = new Map<string, string>();
  for (const e of events) if (e.account_id) last.set(e.account_id, e.occurred_at);
  const blocked = Object.fromEntries(
    t.Contacts.rows.map((c) => [c.id, outreachBlock(c, t.Accounts.rows.find((a) => a.id === c.account_id) ?? null, t.SuppressionList.rows).reason]),
  );
  const accountBlocked = Object.fromEntries(t.Accounts.rows.map((a) => [a.id, outreachBlock(null, a, t.SuppressionList.rows).reason]));
  return {
    accounts: t.Accounts.rows.filter((a) => !a.is_archived).map((a) => ({ ...a, last_activity_at: last.get(a.id) ?? null, blocked_reason: accountBlocked[a.id] })),
    contacts: t.Contacts.rows.filter((c) => !c.is_archived).map((c) => ({ ...c, blocked_reason: blocked[c.id] })),
    opportunities: t.Opportunities.rows.filter((o) => !o.is_archived),
    channelRules: t.ChannelRules.rows,
    stageProbabilities: probs,
    suppressionCount: t.SuppressionList.rows.filter((s) => !s.is_archived).length,
    warnings: [...t.Accounts.warnings, ...t.Contacts.warnings, ...t.Opportunities.warnings],
    fetchedAt: t.Accounts.fetchedAt,
  };
}

export async function accountTimeline(repo: DataRepository, accountId: string) {
  const t = await repo.listMany(["ActivityEvents", "OpportunityStageEvents", "Opportunities"]);
  const oppIds = new Set(t.Opportunities.rows.filter((o) => o.account_id === accountId).map((o) => o.id));
  const events = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.account_id === accountId).reverse();
  const stages = t.OpportunityStageEvents.rows.filter((s) => oppIds.has(s.opportunity_id)).sort((a, b) => b.changed_at.localeCompare(a.changed_at));
  return { events, stages };
}
