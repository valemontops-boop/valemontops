import { route } from "@/server/http";
import { addSearchConsoleRow, gscImportSchema, gscManualSchema, importSearchConsole, seoOverview, seoSchema } from "@/server/services/seo";

export const GET = route(seoSchema, async ({ app, session, input }) => seoOverview(app, session.founder, input));
export const POST = route(gscImportSchema, async ({ app, session, input }) => importSearchConsole(app, session.founder, input));
export const PUT = route(gscManualSchema, async ({ app, session, input }) => addSearchConsoleRow(app, session.founder, input));
