import { route } from "@/server/http";
import { listSends, markReply, replySchema } from "@/server/services/email";

export const GET = route(undefined, async ({ app }) => listSends(app));
export const PATCH = route(replySchema, async ({ app, session, input }) => markReply(app, session.founder, input));
