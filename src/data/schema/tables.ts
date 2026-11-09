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
import { COST_CENTERS, COST_CLASSES } from "@/domain/finance-constants";
import { INBOX_SOURCES, INBOX_STATUSES } from "@/domain/inbox";
import { LADDER_STEPS } from "@/domain/calls";
import { BILLINGS, ITEM_KINDS, PRICE_MODES, QUOTE_STATUSES, UNITS } from "@/domain/quotes";
import { AUDIT_LANGUAGES, COMPLEXITIES, SECTORS, questionsSchema, summarySchema } from "@/domain/audit";
import { CONTENT_FORMATS, LEGACY_FORMATS, LEGACY_STAGES, LINK_PLACEMENTS, PRODUCTION_STAGES, SNAPSHOT_CHECKPOINTS, VARIANT_STATUSES } from "@/domain/content-studio";
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
      /** Downsell ladder during the call (D071): "local" / "thirty" offered, "_yes" = accepted. */
      offers_pitched: json(z.array(z.enum(LADDER_STEPS)), []),
      /** Call-back time set after the call (D080, late column): the queue brings the business back first once it is due. */
      next_action_at: optIso(),
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
      /* Stage 4B (D084): the central route() hook. Never values: field names, a keyed hash of the input, a keyed IP hash. */
      http_status: optInt(),
      audit_scope: oneOfOr(["team", "private"] as const, "team"),
      input_hash: text(20),
      ip_hash: text(20),
    },
  },
  /** Stage 4B (D084): one row per backup attempt; the day's "done" row id = UUIDv5(backup-run, day, done). Leases are rows too. */
  BackupRuns: {
    domain: "audit",
    shape: {
      ...base,
      day: day(),
      trigger: oneOf(["scheduler", "first_request", "founder"] as const),
      status: oneOf(["running", "done", "error"] as const),
      owner: text(40),
      file_id: text(200),
      file_name: text(200),
      file_url: text(500),
      tabs: optInt(),
      rows: optInt(),
      verify_status: oneOfOr(["ok", "mismatch", "not_run"] as const, "not_run"),
      verify_detail: text(1_000),
      deleted: optInt(),
      error: text(500),
      started_at: iso(),
      finished_at: optIso(),
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
      deliverable: oneOf(["concept", "reel", "brand_post", "personal_post", "story", "vsl", "ig_post"] as const),
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
      kind: oneOf(["opener", "objection", "email", "whatsapp", "linkedin", "inbox"] as const),
      key: reqText(60),
      language: oneOf(["FR", "ES"] as const),
      subject: text(300),
      body: text(5_000),
      /** Late column (D090): the founders' name for their own template (key `custom_<32 hex>`); empty for built-in texts. */
      template_name: text(80),
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
      /* Late columns (D085): a payment in another currency out of this balance (e.g. a USD transfer to a contractor paid
         from the EUR balance): that currency and the amount sent, from Wise's statement exchange details or CSV. */
      fx_currency: text(3),
      fx_amount_minor: optInt(),
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
   * "To reply" inbox (iteration 8): comments and messages waiting for an answer. One row per external item
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
  /**
   * Google Search Console "Performance" export (iteration 9, D072): one row per query or page for an export period and a
   * language (FR or ES property). id = UUIDv5(language, period, dimension, key): re-importing adds nothing, a manual entry
   * for the same key updates it. Position stored × 10 (integer cells); CTR is derived (clicks / impressions).
   */
  SearchConsoleRows: {
    domain: "audience",
    shape: {
      ...base,
      period_start: day(),
      period_end: day(),
      language: oneOf(["FR", "ES"] as const),
      dimension: oneOf(["query", "page"] as const),
      key: reqText(500),
      clicks: int(),
      impressions: int(),
      position_x10: int(),
      origin: oneOf(["import", "manual"] as const),
      import_file: text(200),
    },
  },
  /** Site audit runs (iteration 9): the last row is shown in Growth › Web › SEO. Pages and issues are compact JSON. */
  SeoAudits: {
    domain: "audience",
    shape: {
      ...base,
      run_at: iso(),
      founder_key: founder(),
      site_urls: text(1_000),
      pages_checked: int(),
      facts: json(z.object({ robots: z.boolean(), sitemap: z.boolean(), llms: z.boolean() }), { robots: false, sitemap: false, llms: false }),
      pages: json(z.array(z.object({ url: z.string(), status: z.number(), bytes: z.number(), titleLength: z.number(), metaLength: z.number(), h1Count: z.number(), canonical: z.boolean(), hreflang: z.array(z.string()), og: z.boolean(), types: z.array(z.string()), imagesWithoutAlt: z.number(), noindex: z.boolean() })), []),
      issues: json(z.array(z.object({ code: z.string(), severity: z.enum(["act", "watch"]), page: z.string(), vars: z.record(z.string(), z.union([z.string(), z.number()])) })), []),
    },
  },
  /* ----- Stage 2B: delivery, registries, Local usage (D075) ----- */
  /**
   * Multi-tab workflows (spec 4.4): one row per workflow and subject, id = UUIDv5(workflow, subject). `steps` holds each
   * step's status and the deterministic child ids it wrote; a retry skips finished steps. `input` is frozen at the first run.
   */
  WorkflowRuns: {
    domain: "work",
    shape: {
      ...base,
      workflow: oneOf(["won_to_project"] as const),
      subject_type: oneOf(["opportunity"] as const),
      subject_id: reqText(40),
      status: oneOf(["running", "done", "failed"] as const),
      steps: json(z.record(z.string(), z.object({ status: z.enum(["pending", "done", "failed"]), at: z.string(), ids: z.array(z.string()).default([]), error: z.string().default("") })), {}),
      input: json(z.record(z.string(), z.unknown()), {}),
      started_by: founder(),
      last_error: text(500),
      attempts: int(),
    },
  },
  Clients: {
    domain: "work",
    shape: {
      ...base,
      account_id: reqText(40),
      opportunity_id: text(40),
      name: reqText(200),
      brand: oneOf(BRANDS),
      market: optOneOf(MARKETS),
      owner_founder: optFounder(),
      status: oneOf(["onboarding", "active", "paused", "ended"] as const),
      started_on: day(),
      workflow_run_id: text(40),
    },
  },
  Projects: {
    domain: "work",
    shape: {
      ...base,
      client_id: reqText(40),
      account_id: text(40),
      opportunity_id: text(40),
      quote_id: text(40),
      name: reqText(200),
      brand: oneOf(BRANDS),
      market: optOneOf(MARKETS),
      owner_founder: optFounder(),
      status: oneOf(["planned", "in_progress", "review", "delivered", "on_hold"] as const),
      start_date: day(),
      due_date: optDay(),
      scope: text(4_000),
      services: json(z.array(z.object({ label: z.string().max(300), qty: z.number(), unit_minor: z.number().int(), kind: z.enum(["one_off", "monthly"]) })).max(50), []),
      checklist: json(z.array(z.object({ id: z.string().max(40), label: z.string().max(300), done: z.boolean() })).max(60), []),
      revenue_one_off_minor: int(),
      mrr_minor: int(),
      term_months: optInt(),
      est_founder_hours: int(),
      est_api_minor: int(),
      est_infra_minor: int(),
      est_other_minor: int(),
      handoff_promised: text(2_000),
      handoff_stakeholders: text(1_000),
      handoff_success: text(1_000),
      source: oneOf(["quote", "offer"] as const),
      workflow_run_id: text(40),
    },
  },
  Milestones: {
    domain: "work",
    shape: { ...base, project_id: reqText(40), title: reqText(200), due_date: optDay(), done_at: optIso(), sort: int() },
  },
  /** Hours worked on a project, by a founder or a contractor (append-only; id from the client form). */
  TimeEntries: {
    domain: "work",
    shape: { ...base, project_id: reqText(40), person_kind: oneOf(["founder", "contractor"] as const), founder_key: optFounder(), vendor_id: text(40), date: day(), minutes: int(), note: text(500) },
  },
  /**
   * Direct costs booked on a project (API usage, infrastructure, other). Amounts in cents of `currency` (EUR or USD, D085).
   * Late `wise_tx_id`: the Wise movement that paid it; its real rate converts a USD cost to EUR.
   */
  ProjectCosts: {
    domain: "work",
    shape: { ...base, project_id: reqText(40), date: day(), kind: oneOf(["api", "infra", "contractor", "other"] as const), label: reqText(200), amount_minor: int(), currency: reqText(3), tool_id: text(40), wise_tx_id: text(40) },
  },
  ProjectAssignments: {
    domain: "work",
    shape: {
      ...base,
      project_id: reqText(40),
      vendor_id: reqText(40),
      role: text(200),
      rate_minor: int(),
      rate_unit: oneOf(["hour", "day", "fixed"] as const),
      currency: reqText(3),
      planned_hours: int(),
      start_date: optDay(),
      end_date: optDay(),
      status: oneOf(["planned", "active", "done", "cancelled"] as const),
      note: text(500),
    },
  },
  /** (a) HUMAN contractors and suppliers (spec 5.8). Rates are inputs; never employees, never invented contracts. */
  Vendors: {
    domain: "work",
    shape: {
      ...base,
      name: reqText(200),
      company: text(200),
      skills: json(z.array(z.string().max(60)).max(30), []),
      services: text(1_000),
      timezone: text(60),
      country: text(2),
      currency: reqText(3),
      hourly_rate_minor: optInt(),
      daily_rate_minor: optInt(),
      fixed_rate_minor: optInt(),
      capacity_hours_week: int(),
      availability: oneOf(["available", "limited", "unavailable"] as const),
      response_sla_hours: optInt(),
      nda_status: oneOf(["none", "sent", "signed"] as const),
      contract_status: oneOf(["none", "draft", "signed"] as const),
      rate_valid_until: optDay(),
      contact_email: text(200),
      contact_phone: text(40),
      notes: text(2_000),
      quality_feedback: text(2_000),
    },
  },
  /** (b) Software, AI tools and providers. Never presented as people. */
  ToolCosts: {
    domain: "work",
    shape: {
      ...base,
      name: reqText(200),
      provider: text(200),
      use_case: text(500),
      apis: text(500),
      integration_status: oneOf(["planned", "testing", "live", "retired"] as const),
      monthly_cost_minor: int(),
      currency: reqText(3),
      usage_limits: text(500),
      pricing_version: text(120),
      pricing_date: optDay(),
      owner_founder: optFounder(),
      environment: oneOf(["production", "test", "both"] as const),
      linked_project_ids: json(z.array(z.string().max(40)).max(50), []),
      risk_notes: text(1_000),
      expense_category: oneOf(BANK_CATEGORIES),
    },
  },
  /** (c) Reusable internal agent / workflow templates. Never presented as people or as proprietary third-party tech. */
  AgentTemplates: {
    domain: "work",
    shape: {
      ...base,
      name: reqText(200),
      kind: oneOf(["agent", "workflow"] as const),
      purpose: text(1_000),
      stack: text(500),
      inputs: text(500),
      outputs: text(500),
      linked_tool_ids: json(z.array(z.string().max(40)).max(30), []),
      linked_project_ids: json(z.array(z.string().max(40)).max(50), []),
      owner_founder: optFounder(),
      status: oneOf(["draft", "tested", "in_use", "retired"] as const),
      notes: text(2_000),
    },
  },
  /** Valemont Local usage per client and month, id = UUIDv5(client, month): a second entry or import updates the same row. */
  LocalSubscriptionUsage: {
    domain: "work",
    shape: {
      ...base,
      client_id: reqText(40),
      month: z.preprocess((v) => String(v ?? "").trim().slice(0, 7), z.string().regex(/^\d{4}-\d{2}$/)),
      conversations: int(),
      qualified_requests: int(),
      automated_emails: int(),
      support_minutes: int(),
      locations: int(),
      actual_cost_minor: optInt(),
      source: oneOf(["manual", "import"] as const),
      note: text(500),
    },
  },
  /* ----- Stage 2A: price book, audits, quotes, commercial policy (D074) ----- */
  /**
   * Price book, versioned by effective date: an edit appends a row for the same item_key; the latest effective_from
   * (≤ today, then created_at) is current. Amounts in cents ex VAT; hours × 100. Every seed is a pilot assumption.
   */
  PriceBookItems: {
    domain: "crm",
    shape: {
      ...base,
      item_key: reqText(60),
      effective_from: day(),
      active: bool(),
      brand: optOneOf(BRANDS),
      kind: oneOf(ITEM_KINDS),
      name_fr: reqText(200),
      name_es: reqText(200),
      unit: oneOf(UNITS),
      price_mode: oneOf(PRICE_MODES),
      one_time_min_minor: optInt(),
      one_time_max_minor: optInt(),
      monthly_min_minor: optInt(),
      monthly_max_minor: optInt(),
      price_setting_key: text(80),
      one_time_hours_x100: int(),
      monthly_hours_x100: int(),
      one_time_cost_minor: int(),
      monthly_cost_minor: int(),
      pilot_assumption: bool(),
      limits: text(1_000),
      notes: text(1_000),
    },
  },
  /** Audit questionnaires (10–20 questions, JSON validated by Zod), one row per sector × complexity × language. */
  AuditTemplates: {
    domain: "crm",
    shape: {
      ...base,
      template_key: reqText(80),
      sector: oneOf(SECTORS),
      complexity: oneOf(COMPLEXITIES),
      language: oneOf(AUDIT_LANGUAGES),
      title: reqText(200),
      questions: json(questionsSchema, []),
    },
  },
  /** One audit of an opportunity: questions copied from the template (editable), answers, deterministic summary. */
  AuditSessions: {
    domain: "crm",
    shape: {
      ...base,
      opportunity_id: reqText(40),
      account_id: text(40),
      template_key: reqText(80),
      sector: oneOf(SECTORS),
      complexity: oneOf(COMPLEXITIES),
      language: oneOf(AUDIT_LANGUAGES),
      questions: json(questionsSchema, []),
      answers: json(z.record(z.string(), z.string().max(2_000)), {}),
      status: oneOf(["in_progress", "completed"] as const),
      summary: json(summarySchema.nullable(), null),
      summary_at: optIso(),
      validated_by: optFounder(),
      validated_at: optIso(),
      owner_founder: founder(),
    },
  },
  /**
   * Quotes. One row per version (quote_group_id = first version's id, reference derived from it). Lines are committed
   * copy-on-write: a save appends QuoteLines with a new lines_rev, then the version-checked header update points to it.
   */
  Quotes: {
    domain: "crm",
    shape: {
      ...base,
      quote_group_id: reqText(40),
      quote_version: int(),
      reference: reqText(40),
      opportunity_id: reqText(40),
      account_id: text(40),
      audit_session_id: text(40),
      status: oneOf(QUOTE_STATUSES),
      author: founder(),
      currency: reqText(3),
      language: oneOf(["FR", "ES"] as const),
      client_country: text(2),
      valid_until: optDay(),
      payment_terms: text(1_000),
      term_months: optInt(),
      discount_bp: int(),
      contingency_bp: int(),
      hour_cost_minor: int(),
      tax_rule: json(z.object({ seller: z.string(), client: z.string(), label: z.string(), rate_bp: z.number().int(), mention: z.string() }).nullable(), null),
      approval_required: bool(),
      approvals: json(z.array(z.object({ founder: z.string(), at: z.string(), quote_version: z.number().int(), with_other_founder: z.boolean() })).max(10), []),
      trade_recorded: text(1_000),
      scope: text(4_000),
      exclusions: text(2_000),
      milestones: json(z.array(z.object({ title: z.string().max(200), timing: z.string().max(100), amount_pct: z.number().min(0).max(100) })).max(12), []),
      risks: text(2_000),
      pilot_terms: text(1_000),
      notes: text(2_000),
      lines_rev: text(40),
      sent_at: optIso(),
      sent_by: optFounder(),
      decided_at: optIso(),
      decided_by: optFounder(),
      decline_reason: text(500),
      superseded_by: text(40),
      pdf_drive_file_id: text(200),
    },
  },
  QuoteLines: {
    domain: "crm",
    shape: {
      ...base,
      quote_id: reqText(40),
      lines_rev: reqText(40),
      position: int(),
      price_book_item_id: text(40),
      item_key: text(60),
      label: reqText(300),
      description: text(1_000),
      billing: oneOf(BILLINGS),
      unit: oneOf(UNITS),
      quantity_x100: int(),
      unit_price_minor: int(),
      list_unit_price_minor: optInt(),
      discount_bp: int(),
      est_hours_x100: int(),
      direct_cost_minor: int(),
      pilot_assumption: bool(),
    },
  },
  /**
   * Commercial policy and legal details, versioned by effective date (append-only): discount bands, margin guardrail,
   * tax rules by company → client country, validity, legal fields printed on quotes. Latest row per key wins.
   */
  CommercialPolicy: {
    domain: "crm",
    shape: { ...base, key: reqText(60), value: text(5_000), effective_from: day(), changed_by: text(40), note: text(500) },
  },
  /* ----- Stage 3 marketing: Content Studio, post checkpoints, snapshot job (D079) ----- */
  /** One content piece (concept) per row; its FR and ES versions are ContentVariants. Mutable (expected_version). */
  ContentPieces: {
    domain: "audience",
    shape: {
      ...base,
      brand: optOneOf(BRANDS),
      title: reqText(200),
      /** Iteration 11 (D081): reel / carousel / post / story / video; older brand_post, personal_post, vsl read as post / video. */
      format: oneOfAlias(CONTENT_FORMATS, LEGACY_FORMATS),
      hook: text(500),
      target_persona: text(200),
      script: text(20_000),
      /** idea / draft / ready (D081); older script, shoot → draft and edit → ready. */
      stage: oneOfAlias(PRODUCTION_STAGES, { ...LEGACY_STAGES, scheduled: "ready", published: "ready" }),
      author_founder: founder(),
      asset_url: text(500),
      notes: text(2_000),
    },
  },
  /** One language version of a piece (FR / ES) on one network: schedule, caption, UTM, checklist, publication. */
  ContentVariants: {
    domain: "audience",
    shape: {
      ...base,
      piece_id: reqText(40),
      language: oneOf(["FR", "ES"] as const),
      platform: oneOf(["instagram", "linkedin_page", "linkedin_personal"] as const),
      account_id: text(40),
      owner_founder: founder(),
      status: oneOf(VARIANT_STATUSES),
      scheduled_date: optDay(),
      slot_key: text(60),
      caption: text(5_000),
      cta: text(300),
      destination_url: text(1_000),
      utm_source: text(60),
      utm_medium: text(60),
      utm_campaign: text(120),
      utm_content: text(120),
      checklist_done: json(z.array(z.string().max(40)).max(40), []),
      published_at: optIso(),
      platform_post_url: text(1_000),
      media_id: text(80),
      /** Late columns (iteration 11, D081): composer fields, time of day, link placement and Drive media (ids + metadata, no copy). */
      scheduled_time: text(5),
      hook: text(500),
      hashtags: text(1_000),
      alt_text: text(1_000),
      first_comment: text(2_200),
      cover_text: text(200),
      link_placement: oneOfOr(LINK_PLACEMENTS, "first_comment"),
      drive_media: json(z.array(z.object({
        file_id: z.string().max(200), name: z.string().max(300), mime: z.string().max(120), web_link: z.string().max(1_000), thumbnail_link: z.string().max(1_000).default(""),
        width: z.number().int().nullable().default(null), height: z.number().int().nullable().default(null), duration_ms: z.number().int().nullable().default(null),
      })).max(20), []),
    },
  },
  /**
   * Post values at fixed ages (spec 5.6): 24 h, 72 h, 7 d, 30 d, plus "live" captures of stories (one per 6-hour slot,
   * kept after Instagram stops serving them). Append-only for the API: id = UUIDv5(account, media, checkpoint[, slot]).
   * A hand-entered checkpoint (source manual) has id UUIDv5(variant, checkpoint, manual) and can be corrected.
   */
  SocialPostSnapshots: {
    domain: "audience",
    shape: {
      ...base,
      account_id: text(40),
      variant_id: text(40),
      media_id: text(80),
      permalink: text(1_000),
      media_kind: oneOf(["reel", "post", "story", "linkedin"] as const),
      checkpoint: oneOf(SNAPSHOT_CHECKPOINTS),
      slot: text(20),
      age_hours: optInt(),
      captured_at: iso(),
      availability: oneOf(["ok", "not_available"] as const),
      views: optInt(),
      impressions: optInt(),
      reach: optInt(),
      likes: optInt(),
      comments: optInt(),
      saves: optInt(),
      shares: optInt(),
      profile_visits: optInt(),
      link_clicks: optInt(),
      site_visits: optInt(),
      leads: optInt(),
      follows: optInt(),
      source: oneOf(["api", "manual"] as const),
    },
  },
  /** Snapshot job runs (spec 4.11): one "done" row per 6-hour slot (id = UUIDv5(slot, done)); errors are extra rows. */
  SnapshotRuns: {
    domain: "audience",
    shape: {
      ...base,
      slot: reqText(20),
      trigger: oneOf(["scheduler", "first_request", "founder"] as const),
      status: oneOf(["done", "error"] as const),
      started_at: iso(),
      finished_at: iso(),
      accounts: int(),
      daily_rows: int(),
      post_rows: int(),
      story_rows: int(),
      error: text(500),
    },
  },
  /* ----- Stage 3 finance (D078): ledger, allocations, contracts, revenue schedule (EUR only, D082) ----- */
  /**
   * Manual ledger entries for money that did not go through Wise or Stripe (append-only: a correction is a reversing
   * entry with corrects_id). Amount ex VAT and VAT in the original currency (signed: income +, expense −), the EUR
   * equivalent locked with its rate, rate date and source at entry time.
   */
  LedgerEntries: {
    domain: "finance",
    shape: {
      ...base,
      date: day(),
      kind: oneOf(["income", "expense", "adjustment"] as const),
      category: oneOf(BANK_CATEGORIES),
      cost_center: oneOf(COST_CENTERS),
      cost_class: oneOfOr(["", ...COST_CLASSES] as const, ""),
      currency: reqText(3),
      amount_minor: int(),
      vat_minor: int(),
      /* fx_rate, fx_date, fx_source: empty for EUR. Since D085 a USD supplier payment locks here the rate (EUR per 1 USD),
         its date and source (bank | wise | manual | demo); rows from before D082 (source ecb) stay unconverted. */
      fx_rate: text(20),
      fx_date: optDay(),
      fx_source: text(20),
      eur_minor: int(),
      eur_vat_minor: int(),
      counterparty: text(200),
      reference: text(120),
      receipt_url: text(1_000),
      project_id: text(40),
      contract_id: text(40),
      service_from: optDay(),
      service_to: optDay(),
      corrects_id: text(40),
      note: text(500),
      /* Late column (D085): Wise movement whose real rate was used for a USD entry (fx_source "bank"). */
      wise_tx_id: text(40),
    },
  },
  /** How a bank movement is read (one row per movement, id = UUIDv5("alloc", bank tx id), version-checked edits). */
  FinanceAllocations: {
    domain: "finance",
    shape: {
      ...base,
      bank_tx_id: reqText(40),
      cost_center: oneOf(COST_CENTERS),
      cost_class: oneOfOr(["", ...COST_CLASSES] as const, ""),
      vat_minor: int(),
      service_from: optDay(),
      service_to: optDay(),
      contract_id: text(40),
      project_id: text(40),
      receipt_url: text(1_000),
      reference: text(120),
      reconciled: bool(),
      note: text(500),
    },
  },
  /** Client contracts (from projects or entered): one-off with milestones, or subscription (recurring per billing period). */
  Contracts: {
    domain: "finance",
    shape: {
      ...base,
      client_id: text(40),
      project_id: text(40),
      quote_id: text(40),
      name: reqText(200),
      cost_center: oneOf(COST_CENTERS),
      kind: oneOf(["subscription", "one_off"] as const),
      currency: reqText(3),
      setup_minor: int(),
      one_off_minor: int(),
      recurring_minor: int(),
      billing_months: int(),
      start_date: day(),
      end_date: optDay(),
      status: oneOf(["active", "paused", "ended"] as const),
      source: oneOf(["project", "manual"] as const),
      notes: text(1_000),
    },
  },
  /** Revenue schedule lines of a contract (milestones, set-up fee, manual lines). Recognized once earned. */
  RevenueSchedules: {
    domain: "finance",
    shape: {
      ...base,
      contract_id: reqText(40),
      line_key: reqText(80),
      label: reqText(200),
      kind: oneOf(["milestone", "setup", "one_off", "manual"] as const),
      milestone_id: text(40),
      period_start: day(),
      period_end: day(),
      amount_minor: int(),
      currency: reqText(3),
      status: oneOf(["planned", "earned", "cancelled"] as const),
      earned_on: optDay(),
    },
  },
  /** Daily USD→EUR rate from the Wise API (D085), one row per day (id = UUIDv5("usd-rate", date, source)); demo rows in DEMO only. */
  UsdRates: {
    domain: "finance",
    shape: { ...base, date: day(), rate: reqText(20), source: oneOf(["wise", "demo"] as const) },
  },
  /* FxRates (ECB rates) retired by D082: no longer read, written or created by setup; an existing tab in a live
     spreadsheet is left untouched (setup and doctor ignore tabs outside the schema). */
  /* ----- Stage 4A (D083): website form submissions (signed webhook) ----- */
  /**
   * One row per accepted website form event (id = UUIDv5("website", event_id): a replayed or retried event adds nothing).
   * No name, email or phone here: those live on the Contact. Holds the form type, UTM, consent as captured and the outcome.
   */
  WebsiteSubmissions: {
    domain: "crm",
    shape: {
      ...base,
      event_id: reqText(100),
      site: oneOf(["valemont", "thirty"] as const),
      form_type: oneOf(["contact", "lead", "booking"] as const),
      language: optOneOf(["FR", "ES"] as const),
      submitted_at: iso(),
      outcome: oneOf(["created", "matched", "suppressed"] as const),
      account_id: text(40),
      contact_id: text(40),
      inbox_item_id: text(40),
      page_url: text(1_000),
      referrer: text(1_000),
      utm_source: text(120),
      utm_medium: text(120),
      utm_campaign: text(200),
      utm_term: text(200),
      utm_content: text(200),
      consent_marketing: bool(),
      consent_text: text(500),
      consent_version: text(40),
    },
  },
  /* ----- D087: in-app connector vault ----- */
  /**
   * One row per connector secret (id = UUIDv5("connector-secret", variable name)). ONLY AES-256-GCM ciphertext, its
   * IV and tag, the id of the key that sealed it, the last 4 characters of a long value and a keyed fingerprint.
   * The key is never in Sheets (HKDF from CONNECTORS_ENCRYPTION_KEY, else SESSION_SECRET). Deleting clears the
   * ciphertext and archives the row. Plain (non-secret) connector settings live in SystemSettings ("connector:NAME").
   */
  IntegrationSecrets: {
    domain: "settings",
    shape: {
      ...base,
      integration: reqText(40),
      field: reqText(80),
      ciphertext: text(16_000),
      iv: text(40),
      tag: text(40),
      key_version: text(40),
      last4: text(8),
      fingerprint: text(40),
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
export const CREATE_DEFAULTS: Record<string, unknown> = { list_id: "", call_session_id: "", target_key: "", duration_sec: null, area: "sales", objections: [], replies: [], recurrence_days: [] , worked: "", blocked: "", offers_pitched: [], next_action_at: null, http_status: null, audit_scope: "team", input_hash: "", ip_hash: "", fx_currency: "", fx_amount_minor: null, wise_tx_id: "", template_name: "" };
type LateKeys = "list_id" | "call_session_id" | "target_key" | "duration_sec" | "area" | "objections" | "replies" | "recurrence_days" | "worked" | "blocked" | "offers_pitched" | "next_action_at" | "http_status" | "audit_scope" | "input_hash" | "ip_hash" | "fx_currency" | "fx_amount_minor" | "wise_tx_id" | "template_name";
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
