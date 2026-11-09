import { route } from "@/server/http";
import { auditQuerySchema, listAudit } from "@/server/services/audit-log";

/** Audit log viewer (Settings › Diagnostics), D084: filters by entity, founder and dates; newest first. */
export const GET = route(auditQuerySchema, async ({ app, session, input }) => listAudit(app.repo, session.founder, input));
