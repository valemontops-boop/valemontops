import { route } from "@/server/http";
import { nba } from "@/server/services/insights";

export const GET = route(undefined, async ({ app, session }) => nba(app, session.founder));
