import { route } from "@/server/http";
import { movementsPage, movementsSchema } from "@/server/services/bank-history";

/** D091: bank movements since the first one, filtered, with EUR totals and expenses by category (one page of rows). */
export const GET = route(movementsSchema, async ({ app, session, input }) => movementsPage(app, session.founder, input));
