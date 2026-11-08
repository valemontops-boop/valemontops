import { z } from "zod";
import { route } from "@/server/http";
import { createTask, createTaskSchema, listTasks, updateTask, updateTaskSchema } from "@/server/services/tasks";

export const GET = route(z.object({ view: z.enum(["mine", "theo", "pablo", "unassigned", "overdue", "all"]).default("all") }), async ({ app, session, input }) => listTasks(app, session.founder, input.view));
export const POST = route(createTaskSchema, async ({ app, session, input }) => createTask(app, session.founder, input));
export const PATCH = route(updateTaskSchema, async ({ app, session, input }) => updateTask(app, session.founder, input));
