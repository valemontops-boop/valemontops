import { route } from "@/server/http";
import { STAGE4A_ROUTES } from "@/server/services/stage4a-routes";

/** Sync now (LIVE only): Wise, Stripe, Instagram capture, the same idempotent jobs as elsewhere. */
const [schema, handler] = STAGE4A_ROUTES["POST /api/integrations/sync"];
export const POST = route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never));
