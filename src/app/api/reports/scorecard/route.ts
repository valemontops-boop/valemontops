import { z } from "zod";
import { route } from "@/server/http";
import { scorecard, scorecardCsv } from "@/server/services/insights";

export const GET = route(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), format: z.enum(["json", "csv"]).default("json") }), async ({ app, session, input }) => {
  if (input.format === "csv") {
    return new Response(await scorecardCsv(app, session.founder, input.week), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="valemont-scorecard-${input.week ?? "this-week"}.csv"`, "cache-control": "no-store" } });
  }
  return scorecard(app, session.founder, input.week);
});
