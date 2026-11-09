import { z } from "zod";
import { childId } from "@/lib/ids";
import { route } from "@/server/http";

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
  signature_theo: "Théo's email signature (several lines allowed).",
  signature_pablo: "Pablo's email signature (several lines allowed).",
  offer_consulting_value_eur: "Default value of a Consulting deal ex VAT, in euros.",
  offer_local_monthly_eur: "Valemont Local monthly price (last-resort downsell), in euros.",
  linkedin_daily_invitation_limit: "LinkedIn invitations allowed per day (limits take priority over targets).",
  linkedin_weekly_invitation_limit: "LinkedIn invitations allowed per week.",
  time_split_target: "Target split of working time: sales / content / site, tools and analysis.",
} as const;
const NUMBER_KEYS = ["ideas_testing_limit", "hot_lead_stale_days", "conversion_min_sample", "linkedin_daily_invitation_limit", "linkedin_weekly_invitation_limit"];
const EURO_KEYS = ["offer_consulting_value_eur", "offer_local_monthly_eur"];
const URL_KEYS = ["calendly_url_theo", "calendly_url_pablo", "deck_url_fr", "deck_url_es"];

export const GET = route(undefined, async ({ repo }) => {
  const rows = (await repo.list("SystemSettings")).rows;
  return Object.fromEntries(Object.keys(KEYS).map((k) => [k, rows.find((r) => r.key === k)?.value ?? ""]));
});

export const POST = route(z.object({ key: z.enum(Object.keys(KEYS) as [keyof typeof KEYS, ...(keyof typeof KEYS)[]]), value: z.string().trim().max(500) }), async ({ repo, session, input }) => {
  if (NUMBER_KEYS.includes(input.key) && input.value && !/^\d{1,3}$/.test(input.value)) {
    return Response.json({ error: "validation_error", message: "Enter a whole number" }, { status: 400 });
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
  const id = childId("setting", input.key);
  const cur = await repo.get("SystemSettings", id, { fresh: true });
  if (cur) return repo.update("SystemSettings", id, cur.version, { value: input.value }, { founder: session.founder });
  return (await repo.insert("SystemSettings", [{ id, key: input.key, value: input.value, description: KEYS[input.key] }], { founder: session.founder }))[0];
});
