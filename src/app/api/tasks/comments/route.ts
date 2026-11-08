import { z } from "zod";
import { route } from "@/server/http";
import { addComment, commentSchema, listComments } from "@/server/services/tasks";

export const GET = route(z.object({ task_id: z.string().uuid() }), async ({ app, input }) => listComments(app, input.task_id));
export const POST = route(commentSchema, async ({ app, session, input }) => addComment(app, session.founder, input));
