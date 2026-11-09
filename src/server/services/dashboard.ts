import { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import { dashboard } from "@/domain/dashboard";
import { addDays, localDate } from "@/domain/time";
import { conversionByChannel, parseSplit, timeSplit } from "@/domain/conversion";
import { MINUTES_PER_ACTION_SEED } from "@/domain/seeds";
import type { AppContext } from "../context";
import { offerDefaults, settingValue, userRow } from "./common";

export const dashboardSchema = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).default(30), scope: z.enum(["me", "team"]).default("team") });

export async function reportsDashboard(ctx: AppContext, founder: FounderKey, input: z.infer<typeof dashboardSchema>) {
  const u = await userRow(ctx.repo, founder);
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts", "OpportunityStageEvents", "Opportunities", "ContentLog", "Tasks"]);
  const today = localDate(new Date(), u.timezone);
  const from = addDays(today, -input.days + 1);
  const who = input.scope === "me" ? founder : null;
  // Iteration 8: conversion by channel (contacts → cash) and actual vs target time split.
  const conversion = conversionByChannel({ events: t.ActivityEvents.rows, opps: t.Opportunities.rows, stageEvents: t.OpportunityStageEvents.rows.filter((s) => !who || t.Opportunities.rows.find((o) => o.id === s.opportunity_id)?.owner_founder === who), from, to: today, founder: who, offerDefaults: await offerDefaults(ctx.repo) });
  const split = timeSplit({ events: t.ActivityEvents.rows, minutes: MINUTES_PER_ACTION_SEED, tasks: t.Tasks.rows.filter((x) => !x.is_archived), from, to: today, founder: who, target: parseSplit(await settingValue(ctx.repo, "time_split_target")) });
  const mine = new Set(t.Opportunities.rows.filter((o) => input.scope === "team" || o.owner_founder === founder).map((o) => o.id));
  const base = dashboard({
    events: t.ActivityEvents.rows,
    accounts: t.Accounts.rows,
    wonDates: t.OpportunityStageEvents.rows.filter((s) => s.to_stage === "won" && mine.has(s.opportunity_id)).map((s) => s.changed_at.slice(0, 10)),
    contentDates: t.ContentLog.rows.filter((c) => input.scope === "team" || c.founder_key === founder).map((c) => c.local_date),
    founder: input.scope === "me" ? founder : null,
    tz: u.timezone,
    today: localDate(new Date(), u.timezone),
    days: input.days,
  });
  return { ...base, conversion, timeSplit: split };
}
