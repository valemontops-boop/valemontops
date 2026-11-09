import { z } from "zod";
import { route } from "@/server/http";
import { httpFetcher, runSiteAudit } from "@/server/services/seo";
import { demoSiteFetcher } from "@/server/services/demo-seo";

/** LIVE fetches the configured site URLs (https, same host, ≤ 20 pages, 10 s per request) and stores the result in SeoAudits; DEMO reads the demo site from memory (no network). */
export const POST = route(z.object({}).strict(), async ({ app, session }) => runSiteAudit(app, session.founder, app.mode === "demo" ? demoSiteFetcher : httpFetcher));
