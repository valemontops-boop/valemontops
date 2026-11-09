import { route } from "@/server/http";
import { saveAudit, saveAuditSchema, startAudit, startAuditSchema } from "@/server/services/audits";

export const POST = route(startAuditSchema, async ({ repo, session, input }) => startAudit(repo, session.founder, input));
export const PATCH = route(saveAuditSchema, async ({ repo, session, input }) => saveAudit(repo, session.founder, input));
