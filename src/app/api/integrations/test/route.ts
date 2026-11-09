import { route } from "@/server/http";
import { STAGE4A_ROUTES } from "@/server/services/stage4a-routes";

/** Test connection: one read-only call to the provider (or a signature self-check for webhooks). */
const [schema, handler] = STAGE4A_ROUTES["POST /api/integrations/test"];
export const POST = route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never));
