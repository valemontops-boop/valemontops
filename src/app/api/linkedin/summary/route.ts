import { route } from "@/server/http";
import { linkedinSummary, linkedinSummarySchema } from "@/server/services/linkedin";

export const GET = route(linkedinSummarySchema, async ({ app, session, input }) => linkedinSummary(app, session.founder, input.id));
