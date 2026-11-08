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
export const TARGET_SEEDS: Record<"JOB_SEARCHING" | "EMPLOYED_35H" | "LAUNCH_SPRINT", Record<FounderKey, Row>> = {
  JOB_SEARCHING: {
    theo: { calls: 35, dms: 12, invitations: 12, inmails: 2, cold_emails: 8, follow_ups: 15, comments: 5 },
    pablo: { calls: 50, dms: 15, invitations: 12, inmails: 2, cold_emails: 10, follow_ups: 20, comments: 5 },
  },
  EMPLOYED_35H: {
    theo: { calls: 12, dms: 6, invitations: 6, inmails: 1, cold_emails: 4, follow_ups: 8, comments: 3 },
    pablo: { calls: 20, dms: 8, invitations: 8, inmails: 1, cold_emails: 5, follow_ups: 10, comments: 3 },
  },
  // Launch sprint: 5 new businesses per workday on any channel, plus all due follow-ups (a pass requirement, Stage 1B).
  LAUNCH_SPRINT: { theo: { new_businesses: 5 }, pablo: { new_businesses: 5 } },
};

export function seedTargetsFor(founder: FounderKey, mode: WorkMode): { metric: Metric; target: number }[] {
  const row = (TARGET_SEEDS as Record<string, Record<FounderKey, Row>>)[mode]?.[founder] ?? {};
  return METRICS.map((metric) => ({ metric, target: row[metric] ?? 0 }));
}

export const CAPACITY_SEED_MINUTES: Record<WorkMode, number> = {
  JOB_SEARCHING: 300,
  EMPLOYED_35H: 150,
  LAUNCH_SPRINT: 300,
  CUSTOM: 180,
  DAY_OFF: 0,
  VACATION: 0,
};

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
];
