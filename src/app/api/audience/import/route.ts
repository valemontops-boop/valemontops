import { route } from "@/server/http";
import { importLinkedIn, importSchema } from "@/server/services/audience";

export const POST = route(importSchema, async ({ app, session, input }) => importLinkedIn(app, session.founder, input));
