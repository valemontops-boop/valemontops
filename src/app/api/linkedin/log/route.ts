import { route } from "@/server/http";
import { linkedinLog, linkedinLogSchema } from "@/server/services/linkedin";

export const GET = route(linkedinLogSchema, async ({ app, session, input }) => linkedinLog(app, session.founder, input));
