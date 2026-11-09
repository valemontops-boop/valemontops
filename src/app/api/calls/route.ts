import { route } from "@/server/http";
import { callSchema, logCall } from "@/server/services/calls";

export const POST = route(callSchema, async ({ app, session, input }) => logCall(app, session.founder, input));
