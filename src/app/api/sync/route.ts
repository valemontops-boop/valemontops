import { after } from "next/server";
import { route } from "@/server/http";
import { maybeSnapshot } from "@/server/services/snapshot";
import { maybeBackup } from "@/server/services/backups";

/** Polling endpoint: one small cached range of revision tokens (spec 4.1), plus the caller's private sheet. */
export const GET = route(undefined, async ({ app, session }) => {
  void maybeSnapshot(app); // spec 4.6/4.11: the first request of a 6-hour slot starts the audience snapshot (LIVE + Instagram only)
  // D084: the first request of the day starts the daily backup (LIVE + BACKUP_DRIVE_FOLDER_ID only), after the response.
  try { after(async () => { await maybeBackup(app); }); } catch { void maybeBackup(app); }
  const priv = app.privateRepo(session.founder);
  return { revisions: { ...(await app.repo.revisions()), ...(priv ? { mine: (await priv.revisions()).private } : {}) }, at: new Date().toISOString() };
});
