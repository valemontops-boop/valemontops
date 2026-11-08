import { route } from "@/server/http";
import { contentLogSchema, logContent, marketingWeek } from "@/server/services/marketing-week";

export const GET = route(undefined, async ({ app, session }) => marketingWeek(app, session.founder));
export const POST = route(contentLogSchema, async ({ app, session, input }) => logContent(app, session.founder, input));
