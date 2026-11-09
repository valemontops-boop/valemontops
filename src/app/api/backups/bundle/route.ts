import { route } from "@/server/http";
import { exportBundle } from "@/server/services/backups";
import { enqueueAudit, flushAudit } from "@/server/services/audit-log";

/**
 * JSON copy of the whole shared spreadsheet for a founder to keep (D084). It holds business data, so it is never
 * cached and the download itself is written to the audit log (GETs are otherwise not audited).
 */
export const GET = route(undefined, async ({ app, session, correlationId, req }) => {
  const b = await exportBundle(app);
  enqueueAudit(app.repo, { founder: session.founder, method: "GET", path: req.nextUrl.pathname, status: 200, correlationId, input: undefined, secret: "" });
  void flushAudit(app.repo);
  return new Response(b.body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${b.filename}"`, "cache-control": "no-store" } });
});
