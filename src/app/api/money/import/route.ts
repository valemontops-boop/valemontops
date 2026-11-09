import { route } from "@/server/http";
import { csvSchema, importBankCsv } from "@/server/services/bank";

export const POST = route(csvSchema, async ({ app, session, input }) => importBankCsv(app, session.founder, input));
