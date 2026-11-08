import { route } from "@/server/http";
import { addManualEntry, manualEntrySchema } from "@/server/services/audience";

export const POST = route(manualEntrySchema, async ({ app, session, input }) => addManualEntry(app, session.founder, input));
