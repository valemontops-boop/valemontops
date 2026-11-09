import { route } from "@/server/http";
import { callbackSchema, listCallbacks, scheduleCallback } from "@/server/services/calls";

/** Call-backs (D080): GET = the founder's call-backs still to make; POST = set or move the call-back of a logged call. */
export const GET = route(undefined, async ({ app, session }) => listCallbacks(app, session.founder));
export const POST = route(callbackSchema, async ({ app, session, input }) => scheduleCallback(app, session.founder, input));
