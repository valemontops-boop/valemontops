import { route } from "@/server/http";
import { objectionReport } from "@/server/services/calls";

export const GET = route(undefined, async ({ app, session }) => objectionReport(app, session.founder));
