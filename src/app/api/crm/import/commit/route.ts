import { route } from "@/server/http";
import { commit, commitSchema } from "@/server/services/imports";

export const POST = route(commitSchema, async ({ repo, session, input }) => commit(repo, session.founder, input));
