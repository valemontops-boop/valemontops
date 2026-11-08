import { route } from "@/server/http";
import { convertIdea, convertSchema } from "@/server/services/ideas";

export const POST = route(convertSchema, async ({ app, session, input }) => convertIdea(app, session.founder, input));
