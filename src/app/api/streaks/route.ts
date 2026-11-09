import { route } from "@/server/http";
import { streakSummary } from "@/server/services/results";

export const GET = route(undefined, async ({ app, session }) => streakSummary(app, session.founder));
