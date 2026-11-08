import { z } from "zod";
import { route } from "@/server/http";
import { saveWeekly, weeklyReview, weeklySchema } from "@/server/services/insights";

export const GET = route(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), async ({ app, session, input }) => weeklyReview(app, session.founder, input.week));
export const POST = route(weeklySchema, async ({ app, session, input }) => saveWeekly(app, session.founder, input));
