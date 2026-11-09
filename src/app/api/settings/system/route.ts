import { z } from "zod";
import { childId } from "@/lib/ids";
import { route } from "@/server/http";
import { SETTINGS_SEEDS } from "@/domain/seeds";

/** Founder-editable workspace settings (allowlisted keys only). */
const KEYS = {
  drive_folder_id: "Drive folder shared with the service account (Viewer).",
  founder_point_video_link: "Standing video link inserted in founder point events.",
  ideas_testing_limit: "Max ideas in Testing while a sprint is active.",
  hot_lead_stale_days: "Hot leads with no touch for N days enter the Next Best Action queue.",
  conversion_min_sample: "Minimum attempts before conversion rates are shown.",
  company_name: "Legal company name (entered by a founder; never invented).",
  calendly_url_theo: "Théo's booking link inserted in call follow-ups.",
  calendly_url_pablo: "Pablo's booking link inserted in call follow-ups.",
  deck_url_fr: "Commercial deck link (French).",
  deck_url_es: "Commercial deck link (Spanish).",
  thirty_url: "30/30 link sent after a yes to 30/30 during a call.",
  signature_theo: "Théo's email signature (several lines allowed).",
  signature_pablo: "Pablo's email signature (several lines allowed).",
  offer_consulting_value_eur: "Default value of a Consulting deal ex VAT, in euros.",
  offer_local_monthly_eur: "Valemont Local monthly price (entry offer when the budget is too small), in euros.",
  offer_priority: "Priority offer: consulting (round 9) or local.",
  effort_consulting_pct: "Share of sales effort on Consulting (percent).",
  effort_local_pct: "Share of sales effort on Local (percent).",
  ads_monthly_spend_eur: "Monthly ads spend in EUR (used for CAC).",
  founder_hour_cost_eur: "Cost of one founder hour in EUR (used for CAC per channel).",
  linkedin_daily_invitation_limit: "LinkedIn invitations allowed per day (limits take priority over targets).",
  linkedin_weekly_invitation_limit: "LinkedIn invitations allowed per week.",
  time_split_target: "Target split of working time: sales / content / site, tools and analysis.",
  website_url_fr: "French website address (https), audited in Growth › Web › SEO.",
  website_url_es: "Spanish website address (https), audited in Growth › Web › SEO.",
  seo_brand_terms: "Brand words in search queries, comma separated (brand vs non-brand share).",
  content_minutes_per_deliverable: "Minutes of work per content piece, JSON (used for the cost of social networks).",
} as const;
/** Shown in Settings › Workspace but not editable there (round 9 seeds, D073). */
const READ_ONLY_KEYS = ["effort_thirty", "prospecting_channels"];
const PERCENT_KEYS = ["effort_consulting_pct", "effort_local_pct"];
const NUMBER_KEYS = [...PERCENT_KEYS, "ideas_testing_limit", "hot_lead_stale_days", "conversion_min_sample", "linkedin_daily_invitation_limit", "linkedin_weekly_invitation_limit"];
const EURO_KEYS = ["offer_consulting_value_eur", "offer_local_monthly_eur", "ads_monthly_spend_eur", "founder_hour_cost_eur"];
const URL_KEYS = ["calendly_url_theo", "calendly_url_pablo", "deck_url_fr", "deck_url_es", "thirty_url", "website_url_fr", "website_url_es"];

export const GET = route(undefined, async ({ repo }) => {
  const rows = (await repo.list("SystemSettings")).rows;
  // A key not written yet shows its seed (e.g. ads 0, founder hour 30) until the baseline or a founder writes it.
  const seed = (k: string) => SETTINGS_SEEDS.find((s) => s.key === k)?.value ?? "";
  return Object.fromEntries([...Object.keys(KEYS), ...READ_ONLY_KEYS].map((k) => [k, rows.find((r) => r.key === k)?.value ?? seed(k)]));
});

export const POST = route(z.object({ key: z.enum(Object.keys(KEYS) as [keyof typeof KEYS, ...(keyof typeof KEYS)[]]), value: z.string().trim().max(500) }), async ({ repo, session, input }) => {
  if (NUMBER_KEYS.includes(input.key) && input.value && !/^\d{1,3}$/.test(input.value)) {
    return Response.json({ error: "validation_error", message: "Enter a whole number" }, { status: 400 });
  }
  if (PERCENT_KEYS.includes(input.key) && input.value && Number(input.value) > 100) {
    return Response.json({ error: "validation_error", message: "Enter a percentage between 0 and 100" }, { status: 400 });
  }
  if (input.key === "offer_priority" && !["consulting", "local"].includes(input.value)) {
    return Response.json({ error: "validation_error", message: "Choose Consulting or Local" }, { status: 400 });
  }
  if (EURO_KEYS.includes(input.key) && input.value && !/^\d{1,6}$/.test(input.value)) {
    return Response.json({ error: "validation_error", message: "Enter a whole number" }, { status: 400 });
  }
  if (input.key === "time_split_target" && input.value && !/^\d{1,3}\/\d{1,3}\/\d{1,3}$/.test(input.value)) {
    return Response.json({ error: "validation_error", message: "Enter three percentages adding up to 100, e.g. 75/15/10" }, { status: 400 });
  }
  if (URL_KEYS.includes(input.key) && input.value && !/^https:\/\/[^\s"'<>]+$/.test(input.value)) {
    return Response.json({ error: "validation_error", message: "Enter a full https:// link" }, { status: 400 });
  }
  if (input.key === "content_minutes_per_deliverable" && input.value && !isMinutesJson(input.value)) {
    return Response.json({ error: "validation_error", message: "Enter minutes per piece, e.g. {\"concept\": 60, \"reel\": 90, \"brand_post\": 30}" }, { status: 400 });
  }
  const id = childId("setting", input.key);
  const cur = await repo.get("SystemSettings", id, { fresh: true });
  if (cur) return repo.update("SystemSettings", id, cur.version, { value: input.value }, { founder: session.founder });
  return (await repo.insert("SystemSettings", [{ id, key: input.key, value: input.value, description: KEYS[input.key] }], { founder: session.founder }))[0];
});

/** {"reel": 90, …}: known deliverables only, whole minutes 0–1000. */
function isMinutesJson(v: string) {
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    return Boolean(o) && typeof o === "object" && !Array.isArray(o) && Object.entries(o).every(([k, n]) => ["concept", "reel", "brand_post", "personal_post", "story", "vsl"].includes(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1000);
  } catch { return false; }
}
