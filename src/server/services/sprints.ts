import { z } from "zod";
import { newId } from "@/lib/ids";
import { BRANDS, FOUNDERS, type FounderKey } from "@/domain/constants";
import { dedupeEvents, isOutreach, newBusinessesContacted } from "@/domain/activity";
import { localDate } from "@/domain/time";
import type { AppContext } from "../context";
import { dealValue } from "@/domain/conversion";
import { numSetting, offerDefaults } from "./common";

const targets = z.object({ contacted: z.number().int().min(0).max(1_000), replies: z.number().int().min(0).max(1_000), demos: z.number().int().min(0).max(500), pilots: z.number().int().min(0).max(100) });
export const sprintSchema = z.object({
  name: z.string().trim().min(1).max(120),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  niche: z.string().trim().max(200).default(""),
  targets: z.object({ theo: targets, pablo: targets }),
  brand_split: z.object({ local: z.number().min(0).max(1), consulting: z.number().min(0).max(1), thirty: z.number().min(0).max(1) }),
}).refine((s) => s.end_date >= s.start_date, "End date must be after start date");

export async function createSprint(ctx: AppContext, founder: FounderKey, input: z.infer<typeof sprintSchema>) {
  const { rows } = await ctx.repo.list("Sprints", { fresh: true });
  for (const s of rows.filter((s) => s.status === "active")) await ctx.repo.update("Sprints", s.id, s.version, { status: "done" }, { founder });
  const [row] = await ctx.repo.insert("Sprints", [{ id: newId(), ...input, status: "active" }], { founder });
  return row;
}

export async function activeSprint(ctx: AppContext) {
  const { rows } = await ctx.repo.list("Sprints");
  return rows.filter((s) => s.status === "active" && !s.is_archived).sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null;
}

/** Sprint progress per founder from events, and actual effort split by brand vs target. */
export async function sprintProgress(ctx: AppContext) {
  const sprint = await activeSprint(ctx);
  if (!sprint) return null;
  const t = await ctx.repo.listMany(["ActivityEvents", "Opportunities", "OpportunityStageEvents"]);
  const events = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.local_date >= sprint.start_date && e.local_date <= sprint.end_date);
  const all = dedupeEvents(t.ActivityEvents.rows);
  const per = Object.fromEntries(FOUNDERS.map((f) => {
    const mine = events.filter((e) => e.founder_key === f);
    return [f, {
      contacted: newBusinessesContacted(all, f, sprint.start_date, sprint.end_date).length,
      replies: mine.filter((e) => e.activity_type === "reply").length,
      demos: mine.filter((e) => e.activity_type === "demo_shown").length,
      pilots: mine.filter((e) => e.activity_type === "sale").length,
      target: sprint.targets[f] ?? { contacted: 0, replies: 0, demos: 0, pilots: 0 },
    }];
  }));
  const outreach = events.filter((e) => isOutreach(e.activity_type));
  const withBrand = outreach.filter((e) => e.brand);
  const split = Object.fromEntries(BRANDS.map((b) => [b, { actual: withBrand.length ? withBrand.filter((e) => e.brand === b).length / withBrand.length : null, target: sprint.brand_split[b] ?? 0 }]));
  const today = localDate(new Date(), "Europe/Paris");
  // Sprint goals (iteration 8): paying clients and EUR signed ex VAT = deals moved to Won during the sprint.
  const wonIds = new Set(t.OpportunityStageEvents.rows.filter((x) => x.to_stage === "won" && x.changed_at.slice(0, 10) >= sprint.start_date && x.changed_at.slice(0, 10) <= sprint.end_date).map((x) => x.opportunity_id));
  const won = t.Opportunities.rows.filter((o) => wonIds.has(o.id) && o.stage === "won");
  const defaults = await offerDefaults(ctx.repo);
  const signed = {
    clients: new Set(won.map((o) => o.account_id)).size,
    eurMinor: won.reduce((a, o) => a + dealValue(o, defaults), 0),
    goalClients: await numSetting(ctx.repo, "sprint_goal_paying_clients", 2),
    goalEurMinor: Math.round((await numSetting(ctx.repo, "sprint_goal_signed_eur", 3000)) * 100),
  };
  return { sprint, signed, perFounder: per, brandSplit: split, outreachWithBrand: withBrand.length, outreachTotal: outreach.length, daysLeft: Math.max(0, Math.round((Date.parse(sprint.end_date) - Date.parse(today)) / 86_400_000)) };
}
