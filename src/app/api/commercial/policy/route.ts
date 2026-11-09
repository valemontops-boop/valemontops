import { route } from "@/server/http";
import { policyEditSchema, savePolicy } from "@/server/services/commercial";

export const POST = route(policyEditSchema, async ({ repo, session, input }) => savePolicy(repo, session.founder, input));
