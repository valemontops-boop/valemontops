import { route } from "@/server/http";
import { csvSchema, importBankCsv } from "@/server/services/bank";

/** D091: a multi-year export arrives in several parts (record boundaries, header repeated); 500 rows per Sheets append. */
export const maxDuration = 120;
export const POST = route(csvSchema, async ({ app, session, input }) => importBankCsv(app, session.founder, input));
