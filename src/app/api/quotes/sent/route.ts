import { route } from "@/server/http";
import { markSent, transitionSchema } from "@/server/services/quotes";

/** The founder sent the PDF themselves; logs proposal_sent once (no email is sent by the app). */
export const POST = route(transitionSchema, async ({ repo, session, input }) => markSent(repo, session.founder, input));
