import { route } from "@/server/http";
import { linkedinSessions } from "@/server/services/linkedin";

export const GET = route(undefined, async ({ app, session }) => linkedinSessions(app, session.founder));
