import { route } from "@/server/http";
import { addPointItem, itemToggleSchema, pointItemSchema, toggleItem } from "@/server/services/agenda";

export const POST = route(pointItemSchema, async ({ app, session, input }) => addPointItem(app, session.founder, input));
export const PATCH = route(itemToggleSchema, async ({ app, session, input }) => toggleItem(app, session.founder, input));
