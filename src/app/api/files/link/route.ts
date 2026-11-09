import { z } from "zod";
import { route } from "@/server/http";
import { filesFor, linkFile, linkSchema } from "@/server/services/files";

export const GET = route(z.object({ record_type: z.string().max(40), record_id: z.string().uuid() }), async ({ app, input }) => filesFor(app, input.record_type, input.record_id));
export const POST = route(linkSchema, async ({ app, session, input }) => linkFile(app, session.founder, input));
