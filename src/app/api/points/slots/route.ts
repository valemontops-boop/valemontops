import { route } from "@/server/http";
import { proposeSlots, slotsSchema } from "@/server/services/agenda";

export const GET = route(slotsSchema, async ({ app, input }) => proposeSlots(app, input.duration_min));
