import { route } from "@/server/http";
import { validateAudit, validateAuditSchema } from "@/server/services/audits";

export const POST = route(validateAuditSchema, async ({ repo, session, input }) => validateAudit(repo, session.founder, input));
