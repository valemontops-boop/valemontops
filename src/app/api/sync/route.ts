import { route } from "@/server/http";

/** Polling endpoint: one small cached range of revision tokens (spec 4.1), plus the caller's private sheet. */
export const GET = route(undefined, async ({ app, session }) => {
  const priv = app.privateRepo(session.founder);
  return { revisions: { ...(await app.repo.revisions()), ...(priv ? { mine: (await priv.revisions()).private } : {}) }, at: new Date().toISOString() };
});
