/** Shared enumerations. Pure data, safe for client and server. */

export const FOUNDERS = ["theo", "pablo"] as const;
export type FounderKey = (typeof FOUNDERS)[number];
export const FOUNDER_NAMES: Record<FounderKey, string> = { theo: "Théo", pablo: "Pablo" };

export const BRANDS = ["consulting", "local", "thirty"] as const;
export type Brand = (typeof BRANDS)[number];
export const BRAND_LABELS: Record<Brand, string> = {
  consulting: "Valemont Consulting",
  local: "Valemont Local",
  thirty: "30/30 AI",
};

export const MARKETS = ["FR", "ES"] as const;
export type Market = (typeof MARKETS)[number];

export const WORK_MODES = [
  "FULL_TIME",
  "REDUCED",
  "LAUNCH_SPRINT",
  "CUSTOM",
  "DAY_OFF",
  "VACATION",
] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  FULL_TIME: "Full time",
  REDUCED: "Reduced",
  LAUNCH_SPRINT: "Launch sprint",
  CUSTOM: "Custom",
  DAY_OFF: "Day off",
  VACATION: "Vacation",
};
export const WORK_MODE_HINTS: Partial<Record<WorkMode, string>> = {
  REDUCED: "35h job, temp work or interviews",
};
/**
 * Founder brief round 8: JOB_SEARCHING became FULL_TIME and EMPLOYED_35H became REDUCED. Sheets rows written before
 * keep the old strings; reads map them to the new ones (src/data/schema/codecs.ts `workMode()`), the next write stores the new value.
 */
export const LEGACY_WORK_MODES: Readonly<Record<string, WorkMode>> = { JOB_SEARCHING: "FULL_TIME", EMPLOYED_35H: "REDUCED" };
export const normalizeWorkMode = (v: string): string => LEGACY_WORK_MODES[v] ?? v;

/**
 * One Valemont offer (founders, round 8): Consulting. Local is a last-resort downsell at a monthly price for businesses
 * that really have no budget. A deal's offer is stored in its `brand` column (consulting | local); values come from
 * SystemSettings `offer_consulting_value_eur` and `offer_local_monthly_eur`.
 */
export const OFFERS = ["consulting", "local"] as const;
export type Offer = (typeof OFFERS)[number];
export const OFFER_LABELS: Record<Offer, string> = { consulting: "Consulting", local: "Local (100 €/month)" };

/** Daily counters that can carry a target. */
export const METRICS = [
  "calls",
  "field_visits",
  "dms",
  "invitations",
  "inmails",
  "cold_emails",
  "follow_ups",
  "comments",
  "new_businesses",
] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABELS: Record<Metric, string> = {
  calls: "Calls",
  field_visits: "Field visits",
  dms: "LinkedIn DMs",
  invitations: "Invitations",
  inmails: "InMails",
  cold_emails: "Cold emails",
  follow_ups: "Follow-ups",
  comments: "Comments",
  new_businesses: "New businesses contacted",
};

/** Activity types, logged distinctly (spec 5.5). */
export const ACTIVITY_TYPES = [
  "cold_call",
  "connected_call",
  "voicemail",
  "field_visit",
  "linkedin_invitation",
  "linkedin_dm",
  "inmail",
  /** A LinkedIn invitation was accepted (tapped by the founder in a LinkedIn session; not outreach, not counted in targets). */
  "linkedin_accepted",
  "cold_email",
  "follow_up",
  "reply",
  "qualified_conversation",
  "comment",
  "demo_shown",
  "meeting_booked",
  "meeting_held",
  "proposal_sent",
  "sale",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  cold_call: "Call, no answer",
  connected_call: "Call, connected",
  voicemail: "Call, voicemail",
  field_visit: "Field visit",
  linkedin_invitation: "LinkedIn invitation",
  linkedin_dm: "LinkedIn DM",
  inmail: "Sales Navigator InMail",
  linkedin_accepted: "LinkedIn invitation accepted",
  cold_email: "Cold email",
  follow_up: "Follow-up",
  reply: "Reply received",
  qualified_conversation: "Qualified conversation",
  comment: "Comment",
  demo_shown: "Demo shown",
  meeting_booked: "Meeting booked",
  meeting_held: "Meeting held",
  proposal_sent: "Proposal sent",
  sale: "Sale",
};

