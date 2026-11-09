/** Stage 2A (D074) routes for the in-browser preview: same services and schemas as the Next route handlers. */
import { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import type { AppContext } from "@/server/context";
import {
  approveQuote, createQuote, createQuoteSchema, dealWorkspace, decideQuote, decideSchema, driveSchema, markSent, newVersion, quotePdf, saveQuote, saveQuoteSchema,
  saveQuoteToDrive, transitionSchema, versionSchema,
} from "@/server/services/quotes";
import { saveAudit, saveAuditSchema, startAudit, startAuditSchema, listTemplates, validateAudit, validateAuditSchema } from "@/server/services/audits";
import { commercialOverview, policyEditSchema, priceItemSchema, savePolicy, savePriceItem } from "@/server/services/commercial";

type Handler = (input: unknown, f: FounderKey) => Promise<unknown>;
export function quoteRoutes(ctx: AppContext, grant: (f: FounderKey) => string | null): Record<string, [z.ZodTypeAny | null, Handler]> {
  const r = ctx.repo;
  return {
    "GET /api/quotes": [z.object({ opportunity_id: z.string().uuid() }), async (i) => dealWorkspace(r, (i as { opportunity_id: string }).opportunity_id)],
    "POST /api/quotes": [createQuoteSchema, async (i, f) => createQuote(r, f, i as never)],
    "PATCH /api/quotes": [saveQuoteSchema, async (i, f) => saveQuote(r, f, i as never)],
    "POST /api/quotes/version": [versionSchema, async (i, f) => newVersion(r, f, i as never)],
    "POST /api/quotes/approve": [transitionSchema, async (i, f) => approveQuote(r, f, i as never)],
    "POST /api/quotes/sent": [transitionSchema, async (i, f) => markSent(r, f, i as never)],
    "POST /api/quotes/decision": [decideSchema, async (i, f) => decideQuote(r, f, i as never)],
    // pdf-lib runs in the browser too: the preview generates the real PDF.
    "GET /api/quotes/pdf": [z.object({ id: z.string().uuid(), download: z.enum(["0", "1"]).default("0") }), async (i) => {
      const v = i as { id: string; download: "0" | "1" };
      const { bytes, filename } = await quotePdf(r, v.id);
      return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `${v.download === "1" ? "attachment" : "inline"}; filename="${filename}"` } });
    }],
    "POST /api/quotes/drive": [driveSchema, async (i, f) => saveQuoteToDrive(ctx, f, grant(f), i as never)],
    "GET /api/audits/templates": [null, async () => listTemplates(r)],
    "POST /api/audits": [startAuditSchema, async (i, f) => startAudit(r, f, i as never)],
    "PATCH /api/audits": [saveAuditSchema, async (i, f) => saveAudit(r, f, i as never)],
    "POST /api/audits/validate": [validateAuditSchema, async (i, f) => validateAudit(r, f, i as never)],
    "GET /api/commercial": [null, async () => commercialOverview(r)],
    "POST /api/commercial/policy": [policyEditSchema, async (i, f) => savePolicy(r, f, i as never)],
    "POST /api/commercial/price-book": [priceItemSchema, async (i, f) => savePriceItem(r, f, i as never)],
  };
}
