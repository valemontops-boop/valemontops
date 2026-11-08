import { route } from "@/server/http";
import { endSession, endSessionSchema, listSessions, startSession, startSessionSchema } from "@/server/services/calls";

export const GET = route(undefined, async ({ app, session }) => listSessions(app, session.founder));
export const POST = route(startSessionSchema, async ({ app, session, input }) => startSession(app, session.founder, input));
export const PATCH = route(endSessionSchema, async ({ app, session, input }) => endSession(app, session.founder, input.id));
