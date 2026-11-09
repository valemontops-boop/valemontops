import { route } from "@/server/http";
import { STAGE4A_ROUTES } from "@/server/services/stage4a-routes";

/** CSV import commit: only rows the server classifies as new; idempotent by import id. */
const [schema, handler] = STAGE4A_ROUTES["POST /api/csv/import/commit"];
export const POST = route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never));
