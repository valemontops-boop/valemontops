import { route } from "@/server/http";
import { listPoints, pointSchema, pointUpdateSchema, schedulePoint, updatePoint } from "@/server/services/agenda";

export const GET = route(undefined, async ({ app }) => listPoints(app));
export const POST = route(pointSchema, async ({ app, session, input }) => schedulePoint(app, session.founder, input));
export const PATCH = route(pointUpdateSchema, async ({ app, session, input }) => updatePoint(app, session.founder, input));
