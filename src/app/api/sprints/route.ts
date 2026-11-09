import { route } from "@/server/http";
import { createSprint, sprintProgress, sprintSchema } from "@/server/services/sprints";

export const GET = route(undefined, async ({ app }) => ({ progress: await sprintProgress(app) }));
export const POST = route(sprintSchema, async ({ app, session, input }) => createSprint(app, session.founder, input));
