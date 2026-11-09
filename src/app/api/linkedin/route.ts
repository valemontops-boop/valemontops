import { route } from "@/server/http";
import { linkedinSchema, logLinkedIn } from "@/server/services/linkedin";

export const POST = route(linkedinSchema, async ({ app, session, input }) => logLinkedIn(app, session.founder, input));
