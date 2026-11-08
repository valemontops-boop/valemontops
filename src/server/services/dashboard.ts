import { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import { dashboard } from "@/domain/dashboard";
import { localDate } from "@/domain/time";
import type { AppContext } from "../context";
import { userRow } from "./common";

export const dashboardSchema = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).default(30), scope: z.enum(["me", "team"]).default("team") });

export async function reportsDashboard(ctx: AppContext, founder: FounderKey, input: z.infer<typeof dashboardSchema>) {
  const u = await userRow(ctx.repo, founder);
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts", "OpportunityStageEvents", "Opportunities", "ContentLog"]);
  const mine = new Set(t.Opportunities.rows.filter((o) => input.scope === "team" || o.owner_founder === founder).map((o) => o.id));
  return dashboard({
    events: t.ActivityEvents.rows,
    accounts: t.Accounts.rows,
    wonDates: t.OpportunityStageEvents.rows.filter((s) => s.to_stage === "won" && mine.has(s.opportunity_id)).map((s) => s.changed_at.slice(0, 10)),
    contentDates: t.ContentLog.rows.filter((c) => input.scope === "team" || c.founder_key === founder).map((c) => c.local_date),
    founder: input.scope === "me" ? founder : null,
    tz: u.timezone,
    today: localDate(new Date(), u.timezone),
    days: input.days,
  });
}
