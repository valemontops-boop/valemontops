import { route } from "@/server/http";
import { getMyDay } from "@/server/services/myday";

export const GET = route(undefined, async ({ repo, session }) => getMyDay(repo, session.founder));
