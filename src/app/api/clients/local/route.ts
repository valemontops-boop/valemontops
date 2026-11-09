import { route } from "@/server/http";
import { DELIVERY_ROUTES } from "@/server/services/delivery-routes";

/** Clients & delivery (Stage 2B, D075): handlers and Zod schemas live in DELIVERY_ROUTES. */
const r = (key: string) => { const [schema, handler] = DELIVERY_ROUTES[key]; return route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never)); };
export const GET = r("GET /api/clients/local");
export const PUT = r("PUT /api/clients/local");
export const POST = r("POST /api/clients/local");
