import { route } from "@/server/http";
import { applyLateCorrection, correctionSchema } from "@/server/services/results";

export const POST = route(correctionSchema, async ({ app, session, input }) => applyLateCorrection(app, session.founder, input));
