import type { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import type { AppContext } from "../context";
import { commitListImport, csvExportSchema, csvImportCommitSchema, csvImportPreviewSchema, exportList, previewListImport } from "./csv-lists";
import { integrationActionSchema, syncIntegration, testIntegration } from "./integrations";

type Handler = (ctx: AppContext, founder: FounderKey, input: never) => Promise<unknown>;

/** CSV download: text/csv attachment, never cached. */
export async function csvResponse(ctx: AppContext, founder: FounderKey, input: z.infer<typeof csvExportSchema>) {
  const x = await exportList(ctx, founder, input);
  return new Response(x.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${x.filename}"`, "cache-control": "no-store" } });
}

/**
 * Stage 4A API (D083), one table shared by the Next route handlers (through route(): session, same-origin, Zod) and the
 * browser preview's mock fetch. GET /api/integrations needs the grant cookies, so its Next handler is written by hand.
 */
export const STAGE4A_ROUTES: Record<string, [z.ZodTypeAny | null, Handler]> = {
  "GET /api/csv/export": [csvExportSchema, (c, f, i) => csvResponse(c, f, i)],
  "POST /api/csv/import/preview": [csvImportPreviewSchema, (c, f, i) => previewListImport(c, f, i)],
  "POST /api/csv/import/commit": [csvImportCommitSchema, (c, f, i) => commitListImport(c, f, i)],
  "POST /api/integrations/test": [integrationActionSchema, (c, f, i) => testIntegration(c, f, i)],
  "POST /api/integrations/sync": [integrationActionSchema, (c, f, i) => syncIntegration(c, f, i)],
};
