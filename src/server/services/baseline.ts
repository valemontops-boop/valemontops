import { childId } from "@/lib/ids";
import type { Actor, DataRepository } from "@/data/repository";
import { SCHEMA_VERSION } from "@/data/schema/tables";
import { schemaHash } from "@/data/sheets/setup";
import { FOUNDERS, FOUNDER_NAMES, type FounderKey } from "@/domain/constants";
import { CAPACITY_SEED_MINUTES, MINUTES_PER_ACTION_SEED, SETTINGS_SEEDS, SOCIAL_SEEDS, TARGET_REVISION_DATE, TARGET_REVISION_R9, TARGET_SEEDS, channelRuleSeeds, seedTargetsFor } from "@/domain/seeds";
import type { WorkMode } from "@/domain/constants";
import { PREVIOUS_SEED_TITLES, TASK_SEEDS } from "@/domain/task-seeds";
import { nextDue } from "@/domain/tasks";
import { addDays, localDate, weekday } from "@/domain/time";
import { seedCommercial } from "./commercial";

const SYSTEM: Actor = { founder: "system" };
const SEED_DATE = "2000-01-01"; // seeds are effective from the beginning of time; edits supersede them

/**
 * Idempotent baseline rows (deterministic ids, existence checked first): founders, settings,
 * channel rules, target seeds, schema migration record. Never overwrites edited values.
 */
