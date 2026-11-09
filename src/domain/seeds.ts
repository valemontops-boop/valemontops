import type { ContactType, FounderKey, Market, Metric, RuleChannel, RuleStatus, WorkMode } from "./constants";
import { CONTACT_TYPES, MARKETS, METRICS, RULE_CHANNELS } from "./constants";

/** Seeds are editable starting values written to Sheets, never hardcoded rules (spec preamble). */

export const MINUTES_PER_ACTION_SEED: Record<Metric, number> = {
  calls: 4,
  field_visits: 15,
  dms: 3,
  invitations: 1,
  inmails: 5,
  cold_emails: 4,
  follow_ups: 3,
  comments: 3,
  new_businesses: 0, // time is counted on the underlying channel
};

type Row = Partial<Record<Metric, number>>;
/**
 * Founder brief round 8, revised round 9 (D073), same for both founders (editable in Settings › Targets).
 * Prospecting channels are phone and LinkedIn. Emails have NO daily target: they are only counted (cold_emails = 0,
 * shown as "counted, no target", outside attainment, score and capacity); they still count as new businesses when
 * they reach a new one. They go mainly to prospects who had no time on the phone or could not be reached.
 * FULL_TIME a day: 50 cold calls, 25 LinkedIn approaches (15 invitations + 10 DMs), 20 follow-ups → 90 new businesses.
 * REDUCED (35h job, temp work or interviews): 20 calls, 10 LinkedIn (5 + 5), 10 follow-ups → 35 new businesses.
 * New businesses are distinct across channels; follow-ups come on top. LinkedIn limits always win (see `linkedinCap`).
 */
const FULL_TIME: Row = { calls: 50, invitations: 15, dms: 10, inmails: 0, cold_emails: 0, follow_ups: 20, comments: 0, new_businesses: 90 };
const REDUCED: Row = { calls: 20, invitations: 5, dms: 5, inmails: 0, cold_emails: 0, follow_ups: 10, comments: 0, new_businesses: 35 };
export const TARGET_SEEDS: Record<"FULL_TIME" | "REDUCED" | "LAUNCH_SPRINT", Record<FounderKey, Row>> = {
  FULL_TIME: { theo: FULL_TIME, pablo: FULL_TIME },
  REDUCED: { theo: REDUCED, pablo: REDUCED },
  // Launch sprint: 5 new businesses per workday on any channel, plus all due follow-ups (a pass requirement, Stage 1B).
  LAUNCH_SPRINT: { theo: { new_businesses: 5 }, pablo: { new_businesses: 5 } },
};

/**
 * Round 9 seed revision (D073). A spreadsheet whose original seed row (dated 2000-01-01) holds another value gets one
 * extra seed row (id `target-seed`, "r9", …) dated `TARGET_REVISION_DATE`, the day after the original seed date: it
 * supersedes the old seed but never a founder's own edit (edits are dated the day they apply, always later).
 */
export const TARGET_REVISION_R9: { modes: ("FULL_TIME" | "REDUCED")[]; metrics: Metric[] } = { modes: ["FULL_TIME", "REDUCED"], metrics: ["cold_emails"] };
export const TARGET_REVISION_DATE = "2000-01-02";

export function seedTargetsFor(founder: FounderKey, mode: WorkMode): { metric: Metric; target: number }[] {
  const row = (TARGET_SEEDS as Record<string, Record<FounderKey, Row>>)[mode]?.[founder] ?? {};
  return METRICS.map((metric) => ({ metric, target: row[metric] ?? 0 }));
}

/** Minutes of work a day per mode (FULL_TIME targets ≈ 305 min of outreach at the seed minutes per action). */
export const CAPACITY_SEED_MINUTES: Record<WorkMode, number> = {
  FULL_TIME: 420,
  REDUCED: 180,
  LAUNCH_SPRINT: 300,
  CUSTOM: 180,
  DAY_OFF: 0,
  VACATION: 0,
};

/**
 * LinkedIn account limits take priority over targets: the invitation target shown for a day is capped by the daily
 * limit and by what is left of the weekly limit. Returns the capped target and whether the cap applied.
 */
export function linkedinCap(target: number, limits: { daily: number; weekly: number }, sentThisWeekBeforeToday: number): { target: number; capped: boolean } {
  const left = Math.max(0, limits.weekly - sentThisWeekBeforeToday);
  const capped = Math.min(target, limits.daily, left);
  return { target: capped, capped: capped < target };
}

/** KPI targets (brief round 8), seeds for SystemSettings; theoretical team volume = sum of daily new-business targets. */
export const KPI_SEEDS = { qualifiedConversationsPerWorkday: 1, qualifiedMeetingsPerWeek: 2 } as const;

const NOTES: { market: Market; types: ContactType[]; channel: RuleChannel; note: string; url: string }[] = [
  {
    market: "FR",
    types: ["consumer"],
    channel: "phone",
    note: "Prior consent required since 2026-08-11 (loi 2025-594); consent evidence must be retained.",
    url: "https://www.legifrance.gouv.fr/",
  },
  {
    market: "FR",
    types: ["company_generic", "professional_named", "sole_trader"],
    channel: "phone",
    note: "Reported as outside the consumer consent rule when the offer directly relates to the recipient's profession; confirm treatment of sole traders.",
    url: "https://www.legifrance.gouv.fr/",
  },
  {
    market: "FR",
    types: ["company_generic", "professional_named", "sole_trader"],
    channel: "email",
    note: "Opt-out regime when relevant to the recipient's role; sender identity and a way to object on every message.",
    url: "https://www.cnil.fr/",
  },
  {
    market: "ES",
    types: ["company_generic", "professional_named", "sole_trader", "consumer"],
    channel: "email",
    note: "LSSI art. 21 requires prior authorization or a prior relationship, not limited to consumers. Treat Spanish cold email as requires_consent until reviewed.",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758",
  },
  {
    market: "ES",
    types: ["company_generic", "professional_named", "sole_trader", "consumer"],
    channel: "phone",
    note: "LGTel art. 66.1.b requires consent or another GDPR art. 6 basis; sole-trader treatment needs review.",
    url: "https://www.boe.es/buscar/act.php?id=BOE-A-2022-10757",
  },
];

