import { route } from "@/server/http";
import { followUpQueue } from "@/server/services/email";

export const GET = route(undefined, async ({ app, session }) => followUpQueue(app, session.founder));
