import { route } from "@/server/http";
import { commandCenter } from "@/server/services/insights";

export const GET = route(undefined, async ({ app, session }) => commandCenter(app, session.founder));
