import { route } from "@/server/http";
import { FINANCE_ROUTES } from "@/server/services/finance-routes";

/** Finance (Stage 3, D078): handlers and Zod schemas live in FINANCE_ROUTES. */
const r = (key: string) => { const [schema, handler] = FINANCE_ROUTES[key]; return route(schema ?? undefined, ({ app, session, input }) => handler(app, session.founder, input as never)); };
export const POST = r("POST /api/finance/entries/reverse");
