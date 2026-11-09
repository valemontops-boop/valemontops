import { route } from "@/server/http";
import { backupStatus, runBackup } from "@/server/services/backups";

/** Backups status (Settings › Diagnostics) and "Back up now" (D084). DEMO answers not_configured: it never copies a real file. */
export const GET = route(undefined, async ({ app }) => backupStatus(app));
export const POST = route(undefined, async ({ app }) => runBackup(app, { trigger: "founder" }));
