import { childId } from "@/lib/ids";
import type { Actor, DataRepository } from "@/data/repository";
import { SCHEMA_VERSION } from "@/data/schema/tables";
import { schemaHash } from "@/data/sheets/setup";
import { FOUNDERS, FOUNDER_NAMES, type FounderKey } from "@/domain/constants";
import { CAPACITY_SEED_MINUTES, MINUTES_PER_ACTION_SEED, SETTINGS_SEEDS, SOCIAL_SEEDS, TARGET_SEEDS, channelRuleSeeds, seedTargetsFor } from "@/domain/seeds";
import type { WorkMode } from "@/domain/constants";

const SYSTEM: Actor = { founder: "system" };
const SEED_DATE = "2000-01-01"; // seeds are effective from the beginning of time; edits supersede them

/**
 * Idempotent baseline rows (deterministic ids, existence checked first): founders, settings,
 * channel rules, target seeds, schema migration record. Never overwrites edited values.
 */
export async function seedBaseline(repo: DataRepository, timezones: Record<FounderKey, string>) {
  const t = await repo.listMany(["Users", "SystemSettings", "ChannelRules", "DailyTargets", "SchemaMigrations", "SocialAccounts"], { fresh: true });
  const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);
  const added: Record<string, number> = {};

  const users = FOUNDERS.map((f) => ({
    id: childId("user", f),
    founder_key: f,
    display_name: FOUNDER_NAMES[f],
    role: "founder" as const,
    timezone: timezones[f],
    workdays: [1, 2, 3, 4, 5],
    capacity_minutes: CAPACITY_SEED_MINUTES.JOB_SEARCHING,
    onboarded_at: null,
    avail_start: "09:00",
    avail_end: "18:30",
  })).filter((u) => !has(t.Users.rows, u.id));
  if (users.length) added.Users = (await repo.insert("Users", users, SYSTEM)).length;

  const settings = SETTINGS_SEEDS.map((s) => ({ id: childId("setting", s.key), ...s })).filter((s) => !has(t.SystemSettings.rows, s.id));
  if (settings.length) added.SystemSettings = (await repo.insert("SystemSettings", settings, SYSTEM)).length;

  const rules = channelRuleSeeds()
    .map((r) => ({ id: childId("rule", r.market, r.contact_type, r.channel), ...r, review_date: null }))
    .filter((r) => !has(t.ChannelRules.rows, r.id));
  if (rules.length) added.ChannelRules = (await repo.insert("ChannelRules", rules, SYSTEM)).length;

  const targets = [];
  for (const f of FOUNDERS)
    for (const mode of Object.keys(TARGET_SEEDS) as WorkMode[])
      for (const { metric, target } of seedTargetsFor(f, mode)) {
        const id = childId("target-seed", f, mode, metric);
        if (has(t.DailyTargets.rows, id)) continue;
        targets.push({ id, founder_key: f, mode, metric, target, weight: 1, minutes_per_action: MINUTES_PER_ACTION_SEED[metric], effective_from: SEED_DATE });
      }
  if (targets.length) added.DailyTargets = (await repo.insert("DailyTargets", targets, SYSTEM)).length;

  const social = SOCIAL_SEEDS.map(({ key, ...a }) => ({ id: childId("social", key), ...a, market: null, visibility: "team" as const })).filter((a) => !has(t.SocialAccounts.rows, a.id));
  if (social.length) added.SocialAccounts = (await repo.insert("SocialAccounts", social, SYSTEM)).length;

  const migId = childId("schema", String(SCHEMA_VERSION), schemaHash());
  if (!has(t.SchemaMigrations.rows, migId)) {
    await repo.insert(
      "SchemaMigrations",
      [{ id: migId, schema_version: SCHEMA_VERSION, schema_hash: schemaHash(), applied_at: new Date().toISOString(), notes: "Stage 1A schema" }],
      SYSTEM,
    );
    added.SchemaMigrations = 1;
  }
  return added;
}
