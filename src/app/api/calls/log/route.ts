import { route } from "@/server/http";
import { callLog, callLogSchema } from "@/server/services/calls";

export const GET = route(callLogSchema, async ({ app, session, input }) => callLog(app, session.founder, input));
