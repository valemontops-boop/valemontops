import { RuleError, route } from "@/server/http";
import { getConfig } from "@/server/config";
import { installStatus } from "@/server/services/install";

/** D086: what the Installation page shows (founder-only, read-only). */
export const GET = route(undefined, async ({ session }) => {
  const cfg = getConfig();
  if (cfg.mode !== "live") throw new RuleError("The installation only concerns LIVE mode.");
  return installStatus(cfg, session.founder);
});
