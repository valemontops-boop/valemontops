import { route } from "@/server/http";
import { dashboardSchema, reportsDashboard } from "@/server/services/dashboard";

export const GET = route(dashboardSchema, async ({ app, session, input }) => reportsDashboard(app, session.founder, input));
