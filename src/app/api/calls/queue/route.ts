import { z } from "zod";
import { route } from "@/server/http";
import { callQueue } from "@/server/services/calls";

export const GET = route(z.object({ list_id: z.string().max(40).default("") }), async ({ app, session, input }) => callQueue(app, session.founder, input.list_id));
