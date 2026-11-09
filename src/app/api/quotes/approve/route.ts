import { route } from "@/server/http";
import { approveQuote, transitionSchema } from "@/server/services/quotes";

export const POST = route(transitionSchema, async ({ repo, session, input }) => approveQuote(repo, session.founder, input));
