import { route } from "@/server/http";
import { createCustomTemplate, customCreateSchema, customDeleteSchema, deleteCustomTemplate } from "@/server/services/playbook";

/** The founders' own templates (D090): create one (idempotent per client UUID), or delete it (both languages, version-checked). */
export const POST = route(customCreateSchema, async ({ app, session, input }) => createCustomTemplate(app, session.founder, input));
export const DELETE = route(customDeleteSchema, async ({ app, session, input }) => deleteCustomTemplate(app, session.founder, input));
