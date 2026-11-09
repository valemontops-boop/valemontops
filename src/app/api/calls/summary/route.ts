import { z } from "zod";
import { route } from "@/server/http";
import { sessionSummary } from "@/server/services/calls";

export const GET = route(z.object({ id: z.string().uuid() }), async ({ app, session, input }) => sessionSummary(app, session.founder, input.id));
