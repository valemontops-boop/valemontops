import { route } from "@/server/http";
import { getPlaybook, playbookEditSchema, savePlaybookItem } from "@/server/services/playbook";

export const GET = route(undefined, async ({ app, session }) => getPlaybook(app, session.founder));
export const POST = route(playbookEditSchema, async ({ app, session, input }) => savePlaybookItem(app, session.founder, input));
