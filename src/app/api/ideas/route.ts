import { route } from "@/server/http";
import { addIdea, ideaSchema, ideaUpdateSchema, listIdeas, updateIdea } from "@/server/services/ideas";

export const GET = route(undefined, async ({ app }) => listIdeas(app));
export const POST = route(ideaSchema, async ({ app, session, input }) => addIdea(app, session.founder, input));
export const PATCH = route(ideaUpdateSchema, async ({ app, session, input }) => updateIdea(app, session.founder, input));
