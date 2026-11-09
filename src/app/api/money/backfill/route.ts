import { z } from "zod";
import { route } from "@/server/http";
import { backfillBank, readBackfill } from "@/server/services/bank-history";

/** D091: the Wise full-history import walks for at most ~240 s per call and resumes on the next one. */
export const maxDuration = 300;

/** Progress only (no Wise call). */
export const GET = route(undefined, async ({ app }) => readBackfill(app));
/** Founders only (session), same-origin, safe to click twice: per-instance lock + resumable state in SystemSettings. */
export const POST = route(z.object({}).passthrough(), async ({ app, session }) => backfillBank(app, { founder: session.founder }));
