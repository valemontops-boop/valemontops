import { route } from "@/server/http";
import { addTraffic, importTraffic, trafficImportSchema, trafficManualSchema } from "@/server/services/marketing";

export const POST = route(trafficImportSchema, async ({ app, session, input }) => importTraffic(app, session.founder, input));
export const PUT = route(trafficManualSchema, async ({ app, session, input }) => addTraffic(app, session.founder, input));
