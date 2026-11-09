import { z } from "zod";
import type { DataRepository, NewRow } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import { childId, newId } from "@/lib/ids";
import {
  ACTIVITY_TYPES, BRANDS, CONTACT_TYPES, FOLLOW_UP_CHANNELS, MARKETS, OBJECTIONS, OUTCOMES, type FounderKey,
  type RuleChannel,
} from "@/domain/constants";
import { dedupeEvents, isOutreach } from "@/domain/activity";
import { outreachBlock } from "@/domain/suppression";
import { normalizeDomain } from "@/domain/normalize";
import { isLateLogged, localDate } from "@/domain/time";
import { normalizePhone } from "@/domain/normalize";
import { targetKey } from "../target-key";
import { BlockedError, RuleError } from "../errors";
import { userRow } from "./common";
import { emitActivityLogged } from "../activity-hooks";

const optUuid = z.union([z.literal(""), z.string().uuid()]).default("");

export const fastContactSchema = z.object({
  company_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  country: z.enum(MARKETS),
  contact_type: z.enum(CONTACT_TYPES).default("professional_named"),
  niche: z.string().trim().max(120).default(""),
});

export const logActivitySchema = z.object({
  idempotency_key: z.string().uuid(),
  activity_type: z.enum(ACTIVITY_TYPES),
  channel: z.enum(FOLLOW_UP_CHANNELS).nullable().default(null),
  account_id: optUuid,
  contact_id: optUuid,
  opportunity_id: optUuid,
  fast_contact: fastContactSchema.nullable().default(null),
  brand: z.enum(BRANDS).nullable().default(null),
  outcome: z.enum(OUTCOMES).nullable().default(null),
  objection: z.enum(OBJECTIONS).nullable().default(null),
  objections: z.array(z.enum(OBJECTIONS)).max(12).default([]),
  replies: z.array(z.string().regex(/^[a-z_]+#\d{1,2}$/)).max(12).default([]),
  duration_sec: z.number().int().min(0).max(4 * 3600).nullable().default(null),
  objection_note: z.string().trim().max(500).default(""),
  met_person: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(4_000).default(""),
  next_action: z.string().trim().max(300).default(""),
  next_action_due: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  call_session_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  list_id: z.string().max(40).default(""),
  /** Free dialling only: used to match the CRM, check suppression and hash; never stored. */
  phone_dialled: z.string().trim().max(40).default(""),
  market: z.enum(MARKETS).nullable().default(null),
});
export type LogActivityInput = z.infer<typeof logActivitySchema>;

export function ruleChannelOf(type: Row<"ActivityEvents">["activity_type"], channel: string | null): RuleChannel | null {
  if (["cold_call", "connected_call", "voicemail"].includes(type)) return "phone";
  if (type === "cold_email") return "email";
  if (["linkedin_dm", "linkedin_invitation", "inmail"].includes(type)) return "linkedin";
  if (type === "field_visit") return "field_visit";
  if (type === "follow_up") return channel === "email" ? "email" : channel === "phone" || channel === "whatsapp" ? "phone" : channel === "in_person" ? "field_visit" : channel === "linkedin" ? "linkedin" : null;
  return null;
}

export interface LogResult {
  event: Row<"ActivityEvents">;
  duplicate: boolean;
  created: { accountId?: string; contactId?: string };
  warnings: string[];
}

/**
 * Logs one activity as a single append-only event (spec 4.2). Retrying with the same
 * idempotency_key returns the original event and appends nothing. Opt-outs are a hard block.
 */
export async function logActivity(repo: DataRepository, founder: FounderKey, input: LogActivityInput, now = new Date()): Promise<LogResult> {
  const actor = { founder };
  const t = await repo.listMany(["ActivityEvents", "Accounts", "Contacts", "SuppressionList", "Opportunities", "ChannelRules"]);
  const existing = dedupeEvents(t.ActivityEvents.rows).find((e) => e.idempotency_key === input.idempotency_key);
  if (existing) return { event: existing, duplicate: true, created: {}, warnings: [] };
  // Check the fresh tail too: a concurrent retry may have landed since our cached read.
  const fresh = await repo.list("ActivityEvents", { fresh: true });
  const freshDup = dedupeEvents(fresh.rows).find((e) => e.idempotency_key === input.idempotency_key);
  if (freshDup) return { event: freshDup, duplicate: true, created: {}, warnings: [] };

  const user = await userRow(repo, founder);
  const tz = user.timezone;
  const occurredAt = input.occurred_at ? new Date(input.occurred_at) : now;
  if (occurredAt.getTime() > now.getTime() + 5 * 60_000) throw new RuleError("An activity cannot be logged in the future.");

  let accountId = input.account_id;
  let contactId = input.contact_id;
  const created: LogResult["created"] = {};
  let account = t.Accounts.rows.find((a) => a.id === accountId) ?? null;
  let contact = t.Contacts.rows.find((c) => c.id === contactId) ?? null;
  const opp = input.opportunity_id ? t.Opportunities.rows.find((o) => o.id === input.opportunity_id) ?? null : null;
  if (input.opportunity_id && !opp) throw new RuleError("The selected opportunity no longer exists.");
  if (opp && !accountId) {
    accountId = opp.account_id;
    account = t.Accounts.rows.find((a) => a.id === accountId) ?? null;
  }
  if (contact && !accountId) {
    accountId = contact.account_id;
    account = t.Accounts.rows.find((a) => a.id === accountId) ?? null;
  }
  if (accountId && !account) throw new RuleError("The selected business no longer exists.");
  if (contactId && !contact) throw new RuleError("The selected contact no longer exists.");

  // Fast contact: deterministic ids from the idempotency key, so a retry cannot duplicate them.
  if (!accountId && input.fast_contact) {
    const fc = input.fast_contact;
    const accId = childId(input.idempotency_key, "account");
    const conId = childId(input.idempotency_key, "contact");
    const domain = normalizeDomain(fc.email);
    const newAcc: NewRow<"Accounts"> = {
      id: accId, name: fc.company_name, sector: "", niche: fc.niche, country: fc.country, city: "", website: "",
      domain_normalized: domain, phone: fc.phone, email: fc.email, linkedin_url: "", lead_source: "Quick action",
      lead_type: "outbound", brand: input.brand, owner_founder: founder, lead_status: "working", observed_problem: "",
      problem_evidence: "", language: fc.country === "FR" ? "fr" : "es", notes: "", import_batch_id: "",
    };
    const already = t.Accounts.rows.find((a) => a.id === accId);
    account = already ?? (await repo.insert("Accounts", [newAcc], actor))[0];
    accountId = accId;
    created.accountId = accId;
    const alreadyC = t.Contacts.rows.find((c) => c.id === conId);
    contact =
      alreadyC ??
      (
        await repo.insert(
          "Contacts",
          [{
            id: conId, account_id: accId, full_name: fc.contact_name, role: "", is_decision_maker: false, phone: fc.phone,
            email: fc.email, linkedin_url: "", contact_type: fc.contact_type, language: newAcc.language, consent_status: "unknown",
            lawful_basis: "", source: "Quick action", retention_review_at: null, import_batch_id: "",
          }],
          actor,
        )
      )[0];
    contactId = conId;
    created.contactId = conId;
  }

  // Call mode, free dialling: a number already in the CRM is attached to its business.
  let tKey = "";
  if (!accountId && input.call_session_id && input.phone_dialled) {
    const n = normalizePhone(input.phone_dialled, input.market);
    const match = n ? t.Accounts.rows.find((a) => normalizePhone(a.phone, a.country) === n) ?? null : null;
    if (match) {
      account = match;
      accountId = match.id;
    } else {
      tKey = targetKey(input.phone_dialled, input.market);
      const supp = await repo.list("SuppressionList", { fresh: true });
      if (n && supp.rows.some((e) => !e.is_archived && e.kind === "phone" && e.value_normalized === n)) throw new BlockedError("This phone number is on the suppression list.");
    }
  }
  if (isOutreach(input.activity_type) && !accountId && !input.call_session_id) throw new RuleError("Choose a business or add one before logging outreach.");

  // Hard block across founders and channels (spec 5.5). Checked on fresh suppression data.
  const warnings: string[] = [];
  if (isOutreach(input.activity_type)) {
    const supp = await repo.list("SuppressionList", { fresh: true });
    const contactsFresh = contactId ? await repo.get("Contacts", contactId, { fresh: true }) : null;
    // Opting a contact out also suppresses their email and phone, so the account-level check
    // catches a call to the same number even when no contact is selected.
    const block = outreachBlock((contactsFresh ?? contact) as never, account as never, supp.rows);
    if (block.blocked) throw new BlockedError(block.reason ?? "Outreach to this contact is blocked.");
    const rc = ruleChannelOf(input.activity_type, input.channel);
    const ct = (contactsFresh ?? contact)?.contact_type;
    if (rc && ct && account?.country) {
      const rule = t.ChannelRules.rows.find((r) => r.market === account!.country && r.contact_type === ct && r.channel === rc);
      if (rule && rule.status !== "allowed") warnings.push(`Channel rule: ${rule.status.replace(/_/g, " ")}. ${rule.note}`.trim());
    }
  }

  const loggedAt = now.toISOString();
  const event: NewRow<"ActivityEvents"> = {
    id: newId(),
    idempotency_key: input.idempotency_key,
    founder_key: founder,
    activity_type: input.activity_type,
    channel: input.channel,
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: input.opportunity_id || "",
    campaign_id: "",
    brand: input.brand ?? opp?.brand ?? account?.brand ?? null,
    market: account?.country ?? input.market ?? null,
    outcome: input.outcome,
    objection: input.objection ?? input.objections[0] ?? null,
    objections: [...new Set([...(input.objection ? [input.objection] : []), ...input.objections])],
    replies: [...new Set(input.replies)],
    objection_note: input.objection_note,
    met_person: input.met_person,
    notes: input.notes,
    next_action: input.next_action,
    next_action_due: input.next_action_due || null,
    occurred_at: occurredAt.toISOString(),
    logged_at: loggedAt,
    timezone: tz,
    local_date: localDate(occurredAt, tz),
    late_logged: isLateLogged(occurredAt.toISOString(), loggedAt, tz),
    source: "manual",
    corrects_event_id: "",
    call_session_id: input.call_session_id,
    list_id: input.list_id || account?.list_id || "",
    target_key: tKey,
    duration_sec: input.duration_sec,
  };
  const [row] = await repo.insert("ActivityEvents", [event], actor);
  // Founder's own tracker (LIVE only, fire-and-forget: a tracker failure never fails this action).
  emitActivityLogged(repo, founder, row, account?.name ?? "");

  // Repairable caches on the opportunity (spec 4.2): next action and first-touch stage.
  if (opp) {
    const patch: Partial<Row<"Opportunities">> = {};
    if (input.next_action || input.next_action_due) {
      patch.next_action = input.next_action;
      patch.next_action_due = input.next_action_due || null;
    }
    const advance = opp.stage === "targeted" && isOutreach(input.activity_type);
    if (advance) patch.stage = "contacted";
    if (Object.keys(patch).length) {
      try {
        const fresh = await repo.get("Opportunities", opp.id, { fresh: true });
        if (fresh) {
          await repo.update("Opportunities", opp.id, fresh.version, patch, actor);
          if (advance && fresh.stage === "targeted") {
            await repo.insert(
              "OpportunityStageEvents",
              [{ id: childId(row.id, "stage"), opportunity_id: opp.id, from_stage: "targeted", to_stage: "contacted", changed_at: loggedAt, changed_by: founder, reason: "First outreach logged" }],
              actor,
            );
          }
        }
      } catch {
        warnings.push("The activity was saved, but the opportunity's next action could not be updated. Edit it on the opportunity.");
      }
    }
  }
  return { event: row, duplicate: false, created, warnings };
}
