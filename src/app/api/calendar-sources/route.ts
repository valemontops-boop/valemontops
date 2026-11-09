import { z } from "zod";
import { route } from "@/server/http";
import { addCalendarSource, listCalendarSources, removeCalendarSource, sourceSchema } from "@/server/services/agenda";

export const GET = route(undefined, async ({ app }) => listCalendarSources(app));
export const POST = route(sourceSchema, async ({ app, session, input }) => addCalendarSource(app, session.founder, input));
export const PATCH = route(z.object({ id: z.string().uuid(), expected_version: z.number().int() }), async ({ app, session, input }) => removeCalendarSource(app, session.founder, input.id, input.expected_version));
