import { RuleError, route } from "@/server/http";
import { getConfig } from "@/server/config";
import { runInstallDoctor } from "@/server/services/install";

/** D086: "Check" — doctor:sheets from the app. POST because it writes (then clears) one marked test row in _Doctor. */
export const POST = route(undefined, async ({ session }) => {
  const cfg = getConfig();
  if (cfg.mode !== "live") throw new RuleError("The installation only concerns LIVE mode.");
  return runInstallDoctor(cfg, session.founder);
});
