import { statsOf, verifyStats, SYSTEM_TABS, type Grid, type VerifyResult } from "@/domain/backup";
import { colLetters, quoteSheet } from "./a1";
import type { SheetsClient } from "./client";
import { setupSpreadsheet } from "./setup";

/**
 * Spreadsheet-level backup helpers (Stage 4B, D084). They read and write whole tabs as raw grids, so a backup keeps
 * malformed rows and unknown columns exactly as they are (the repository would drop them as warnings).
 */

/** Every tab of a spreadsheet as raw grids (UNFORMATTED_VALUE), 20 tabs per batchGet. */
export async function readAllTabs(client: SheetsClient): Promise<Record<string, Grid>> {
  const meta = await client.getMeta();
  const titles = meta.sheets.map((s) => s.properties.title);
  const out: Record<string, Grid> = {};
  for (let i = 0; i < titles.length; i += 20) {
    const part = titles.slice(i, i + 20);
    const grids = await client.batchGet(part.map((t) => quoteSheet(t)));
    part.forEach((t, j) => (out[t] = grids[j] ?? []));
  }
  return out;
}

export class RestoreRefusedError extends Error {
  readonly code = "restore_refused";
}

export interface RestoreReport {
  target: string;
  tabsWritten: number;
  rowsWritten: number;
  verify: VerifyResult;
}

const ROWS_PER_WRITE = 2_000;

/**
 * Restores tabs into a NEW, EMPTY spreadsheet (spec 4.8: a founder creates it and shares it with the service
 * account). Refuses the live spreadsheet and any spreadsheet that already holds data: a restore never overwrites
 * anything silently. Then verifies that every tab, header and row count matches the source exactly.
 */
export async function restoreInto(target: SheetsClient, targetId: string, tabs: Record<string, Grid>, opts: { liveId: string }): Promise<RestoreReport> {
  if (!targetId) throw new RestoreRefusedError("No target spreadsheet id.");
  if (opts.liveId && targetId === opts.liveId) throw new RestoreRefusedError("The target is the live spreadsheet. Restore into a new spreadsheet, then point SHEETS_SPREADSHEET_ID to it.");
  const existing = await readAllTabs(target);
  const used = Object.entries(existing).filter(([t, g]) => !SYSTEM_TABS.has(t) && g.slice(1).some((r) => r.some((c) => c !== "" && c !== null && c !== undefined)));
  if (used.length) throw new RestoreRefusedError(`The target spreadsheet already holds data (${used.map(([t]) => t).slice(0, 5).join(", ")}). Use a new, empty spreadsheet.`);

  // 1. Tabs + headers of the current schema (also tabs the backup does not have yet).
  await setupSpreadsheet(target);
  // 2. Each tab exactly as it was: header row of the backup, then its rows as text (RAW, never evaluated).
  let rowsWritten = 0;
  let tabsWritten = 0;
  const data = Object.entries(tabs).filter(([t]) => !SYSTEM_TABS.has(t));
  const meta = await target.getMeta();
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = data.map(([t]) => t).filter((t) => !have.has(t));
  if (missing.length) await target.batchUpdate(missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { rowCount: 2, columnCount: 26, frozenRowCount: 1 } } } })));
  for (const [tab, grid] of data) {
    const width = Math.max(1, ...grid.map((r) => r.length));
    const asText = grid.map((r) => Array.from({ length: width }, (_, i) => (r[i] === null || r[i] === undefined ? "" : String(r[i]))));
    await target.clear(quoteSheet(tab));
    for (let i = 0; i < asText.length; i += ROWS_PER_WRITE) {
      const chunk = asText.slice(i, i + ROWS_PER_WRITE);
      await target.update(`${quoteSheet(tab)}!A${i + 1}:${colLetters(width - 1)}${i + chunk.length}`, chunk);
    }
    tabsWritten++;
    rowsWritten += Math.max(0, asText.length - 1);
  }
  // 3. Columns added since the backup was taken (empty in old rows), protection and frozen header.
  await setupSpreadsheet(target);
  const restored = await readAllTabs(target);
  const source = statsOf(tabs);
  const copy = statsOf(restored);
  // A column added by step 3 is expected: compare on the backup's own header width.
  for (const [t, s] of Object.entries(copy)) if (source[t]) s.header = s.header.slice(0, source[t].header.length);
  return { target: targetId, tabsWritten, rowsWritten, verify: verifyStats(copy, source) };
}
