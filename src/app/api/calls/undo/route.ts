import { route } from "@/server/http";
import { undoCall, undoSchema } from "@/server/services/calls";

export const POST = route(undoSchema, async ({ app, session, input }) => undoCall(app, session.founder, input));
