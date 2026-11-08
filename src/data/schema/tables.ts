import { z } from "zod";
import {
  ACTIVITY_SOURCES,
  ACTIVITY_TYPES,
  BRANDS,
  CONSENT_STATUSES,
  CONTACT_TYPES,
  FOLLOW_UP_CHANNELS,
  FOUNDERS,
  LEAD_STATUSES,
  LEAD_TYPES,
  MARKETS,
  METRICS,
  OBJECTIONS,
  OUTCOMES,
  RULE_CHANNELS,
  RULE_STATUSES,
  STAGES,
  SUPPRESSION_KINDS,
  WORK_MODES,
} from "@/domain/constants";
import { bool, day, int, iso, json, oneOf, optDay, optInt, optIso, optOneOf, reqText, text } from "./codecs";

/** Revision domains: a mutation in a table bumps its domain token (spec 4.1). */
export const DOMAINS = ["settings", "activity", "crm", "audit"] as const;
export type Domain = (typeof DOMAINS)[number];

const base = {
  id: z.preprocess((v) => String(v ?? "").trim(), z.string().uuid()),
  created_at: iso(),
  updated_at: iso(),
  updated_by: text(40),
  version: int(),
  is_archived: bool(),
  write_id: text(40),
};

const founder = () => oneOf(FOUNDERS);
const optFounder = () => optOneOf(FOUNDERS);

const targetSnapshot = z.record(
  z.string(),
  z.object({ target: z.number().int().min(0), weight: z.number().min(0), minutes: z.number().min(0) }),
);

