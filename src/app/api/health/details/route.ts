import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { healthDetails } from "@/server/services/health";

/** Founders only (session): readiness with reasons, Sheets latency, quota counters, integrations, backups, audit queue (D084). */
export const GET = route(undefined, async ({ app }) => healthDetails(app, getConfig().errors));
