import { route } from "@/server/http";
import { FINANCE_ROUTES } from "@/server/services/finance-routes";

/** USD→EUR rate for contractor payments (D085): handlers and Zod schemas live in FINANCE_ROUTES. */
const r = (key: string) => { const [schema, handler] = FINANCE_ROUTES[key]; return route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never)); };
export const GET = r("GET /api/finance/usd-rate");
export const PUT = r("PUT /api/finance/usd-rate");
