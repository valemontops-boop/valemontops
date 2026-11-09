import { route } from "@/server/http";
import { audienceOverview } from "@/server/services/audience";

export const GET = route(undefined, async ({ app, session }) => audienceOverview(app, session.founder));
