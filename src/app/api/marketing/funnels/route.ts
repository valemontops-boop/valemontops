import { route } from "@/server/http";
import { funnelsSchema, marketingFunnels } from "@/server/services/marketing";

export const GET = route(funnelsSchema, async ({ app, session, input }) => marketingFunnels(app, session.founder, input));
