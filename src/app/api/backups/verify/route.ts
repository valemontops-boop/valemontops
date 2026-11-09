import { route } from "@/server/http";
import { verifyBackup, verifyBackupSchema } from "@/server/services/backups";

/** Compares one backup of the backups folder with the live spreadsheet now: tabs, headers, row counts (D084). */
export const POST = route(verifyBackupSchema, async ({ app, input }) => verifyBackup(app, input));
