import { route } from "@/server/http";
import { setMode, setModeSchema } from "@/server/services/myday";

export const POST = route(setModeSchema, async ({ repo, session, input }) => setMode(repo, session.founder, input));
