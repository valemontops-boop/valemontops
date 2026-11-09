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
  LEGACY_WORK_MODES,
} from "@/domain/constants";
import { BANK_CATEGORIES } from "@/domain/bank";
import { INBOX_SOURCES, INBOX_STATUSES } from "@/domain/inbox";
import { bool, day, int, iso, json, oneOf, oneOfAlias, oneOfOr, optDay, optInt, optIso, optOneOf, reqText, text } from "./codecs";

/** Revision domains: a mutation in a table bumps its domain token (spec 4.1). */
export const DOMAINS = ["settings", "activity", "crm", "audit", "work", "audience", "private", "finance"] as const;
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
/** Work mode cells accept the pre-round-8 names (JOB_SEARCHING, EMPLOYED_35H) and read them as FULL_TIME / REDUCED. */
const workMode = () => oneOfAlias(WORK_MODES, LEGACY_WORK_MODES);
const optFounder = () => optOneOf(FOUNDERS);

function taskShape() {
  return {
    ...base,
    title: reqText(300),
    description: text(4_000),
    owner: optFounder(),
    created_by_founder: founder(),
    account_id: text(40),
    opportunity_id: text(40),
    project_id: text(40),
    client_id: text(40),
    priority: oneOf(["P0", "P1", "P2", "P3"] as const),
    status: oneOf(["todo", "in_progress", "done", "cancelled"] as const),
    estimated_minutes: optInt(),
    due_at: optDay(),
    recurrence: oneOf(["none", "daily", "weekdays", "weekly", "monthly"] as const),
    recurrence_parent_id: text(40),
    /** Late column: weekdays 0–6 (0 = Sunday) for a "weekly" recurrence; [] = same weekday as the due date. */
    recurrence_days: json(z.array(z.number().int().min(0).max(6)).max(7), []),
    dependency_ids: json(z.array(z.string()), []),
    completion_evidence: text(1_000),
    completed_at: optIso(),
    visibility: oneOf(["team", "private"] as const),
    snoozed_until: optDay(),
    snooze_reason: text(300),
    area: oneOfOr(["sales", "marketing", "ops"] as const, "sales"),
    source: oneOf(["manual", "founder_point", "idea", "system"] as const),
    source_id: text(40),
  };
}

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
      avail_start: text(5),
      avail_end: text(5),
    },
  },
  WorkModes: {
    domain: "settings",
    shape: { ...base, founder_key: founder(), mode: workMode(), effective_from: day(), reason: text(300) },
  },
  DailyTargets: {
    domain: "settings",
    shape: {
      ...base,
      founder_key: founder(),
      mode: workMode(),
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
      mode: workMode(),
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
      call_session_id: text(40),
      list_id: text(40),
      /** Keyed hash of the normalised phone for calls to numbers not in the CRM (no number stored for a refusal). */
      target_key: text(80),
      duration_sec: optInt(),
      /** Every objection heard during the call, whatever the outcome (objection keeps the first one). */
      objections: json(z.array(z.enum(OBJECTIONS)), []),
      /** Reply variants used during the call ("too_expensive#2"), to learn which reply works best. */
      replies: json(z.array(z.string().max(60)), []),
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
      list_id: text(40),
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
      next_action_reason: text(300),
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
  Tasks: { domain: "work", shape: taskShape() },
  TaskComments: {
    domain: "work",
    shape: { ...base, task_id: reqText(40), author: founder(), body: reqText(2_000) },
  },
  DailyReviews: {
    domain: "work",
    shape: { ...base, founder_key: founder(), local_date: day(), went_well: text(1_000), blockers: text(1_000), tomorrow_priority: text(300) },
  },
  DailyResults: {
    domain: "work",
    shape: {
      ...base,
      founder_key: founder(),
      local_date: day(),
      status: oneOf(["passed", "perfect", "missed", "off"] as const),
      attainment_pct: optInt(),
      followups_ok: bool(),
      review_done: bool(),
      computed_at: iso(),
      correction_count: int(),
    },
  },
  DailyResultCorrections: {
    domain: "work",
    shape: { ...base, founder_key: founder(), local_date: day(), reason: reqText(500), event_ids: json(z.array(z.string()), []) },
  },
  Sprints: {
    domain: "work",
    shape: {
      ...base,
      name: reqText(120),
      start_date: day(),
      end_date: day(),
      status: oneOf(["planned", "active", "done", "cancelled"] as const),
      niche: text(200),
      targets: json(z.record(z.string(), z.object({ contacted: z.number().int(), replies: z.number().int(), demos: z.number().int(), pilots: z.number().int() })), {}),
      brand_split: json(z.record(z.string(), z.number()), {}),
    },
  },
  WeeklyReviews: {
    domain: "work",
    shape: { ...base, week_start: day(), decisions: text(4_000), notes: text(4_000), priority_theo: text(300), priority_pablo: text(300), worked: text(4_000), blocked: text(4_000) },
  },
  Ideas: {
    domain: "work",
    shape: {
      ...base,
      text: reqText(300),
      note: text(2_000),
      brand: optOneOf(BRANDS),
      category: oneOf(["offer", "content", "product", "process", "partner", "other"] as const),
      status: oneOf(["new", "discuss", "testing", "parked", "done", "rejected"] as const),
      votes: json(z.record(z.string(), z.enum(["yes", "maybe", "no"])), {}),
      reason: text(500),
      created_by_founder: founder(),
      converted_type: optOneOf(["task", "opportunity"] as const),
      converted_id: text(40),
    },
  },
  FounderPoints: {
    domain: "work",
    shape: {
      ...base,
      title: reqText(160),
      type: oneOf(["daily", "weekly_review", "decision", "ad_hoc"] as const),
      duration_min: int(),
      status: oneOf(["scheduled", "done", "cancelled", "moved_in_calendar", "deleted_in_calendar"] as const),
      start_at: optIso(),
      calendar_event_id: text(1_100),
      recurrence: optOneOf(["daily", "weekly"] as const),
      notes: text(4_000),
    },
  },
  FounderPointItems: {
    domain: "work",
    shape: {
      ...base,
      point_id: reqText(40),
      kind: oneOf(["agenda", "decision", "action"] as const),
      text: reqText(500),
      done: bool(),
      owner: optFounder(),
      task_id: text(40),
      idea_id: text(40),
    },
  },
  CalendarSources: {
    domain: "settings",
    shape: {
      ...base,
      calendar_id: reqText(300),
      label: reqText(80),
      kind: oneOf(["shared", "personal"] as const),
      owner_founder: optFounder(),
      access: oneOf(["free_busy", "details"] as const),
    },
  },
  CalendarLinks: {
    domain: "work",
    shape: { ...base, calendar_id: reqText(300), event_id: reqText(1_100), record_type: reqText(40), record_id: reqText(40) },
  },
  NotificationStates: {
    domain: "work",
    shape: { ...base, founder_key: founder(), dedupe_key: reqText(200), dismissed_at: iso() },
  },
  FilesIndex: {
    domain: "crm",
    shape: {
      ...base,
      file_id: reqText(200),
      name: reqText(300),
      mime_type: text(120),
      url: text(500),
      record_type: oneOf(["account", "opportunity", "task", "idea"] as const),
      record_id: reqText(40),
      linked_by: founder(),
    },
  },
  SocialAccounts: {
    domain: "audience",
    shape: {
      ...base,
      platform: oneOf(["instagram", "linkedin_page", "linkedin_personal"] as const),
      handle: reqText(120),
      brand: optOneOf(BRANDS),
      market: optOneOf(MARKETS),
      owner_founder: optFounder(),
      connection_mode: oneOf(["manual", "import", "api"] as const),
      visibility: oneOf(["team", "owner"] as const),
    },
  },
  SocialAccountDaily: {
    domain: "audience",
    shape: {
      ...base,
      account_id: reqText(40),
      date: day(),
      followers: optInt(),
      views: optInt(),
      impressions: optInt(),
      reach: optInt(),
      profile_visits: optInt(),
      interactions: optInt(),
      link_clicks: optInt(),
      source: oneOf(["api", "import", "manual"] as const),
      captured_at: iso(),
      import_file: text(200),
    },
  },
  IntegrationStatuses: {
    domain: "settings",
    shape: { ...base, integration: reqText(60), status: reqText(40), last_success_at: optIso(), last_error: text(500) },
  },
  CallLists: {
    domain: "crm",
    shape: {
      ...base,
      name: reqText(160),
      source: text(200),
      market: optOneOf(MARKETS),
      niche: text(120),
      brand: optOneOf(BRANDS),
      owner_founder: optFounder(),
      notes: text(1_000),
    },
  },
  CallSessions: {
    domain: "activity",
    shape: {
      ...base,
      founder_key: founder(),
      list_id: text(40),
      started_at: iso(),
      ended_at: optIso(),
      notes: text(1_000),
    },
  },
  ContentLog: {
    domain: "audience",
    shape: {
      ...base,
      idempotency_key: reqText(80),
      founder_key: founder(),
      deliverable: oneOf(["concept", "reel", "brand_post", "personal_post", "story", "vsl"] as const),
      brand: optOneOf(BRANDS),
      language: optOneOf(["FR", "ES"] as const),
      title: text(200),
      url: text(500),
      local_date: day(),
    },
  },
  AudienceBreakdown: {
    domain: "audience",
    shape: {
      ...base,
      account_id: reqText(40),
      date: day(),
      dimension: oneOf(["country"] as const),
      key: reqText(60),
      value: int(), // followers or share in basis points, see unit
      unit: oneOf(["count", "bp"] as const),
      source: oneOf(["api", "import", "manual"] as const),
    },
  },
  TrafficDaily: {
    domain: "audience",
    shape: {
      ...base,
      date: day(),
      brand: optOneOf(BRANDS),
      source: reqText(80),
      medium: text(80),
      campaign: text(120),
      country: text(60),
      sessions: optInt(),
      leads: optInt(),
      meetings: optInt(),
      purchases: optInt(),
      revenue_minor: optInt(),
      origin: oneOf(["import", "manual", "webhook"] as const),
      import_file: text(200),
    },
  },
  /** Founder-edited scripts and templates; built-in defaults apply when no row overrides them. */
  Playbook: {
    domain: "settings",
    shape: {
      ...base,
      kind: oneOf(["opener", "objection", "email", "whatsapp", "linkedin"] as const),
      key: reqText(60),
      language: oneOf(["FR", "ES"] as const),
      subject: text(300),
      body: text(5_000),
    },
  },
  /** One row per follow-up sent to a prospect (email or WhatsApp). Replies are marked by a founder (gmail.send only, no inbox access). */
  EmailSends: {
    domain: "activity",
    shape: {
      ...base,
      idempotency_key: reqText(80),
      founder_key: founder(),
      account_id: text(40),
      contact_id: text(40),
      activity_event_id: text(40),
      call_session_id: text(40),
      channel: oneOf(["email", "whatsapp"] as const),
      via: oneOf(["gmail", "mail_app", "whatsapp"] as const),
      context: oneOf(["after_call", "cold"] as const),
      template_key: text(60),
      language: optOneOf(["FR", "ES"] as const),
      brand: optOneOf(BRANDS),
      market: optOneOf(MARKETS),
      niche: text(120),
      to_address: text(200),
      subject: text(300),
      status: oneOf(["pending", "sent", "failed"] as const),
      sent_at: optIso(),
      local_date: optDay(),
      gmail_message_id: text(80),
      gmail_thread_id: text(80),
      replied_at: optIso(),
      reply_kind: optOneOf(["positive", "neutral", "negative", "bounce"] as const),
    },
  },
  /** Bank movements (Wise): from the API statement, live webhooks or a CSV export. Amounts in minor units, signed. */
  BankTransactions: {
    domain: "finance",
    shape: {
      ...base,
      bank: oneOf(["wise", "stripe"] as const),
      source_id: reqText(120),
      origin: oneOf(["api", "webhook", "csv", "demo"] as const),
      balance_id: text(40),
      currency: reqText(3),
      amount_minor: int(),
      fee_minor: optInt(),
      direction: oneOf(["credit", "debit"] as const),
      date: day(),
      occurred_at: iso(),
      description: text(500),
      counterparty: text(200),
      bank_type: text(60),
      merchant_category: text(120),
      category: oneOf(BANK_CATEGORIES),
      category_source: oneOf(["auto", "manual"] as const),
      running_balance_minor: optInt(),
      note: text(500),
    },
  },
  BankBalances: {
    domain: "finance",
    shape: {
      ...base,
      bank: oneOf(["wise", "stripe"] as const),
      balance_id: reqText(40),
      currency: reqText(3),
      name: text(120),
      amount_minor: int(),
      as_of: iso(),
    },
  },
  /** Recurring revenue measured each day from Stripe subscriptions (one row per day, the latest wins). */
  RevenueSnapshots: {
    domain: "finance",
    shape: { ...base, source: oneOf(["stripe"] as const), date: day(), currency: reqText(3), mrr_minor: int(), active_subscriptions: int() },
  },
  /**
   * "To reply" inbox (round 8): comments and messages waiting for an answer. One row per external item
   * (id = UUIDv5 of external_id, so a webhook delivered twice adds nothing). Items derived from EmailSends,
   * ActivityEvents and Accounts are only written when a founder marks them replied or ignored.
   */
  InboxItems: {
    domain: "work",
    shape: {
      ...base,
      source: oneOf(INBOX_SOURCES),
      account_label: text(120),
      from_name: text(200),
      excerpt: text(500),
      url: text(1_000),
      received_at: iso(),
      status: oneOf(INBOX_STATUSES),
      assigned_founder: optFounder(),
      replied_at: optIso(),
      external_id: reqText(200),
    },
  },
  /* ----- private founder spreadsheets only (spec 4.7) ----- */
  PrivateTasks: { domain: "private", shape: taskShape() },
} as const;

export type TableName = keyof typeof TABLES;
export const PRIVATE_TABLES: TableName[] = ["PrivateTasks"];
/** Tabs of the shared production Sheet. Private tables live only in each founder's own spreadsheet. */
export const TABLE_NAMES = (Object.keys(TABLES) as TableName[]).filter((t) => !PRIVATE_TABLES.includes(t));

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
/** Columns added after a table was first created: optional on create, filled by CREATE_DEFAULTS. */
export const CREATE_DEFAULTS: Record<string, unknown> = { list_id: "", call_session_id: "", target_key: "", duration_sec: null, area: "sales", objections: [], replies: [], recurrence_days: [] , worked: "", blocked: "" };
type LateKeys = "list_id" | "call_session_id" | "target_key" | "duration_sec" | "area" | "objections" | "replies" | "recurrence_days" | "worked" | "blocked";
export type NewRow<T extends TableName> = Omit<Row<T>, Exclude<BaseFields, "id"> | LateKeys> &
  Partial<Pick<Row<T>, Extract<keyof Row<T>, LateKeys>>> & { id: string };

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
export const SCHEMA_VERSION = 2;
