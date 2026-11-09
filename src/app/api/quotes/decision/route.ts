import { route } from "@/server/http";
import { decideQuote, decideSchema } from "@/server/services/quotes";

export const POST = route(decideSchema, async ({ repo, session, input }) => decideQuote(repo, session.founder, input));
