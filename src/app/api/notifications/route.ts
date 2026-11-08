import { route } from "@/server/http";
import { dismissNotification, dismissSchema, notifications } from "@/server/services/insights";

export const GET = route(undefined, async ({ app, session }) => notifications(app, session.founder));
export const POST = route(dismissSchema, async ({ app, session, input }) => dismissNotification(app, session.founder, input.key));
