import { route } from "@/server/http";
import { STAGE4A_ROUTES } from "@/server/services/stage4a-routes";

/** Safe CSV export of one list (Stage 4A, D083): formula-like text neutralised, optional period. */
const [schema, handler] = STAGE4A_ROUTES["GET /api/csv/export"];
export const GET = route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never));
