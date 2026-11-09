import { route } from "@/server/http";
import { benchmarks } from "@/server/services/email";

export const GET = route(undefined, async ({ app, session }) => benchmarks(app, session.founder));
