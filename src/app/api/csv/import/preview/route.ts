import { route } from "@/server/http";
import { STAGE4A_ROUTES } from "@/server/services/stage4a-routes";

/** CSV import preview (tasks, content ideas): new / duplicate / invalid rows; nothing is written. */
const [schema, handler] = STAGE4A_ROUTES["POST /api/csv/import/preview"];
export const POST = route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never));
