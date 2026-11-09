import { route } from "@/server/http";
import { trackerAction, trackerActionSchema, trackerStatus } from "@/server/services/tracker";

/** Settings › My tracker: status (never a secret), test event, period backfill, day summary. */
export const GET = route(undefined, async ({ app, session }) => trackerStatus(app, session.founder));
export const POST = route(trackerActionSchema, async ({ app, session, input }) => trackerAction(app, session.founder, input));
