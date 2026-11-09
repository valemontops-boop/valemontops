import { route } from "@/server/http";
import { maybeSnapshot } from "@/server/services/snapshot";

/** Polling endpoint: one small cached range of revision tokens (spec 4.1), plus the caller's private sheet. */
export const GET = route(undefined, async ({ app, session }) => {
  void maybeSnapshot(app); // spec 4.6/4.11: the first request of a 6-hour slot starts the audience snapshot (LIVE + Instagram only)
  const priv = app.privateRepo(session.founder);
  return { revisions: { ...(await app.repo.revisions()), ...(priv ? { mine: (await priv.revisions()).private } : {}) }, at: new Date().toISOString() };
});
