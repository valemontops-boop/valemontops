import { route } from "@/server/http";
import { CONTENT_ROUTES } from "@/server/services/content-routes";

/** Drive media picker (D081, read-only, service account): handlers and Zod schemas live in CONTENT_ROUTES. */
const r = (key: string) => { const [schema, handler] = CONTENT_ROUTES[key]; return route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never)); };
export const GET = r("GET /api/content/media");
