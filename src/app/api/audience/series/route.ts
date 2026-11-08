import { route } from "@/server/http";
import { audienceSeries, seriesSchema } from "@/server/services/audience";

export const GET = route(seriesSchema, async ({ app, session, input }) => audienceSeries(app, session.founder, input));
