import { route } from "@/server/http";
import { upcomingEvents } from "@/server/services/agenda";

export const GET = route(undefined, async ({ app, session }) => upcomingEvents(app, session.founder));