/** Outreach types are subject to suppression and channel rules. */
export const OUTREACH_TYPES: readonly ActivityType[] = [
  "cold_call",
  "connected_call",
  "voicemail",
  "field_visit",
  "linkedin_invitation",
  "linkedin_dm",
  "inmail",
  "cold_email",
  "follow_up",
];

export const FOLLOW_UP_CHANNELS = ["phone", "email", "linkedin", "whatsapp", "in_person"] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

export const ACTIVITY_SOURCES = ["manual", "verified", "imported"] as const;

export const OBJECTIONS = [
  "no_need",
  "no_time",
  "too_expensive",
  "already_has_solution",
  "not_decision_maker",
  "call_back_later",
  "not_interested",
  "other",
  "send_info",
  "bad_timing",
  "bad_experience",
  "think_about_it",
  "enough_work",
] as const;
export type Objection = (typeof OBJECTIONS)[number];
export const OBJECTION_LABELS: Record<(typeof OBJECTIONS)[number], string> = {
  no_need: "No need",
  no_time: "No time",
  too_expensive: "Too expensive",
  already_has_solution: "Already has a solution",
  not_decision_maker: "Not the decision-maker",
  call_back_later: "Call back later",
  not_interested: "Not interested",
  other: "Other",
  send_info: "Send me info",
  bad_timing: "Bad timing",
  bad_experience: "Bad past experience",
  think_about_it: "I'll think about it",
  enough_work: "Already enough work",
};


export const OUTCOMES = [
  "no_answer",
  "gatekeeper",
  "conversation",
  "interested",
  "not_interested",
  "callback_requested",
  "demo_booked",
  "meeting_booked",
  "sent",
  "met_owner",
  "owner_absent",
  "won",
  "lost",
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_answer: "No answer",
  gatekeeper: "Reached gatekeeper",
  conversation: "Conversation held",
  interested: "Interested",
  not_interested: "Not interested",
  callback_requested: "Callback requested",
  demo_booked: "Demo booked",
  meeting_booked: "Meeting booked",
  sent: "Sent",
  met_owner: "Met the owner",
  owner_absent: "Owner absent",
  won: "Won",
  lost: "Lost",
};

export const STAGES = [
  "targeted",
  "contacted",
  "replied",
  "discovery_scheduled",
  "qualified",
  "demo_shown",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  targeted: "Targeted",
  contacted: "Contacted",
  replied: "Replied",
  discovery_scheduled: "Discovery scheduled",
  qualified: "Qualified",
  demo_shown: "Demo shown",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};
/** Seed probabilities (editable in SystemSettings `stage_probabilities`). */
export const STAGE_PROBABILITY_SEED: Record<Stage, number> = {
  targeted: 0.02,
  contacted: 0.05,
  replied: 0.1,
  discovery_scheduled: 0.2,
  qualified: 0.35,
  demo_shown: 0.5,
  proposal_sent: 0.6,
  negotiation: 0.75,
  won: 1,
  lost: 0,
};
export const STAGE_EXIT_CRITERIA: Record<Stage, string> = {
  targeted: "A first outreach attempt has been logged.",
  contacted: "The business has replied on any channel.",
  replied: "A discovery call or visit is booked with a date.",
  discovery_scheduled: "Discovery held; authority, need, urgency and money noted.",
  qualified: "A demo has been shown to the decision-maker.",
  demo_shown: "A written proposal has been sent.",
  proposal_sent: "The client is discussing terms.",
  negotiation: "Signed agreement or explicit refusal.",
  won: "Client and project created.",
  lost: "Lost reason recorded.",
};

export const CONTACT_TYPES = ["company_generic", "professional_named", "sole_trader", "consumer"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  company_generic: "Company (generic)",
  professional_named: "Named professional",
  sole_trader: "Sole trader",
  consumer: "Consumer",
};

export const CONSENT_STATUSES = ["unknown", "consented", "opted_out"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const RULE_CHANNELS = ["phone", "email", "linkedin", "field_visit"] as const;
export type RuleChannel = (typeof RULE_CHANNELS)[number];
export const RULE_STATUSES = ["allowed", "allowed_with_conditions", "requires_consent", "needs_review"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const LEAD_TYPES = ["referral", "inbound", "outbound"] as const;
export const LEAD_STATUSES = ["new", "working", "nurture", "customer", "disqualified"] as const;

export const SUPPRESSION_KINDS = ["contact", "email", "phone", "domain"] as const;
