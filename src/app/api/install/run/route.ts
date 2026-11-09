import { z } from "zod";
import { RuleError, route } from "@/server/http";
import { getConfig } from "@/server/config";
import { runInstall } from "@/server/services/install";

/**
 * D086: "Prepare the database" — the idempotent setup:sheets logic, run server-side (founder-only, same-origin and
 * audited by route()). A founder prepares the shared Sheet and only their own private Sheet.
 */
export const POST = route(z.object({ target: z.enum(["shared", "own"]) }), async ({ session, app, input }) => {
  const cfg = getConfig();
  if (cfg.mode !== "live") throw new RuleError("The installation only concerns LIVE mode.");
  return input.target === "shared" ? runInstall(cfg, "shared", app.repo) : runInstall(cfg, session.founder, null);
});