export const TABLES = {
  SystemSettings: {
    domain: "settings",
    shape: { ...base, key: reqText(80), value: text(20_000), description: text(500) },
  },
  Users: {
    domain: "settings",
    shape: {
      ...base,
      founder_key: founder(),
      display_name: reqText(80),
      role: oneOf(["founder", "admin"] as const),
      timezone: reqText(60),
      workdays: json(z.array(z.number().int().min(0).max(6)), [1, 2, 3, 4, 5]),
      capacity_minutes: int(),
      onboarded_at: optIso(),
    },
  },
  WorkModes: {
    domain: "settings",
    shape: { ...base, founder_key: founder(), mode: oneOf(WORK_MODES), effective_from: day(), reason: text(300) },
  },
  DailyTargets: {
    domain: "settings",
    shape: {
      ...base,
      founder_key: founder(),
      mode: oneOf(WORK_MODES),
      metric: oneOf(METRICS),
      target: int(),
      weight: int(),
      minutes_per_action: int(),
      effective_from: day(),
    },
  },
  DailyPlans: {
    domain: "settings",
    shape: {
      ...base,
      founder_key: founder(),
      local_date: day(),
      timezone: reqText(60),
      mode: oneOf(WORK_MODES),
      is_workday: bool(),
      capacity_minutes: int(),
      targets: json(targetSnapshot, {}),
    },
  },
  ActivityEvents: {
    domain: "activity",
    shape: {
      ...base,
      idempotency_key: reqText(80),
      founder_key: founder(),
      activity_type: oneOf(ACTIVITY_TYPES),
      channel: optOneOf(FOLLOW_UP_CHANNELS),
      account_id: text(40),
      contact_id: text(40),
      opportunity_id: text(40),
      campaign_id: text(40),
      brand: optOneOf(BRANDS),
      market: optOneOf(MARKETS),
      outcome: optOneOf(OUTCOMES),
      objection: optOneOf(OBJECTIONS),
      objection_note: text(500),
      met_person: text(200),
      notes: text(4_000),
      next_action: text(300),
      next_action_due: optDay(),
      occurred_at: iso(),
      logged_at: iso(),
      timezone: reqText(60),
      local_date: day(),
      late_logged: bool(),
      source: oneOf(ACTIVITY_SOURCES),
      corrects_event_id: text(40),
    },
  },
  Accounts: {
    domain: "crm",
    shape: {
      ...base,
      name: reqText(200),
      sector: text(120),
      niche: text(120),
      country: optOneOf(MARKETS),
      city: text(120),
      website: text(300),
      domain_normalized: text(200),
      phone: text(40),
      email: text(200),
      linkedin_url: text(300),
      lead_source: text(120),
      lead_type: optOneOf(LEAD_TYPES),
      brand: optOneOf(BRANDS),
      owner_founder: optFounder(),
      lead_status: oneOf(LEAD_STATUSES),
      observed_problem: text(1_000),
      problem_evidence: text(1_000),
      language: text(10),
      notes: text(4_000),
      import_batch_id: text(40),
    },
  },
  Contacts: {
    domain: "crm",
    shape: {
      ...base,
      account_id: text(40),
      full_name: text(200),
      role: text(120),
      is_decision_maker: bool(),
      phone: text(40),
      email: text(200),
      linkedin_url: text(300),
      contact_type: oneOf(CONTACT_TYPES),
      language: text(10),
      consent_status: oneOf(CONSENT_STATUSES),
      lawful_basis: text(300),
      source: text(120),
      retention_review_at: optDay(),
      import_batch_id: text(40),
    },
  },
  Opportunities: {
    domain: "crm",
    shape: {
      ...base,
      account_id: reqText(40),
      primary_contact_id: text(40),
      name: reqText(200),
      brand: oneOf(BRANDS),
      market: optOneOf(MARKETS),
      stage: oneOf(STAGES),
      owner_founder: optFounder(),
      value_minor: optInt(),
      currency: text(3),
      expected_close: optDay(),
      next_action: text(300),
      next_action_due: optDay(),
      next_action_priority: optOneOf(["high", "normal"] as const),
      lost_reason: text(500),
      anum_authority: text(500),
      anum_need: text(500),
      anum_urgency: text(500),
      anum_money: text(500),
    },
  },
  OpportunityStageEvents: {
    domain: "crm",
    shape: {
      ...base,
      opportunity_id: reqText(40),
      from_stage: optOneOf(STAGES),
      to_stage: oneOf(STAGES),
      changed_at: iso(),
      changed_by: founder(),
      reason: text(500),
    },
  },
  ChannelRules: {
    domain: "settings",
    shape: {
      ...base,
      market: oneOf(MARKETS),
      contact_type: oneOf(CONTACT_TYPES),
      channel: oneOf(RULE_CHANNELS),
      status: oneOf(RULE_STATUSES),
      note: text(1_000),
      source_url: text(300),
      review_date: optDay(),
    },
  },
  SuppressionList: {
    domain: "crm",
    shape: {
      ...base,
      kind: oneOf(SUPPRESSION_KINDS),
      value_normalized: text(300),
      contact_id: text(40),
      account_id: text(40),
      reason: text(300),
      added_by: founder(),
    },
  },
  AuditLog: {
    domain: "audit",
    shape: {
      ...base,
      actor: text(40),
      action: reqText(60),
      table_name: text(60),
      record_id: text(40),
      fields: text(1_000),
      correlation_id: text(40),
    },
  },
  SchemaMigrations: {
    domain: "settings",
    shape: { ...base, schema_version: int(), schema_hash: reqText(80), applied_at: iso(), notes: text(500) },
  },
} as const;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

type Shape<T extends TableName> = (typeof TABLES)[T]["shape"];
type RowMap = { [K in TableName]: z.infer<z.ZodObject<Shape<K>>> };
export interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  version: number;
  is_archived: boolean;
  write_id: string;
}
export type Row<T extends TableName> = RowMap[T] & BaseRow;
export type BaseFields = keyof typeof base;
export type NewRow<T extends TableName> = Omit<Row<T>, Exclude<BaseFields, "id">> & { id: string };

const schemaCache = new Map<TableName, z.ZodObject<z.ZodRawShape>>();
export function tableSchema<T extends TableName>(name: T): z.ZodObject<Shape<T>> {
  let s = schemaCache.get(name);
  if (!s) {
    s = z.object(TABLES[name].shape as z.ZodRawShape);
    schemaCache.set(name, s);
  }
  return s as unknown as z.ZodObject<Shape<T>>;
}

export function columnsOf(name: TableName): string[] {
  return Object.keys(TABLES[name].shape);
}

export function domainOf(name: TableName): Domain {
  return TABLES[name].domain as Domain;
}

/** Revision tokens live in a small dedicated tab read by polling (spec 4.1). */
export const REVISIONS_TAB = "_Revisions";
export const DOCTOR_TAB = "_Doctor";
export const SCHEMA_VERSION = 1;
