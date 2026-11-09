import { route } from "@/server/http";
import { moneyOverview } from "@/server/services/bank";

export const GET = route(undefined, async ({ app, session }) => moneyOverview(app, session.founder));