export async function seedBaseline(repo: DataRepository, timezones: Record<FounderKey, string>) {
  const t = await repo.listMany(["Users", "SystemSettings", "ChannelRules", "DailyTargets", "SchemaMigrations", "SocialAccounts", "Tasks", "Sprints"], { fresh: true });
  const has = (rows: { id: string }[], id: string) => rows.some((r) => r.id === id);
  const added: Record<string, number> = {};

  const users = FOUNDERS.map((f) => ({
    id: childId("user", f),
    founder_key: f,
    display_name: FOUNDER_NAMES[f],
    role: "founder" as const,
    timezone: timezones[f],
    workdays: [1, 2, 3, 4, 5],
    capacity_minutes: CAPACITY_SEED_MINUTES.FULL_TIME,
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
  // Iteration 9 revision (D073): where an older seed row holds another value, a later-dated seed row supersedes it.
  for (const f of FOUNDERS)
    for (const mode of TARGET_REVISION_R9.modes)
      for (const metric of TARGET_REVISION_R9.metrics) {
        const id = childId("target-seed", "r9", f, mode, metric);
        const target = seedTargetsFor(f, mode).find((x) => x.metric === metric)!.target;
        const oldSeed = t.DailyTargets.rows.some((r) => r.founder_key === f && r.mode === mode && r.metric === metric && r.effective_from === SEED_DATE && r.target !== target);
        if (has(t.DailyTargets.rows, id) || !oldSeed) continue;
        targets.push({ id, founder_key: f, mode, metric, target, weight: 1, minutes_per_action: MINUTES_PER_ACTION_SEED[metric], effective_from: TARGET_REVISION_DATE });
      }
  if (targets.length) added.DailyTargets = (await repo.insert("DailyTargets", targets, SYSTEM)).length;

  const social = SOCIAL_SEEDS.map(({ key, ...a }) => ({ id: childId("social", key), ...a, market: null, visibility: "team" as const })).filter((a) => !has(t.SocialAccounts.rows, a.id));
  if (social.length) added.SocialAccounts = (await repo.insert("SocialAccounts", social, SYSTEM)).length;

  const tasks = seedTasks(t.Tasks.rows, timezones);
  if (tasks.length) added.Tasks = (await repo.insert("Tasks", tasks, SYSTEM)).length;
  // Revised seed titles (D073): open system rows still carrying an old seed title take the new one; founder edits stay.
  let renamed = 0;
  for (const row of t.Tasks.rows) {
    if (row.source !== "system" || row.is_archived || !["todo", "in_progress"].includes(row.status) || !row.owner) continue;
    const old = PREVIOUS_SEED_TITLES[row.source_id]?.[row.owner as FounderKey];
    const title = TASK_SEEDS.find((x) => x.key === row.source_id)?.title[row.owner as FounderKey];
    if (!old?.includes(row.title) || !title || title === row.title) continue;
    try {
      await repo.update("Tasks", row.id, row.version, { title }, SYSTEM);
      renamed++;
    } catch { /* edited meanwhile (version conflict): the founder's version wins */ }
  }
  if (renamed) added.TasksRenamed = renamed;

  const sprintId = childId("sprint-seed", SPRINT_SEED.start_date);
  if (!has(t.Sprints.rows, sprintId)) {
    const otherActive = t.Sprints.rows.some((s) => s.status === "active" && !s.is_archived);
    await repo.insert("Sprints", [{ id: sprintId, ...SPRINT_SEED, status: otherActive ? "planned" : "active" }], SYSTEM);
    added.Sprints = 1;
  }

  const migId = childId("schema", String(SCHEMA_VERSION), schemaHash());
  if (!has(t.SchemaMigrations.rows, migId)) {
    await repo.insert(
      "SchemaMigrations",
      [{ id: migId, schema_version: SCHEMA_VERSION, schema_hash: schemaHash(), applied_at: new Date().toISOString(), notes: "Stage 1A schema" }],
      SYSTEM,
    );
    added.SchemaMigrations = 1;
  }
  // Stage 2A (D074): price book, audit templates and commercial policy seeds (legal details are never seeded).
  Object.assign(added, await seedCommercial(repo));
  return added;
}

/**
 * Sprint from iteration 8: 9 Nov → 4 Dec 2026, goals 2 paying clients and EUR 3,000 ex VAT signed
 * (SystemSettings `sprint_goal_paying_clients` / `sprint_goal_signed_eur`). Per founder, over 20 workdays at FULL_TIME:
 * 1,800 new businesses (theoretical), 20 qualified conversations, 8 qualified meetings, 1 paying client. One offer: Consulting.
 */
export const SPRINT_SEED = {
  name: "Sprint 09/11 → 04/12/2026",
  start_date: "2026-11-09",
  end_date: "2026-12-04",
  niche: "",
  targets: { theo: { contacted: 1800, replies: 20, demos: 8, pilots: 1 }, pablo: { contacted: 1800, replies: 20, demos: 8, pilots: 1 } },
  brand_split: { consulting: 1, local: 0, thirty: 0 },
};

const nextWorkday = (d: string) => { let x = d; while ([0, 6].includes(weekday(x))) x = addDays(x, 1); return x; };
const addWorkdays = (d: string, n: number) => { let x = nextWorkday(d); for (let i = 0; i < n; i++) x = nextWorkday(addDays(x, 1)); return x; };

/** Iteration 8 task templates, one per founder in their language; an existing row (any status, archived included) is never re-seeded. */
function seedTasks(existing: { id: string; source: string; source_id: string; owner: string | null }[], timezones: Record<FounderKey, string>) {
  const out = [];
  for (const seed of TASK_SEEDS)
    for (const f of FOUNDERS) {
      const title = seed.title[f];
      if (!title) continue;
      const id = childId("seed-task", seed.key, f);
      if (existing.some((r) => r.id === id || (r.source === "system" && r.source_id === seed.key && r.owner === f))) continue;
      const today = localDate(new Date(), timezones[f]);
      const days = seed.recurrence === "weekly" ? seed.days ?? [] : [];
      const due = seed.recurrence === "weekly" ? nextDue(addDays(today, -1), "weekly", days)! : seed.recurrence === "weekdays" ? nextWorkday(today) : addWorkdays(today, seed.dueInDays ?? 0);
      out.push({
        id, title, description: "", owner: f, created_by_founder: f, account_id: "", opportunity_id: "", project_id: "", client_id: "",
        priority: seed.priority, status: "todo" as const, estimated_minutes: seed.minutes, due_at: due, recurrence: seed.recurrence, recurrence_days: days,
        recurrence_parent_id: "", dependency_ids: [], completion_evidence: "", completed_at: null, visibility: "team" as const, snoozed_until: null, snooze_reason: "",
        area: seed.area, source: "system" as const, source_id: seed.key,
      });
    }
  return out;
}