/** All rules start as needs_review for counsel to confirm (spec 5.5). */
export function channelRuleSeeds(): { market: Market; contact_type: ContactType; channel: RuleChannel; status: RuleStatus; note: string; source_url: string }[] {
  const out = [];
  for (const market of MARKETS)
    for (const contact_type of CONTACT_TYPES)
      for (const channel of RULE_CHANNELS) {
        const n = NOTES.find((x) => x.market === market && x.channel === channel && x.types.includes(contact_type));
        out.push({ market, contact_type, channel, status: "needs_review" as RuleStatus, note: n?.note ?? "", source_url: n?.url ?? "" });
      }
  return out;
}

export const SETTINGS_SEEDS: { key: string; value: string; description: string }[] = [
  { key: "follow_up_cadence_days", value: "[1,3,7,14]", description: "Follow-up cadence seed (day 14 = close-the-file message). Creates next actions only, never sends." },
  { key: "retention_inactive_years", value: "3", description: "Flag inactive prospects for deletion after this many years since last contact." },
  { key: "inmail_monthly_budget", value: "50", description: "Remaining monthly InMail credits (manual resets and credits)." },
  { key: "hot_lead_stale_days", value: "5", description: "Hot leads with no touch for N days enter the Next Best Action queue." },
  { key: "company_name", value: "", description: "Legal company name (entered by a founder; never invented)." },
  { key: "linkedin_daily_invitation_limit", value: "20", description: "LinkedIn invitations allowed per day. LinkedIn limits always take priority over targets." },
  { key: "linkedin_weekly_invitation_limit", value: "100", description: "LinkedIn invitations allowed per week (rolling Monday to Sunday)." },
  { key: "offer_consulting_value_eur", value: "1500", description: "Default value of a Consulting deal ex VAT (sprint goal 3,000 € / 2 clients). Used when a deal has no value." },
  { key: "offer_local_monthly_eur", value: "100", description: "Valemont Local monthly price, the entry offer when the budget is too small." },
  { key: "offer_priority", value: "consulting", description: "Priority offer (round 9): Consulting. Not interested → Local (cheaper, more accessible) → still not → 30/30." },
  { key: "effort_consulting_pct", value: "100", description: "Share of sales effort on Consulting (percent)." },
  { key: "effort_local_pct", value: "0", description: "Share of sales effort on Local (percent): Local is only offered to those not interested in Consulting." },
  { key: "effort_thirty", value: "marketing", description: "30/30 gets no sales effort: it is pushed last in the ladder and worked through marketing." },
  { key: "prospecting_channels", value: '["phone","linkedin"]', description: "Prospecting channels: phone and LinkedIn. No Instagram DMs, no ads. Emails are counted, with no target (mainly prospects with no time on the phone or not reachable)." },
  { key: "ads_monthly_spend_eur", value: "0", description: "Monthly ads spend in EUR (used for CAC). Seed 0: no ads." },
  { key: "founder_hour_cost_eur", value: "30", description: "Cost of one founder hour in EUR (used for CAC per channel)." },
  { key: "time_split_target", value: "75/15/10", description: "Target split of working time: sales / content / site, tools and analysis (percent)." },
  { key: "kpi_qualified_conversations_per_workday", value: "1", description: "Per founder: qualified conversations per workday." },
  { key: "kpi_qualified_meetings_per_week", value: "2", description: "Per founder: qualified meetings per week." },
  { key: "sprint_goal_paying_clients", value: "2", description: "Sprint goal: paying clients signed." },
  { key: "sprint_goal_signed_eur", value: "3000", description: "Sprint goal: EUR signed ex VAT." },
];

/**
 * The six social accounts Valemont tracks (founders, round 6). Personal LinkedIn profiles are shown to both founders
 * at their request (D055, overrides the owner-only default of spec 2.3); data comes from imports or manual entry.
 */
export const SOCIAL_SEEDS: { key: string; platform: "instagram" | "linkedin_page" | "linkedin_personal"; handle: string; brand: "consulting" | "local" | "thirty" | null; owner_founder: "theo" | "pablo" | null; connection_mode: "manual" | "import" }[] = [
  { key: "li-theo", platform: "linkedin_personal", handle: "Théo", brand: null, owner_founder: "theo", connection_mode: "import" },
  { key: "li-pablo", platform: "linkedin_personal", handle: "Pablo", brand: null, owner_founder: "pablo", connection_mode: "import" },
  { key: "li-valemont", platform: "linkedin_page", handle: "Valemont", brand: "consulting", owner_founder: null, connection_mode: "import" },
  { key: "li-thirty", platform: "linkedin_page", handle: "30/30 AI", brand: "thirty", owner_founder: null, connection_mode: "import" },
  { key: "ig-valemont", platform: "instagram", handle: "Valemont", brand: "local", owner_founder: null, connection_mode: "manual" },
  { key: "ig-thirty", platform: "instagram", handle: "30/30 AI", brand: "thirty", owner_founder: null, connection_mode: "manual" },
];
