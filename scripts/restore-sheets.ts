/**
 * Restore a backup into a NEW spreadsheet (Stage 4B, D084) — docs/DEPLOYMENT.md › Restore.
 *
 *   npm run restore:sheets -- --from-sheet <backupSpreadsheetId> --to <newEmptySpreadsheetId>
 *   npm run restore:sheets -- --from-bundle ./valemont-os-backup-2026-11-09.json --to <newEmptySpreadsheetId>
 *   npm run restore:sheets -- --verify <backupSpreadsheetId>        (compare a backup with the live Sheet, read-only)
 *
 * Credentials come from env only (GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, SHEETS_SPREADSHEET_ID = the live Sheet, which is
 * never written). The target must be created by a founder and shared with the service account (spec 4.8), and must
 * be empty. After a successful restore: set SHEETS_SPREADSHEET_ID=<new id> on the host and redeploy.
 */
import fs from "node:fs";
import { readAllTabs, restoreInto, RestoreRefusedError } from "../src/data/sheets/backup";
import { compareToLive, describeIssues, isBundle, statsOf, type Grid } from "../src/domain/backup";
import { clientFor, fail } from "./_client";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const live = process.env.SHEETS_SPREADSHEET_ID ?? "";
  const verify = arg("verify");
  if (verify) {
    if (!live) fail("SHEETS_SPREADSHEET_ID (the live Sheet) is not set.");
    const [copy, now] = await Promise.all([readAllTabs(clientFor(verify)), readAllTabs(clientFor(live))]);
    const r = compareToLive(statsOf(copy), statsOf(now));
    console.log(`${r.ok ? "✓" : "✗"} backup ${verify}: ${r.tabs} tabs, ${r.rows} rows; live has ${r.newerRows} newer rows.`);
    if (!r.ok) console.log(`  ${describeIssues(r)}`);
    process.exit(r.ok ? 0 : 1);
  }
  const to = arg("to");
  if (!to) fail("--to <new spreadsheet id> is required (create an empty Sheet and share it with the service account).");
  let tabs: Record<string, Grid>;
  const fromSheet = arg("from-sheet");
  const fromBundle = arg("from-bundle");
  if (fromSheet) tabs = await readAllTabs(clientFor(fromSheet));
  else if (fromBundle) {
    const parsed: unknown = JSON.parse(fs.readFileSync(fromBundle, "utf8"));
    if (!isBundle(parsed)) fail("This file is not a Valemont OS backup bundle.");
    tabs = parsed.tabs;
  } else fail("Give --from-sheet <backup id> or --from-bundle <file.json>.");
  console.log(`Restoring ${Object.keys(tabs!).length} tabs into ${to}…`);
  const r = await restoreInto(clientFor(to!), to!, tabs!, { liveId: live });
  console.log(`${r.verify.ok ? "✓" : "✗"} ${r.tabsWritten} tabs, ${r.rowsWritten} rows written; verify: ${describeIssues(r.verify)}`);
  if (!r.verify.ok) process.exit(1);
  console.log(`\nNext: npm run doctor:sheets with SHEETS_SPREADSHEET_ID=${to}, then set SHEETS_SPREADSHEET_ID=${to} on the host and redeploy.`);
}

main().catch((e) => fail(e instanceof RestoreRefusedError ? `Refused: ${e.message}` : (e as Error).message));
