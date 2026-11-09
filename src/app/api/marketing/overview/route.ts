import { route } from "@/server/http";
import { marketingOverview, overviewSchema } from "@/server/services/marketing";

export const GET = route(overviewSchema, async ({ app, session, input }) => marketingOverview(app, session.founder, input));
