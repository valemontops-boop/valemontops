import { z } from "zod";
import { route } from "@/server/http";
import { createQuote, createQuoteSchema, dealWorkspace, saveQuote, saveQuoteSchema } from "@/server/services/quotes";

/** Deal workspace: opportunity, audits, quotes (all versions, derived status and totals), price book, policy. */
export const GET = route(z.object({ opportunity_id: z.string().uuid() }), async ({ repo, input }) => dealWorkspace(repo, input.opportunity_id));
export const POST = route(createQuoteSchema, async ({ repo, session, input }) => createQuote(repo, session.founder, input));
export const PATCH = route(saveQuoteSchema, async ({ repo, session, input }) => saveQuote(repo, session.founder, input));
