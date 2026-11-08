import { route } from "@/server/http";
import { createOpportunity, createOpportunitySchema, updateOpportunity, updateOpportunitySchema } from "@/server/services/crm";

export const POST = route(createOpportunitySchema, async ({ repo, session, input }) => createOpportunity(repo, session.founder, input));
export const PATCH = route(updateOpportunitySchema, async ({ repo, session, input }) => updateOpportunity(repo, session.founder, input));
