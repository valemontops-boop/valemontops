import { route } from "@/server/http";
import { exportFile, exportSchema } from "@/server/services/export";

/** Period export for AI analysis (Markdown, or Excel). Session + Zod via route(); read-only. */
export const GET = route(exportSchema, async ({ app, session, input }) => {
  const f = await exportFile(app, session.founder, input);
  return new Response(f.body as BodyInit, {
    headers: {
      "content-type": f.contentType,
      "content-disposition": `attachment; filename="${f.filename}"`,
      "cache-control": "no-store",
    },
  });
});
