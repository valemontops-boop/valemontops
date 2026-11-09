import type { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import type { AppContext } from "../context";
import {
  advanceBatch, batchSchema, checklistSchema, contentStudio, createPiece, createPieceSchema, metricsSchema, saveChecklist, saveMetrics, studioSchema,
  updatePiece, updatePieceSchema, updateVariant, variantSchema,
} from "./content-studio";
import { runSnapshot, snapshotStatus } from "./snapshot";

type Handler = (ctx: AppContext, founder: FounderKey, input: never) => Promise<unknown>;
/**
 * Content Studio API (Stage 3, D079), one table shared by the Next route handlers (src/app/api/content/**, through route():
 * session, same-origin, Zod) and the browser preview's mock fetch.
 */
export const CONTENT_ROUTES: Record<string, [z.ZodTypeAny | null, Handler]> = {
  "GET /api/content": [studioSchema, (c, f, i) => contentStudio(c, f, i)],
  "POST /api/content": [createPieceSchema, (c, f, i) => createPiece(c, f, i)],
  "PATCH /api/content": [updatePieceSchema, (c, f, i) => updatePiece(c, f, i)],
  "POST /api/content/batch": [batchSchema, (c, f, i) => advanceBatch(c, f, i)],
  "PATCH /api/content/variants": [variantSchema, (c, f, i) => updateVariant(c, f, i)],
  "PUT /api/content/metrics": [metricsSchema, (c, f, i) => saveMetrics(c, f, i)],
  "PUT /api/content/checklist": [checklistSchema, (c, f, i) => saveChecklist(c, f, i)],
  "GET /api/content/snapshot": [null, (c) => snapshotStatus(c)],
  // "Capture now" by a signed-in founder: same idempotent job; DEMO has no Instagram connection (not_configured).
  "POST /api/content/snapshot": [null, async (c) => (c.mode === "live" ? runSnapshot(c, { trigger: "founder" }) : { status: "not_configured" })],
};
