import { z } from "zod";
import { route } from "@/server/http";
import { linkedinQueue } from "@/server/services/linkedin";

export const GET = route(z.object({ list_id: z.string().max(40).default("") }), async ({ app, session, input }) => linkedinQueue(app, session.founder, input.list_id));
