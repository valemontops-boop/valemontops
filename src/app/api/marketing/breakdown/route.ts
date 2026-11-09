import { route } from "@/server/http";
import { addBreakdown, breakdownSchema } from "@/server/services/marketing";

export const POST = route(breakdownSchema, async ({ app, session, input }) => addBreakdown(app, session.founder, input));
