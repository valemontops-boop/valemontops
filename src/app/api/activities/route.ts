import { route } from "@/server/http";
import { logActivity, logActivitySchema } from "@/server/services/activities";

export const POST = route(logActivitySchema, async ({ repo, session, input }) => logActivity(repo, session.founder, input));
