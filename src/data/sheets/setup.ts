import { createHash, randomUUID } from "node:crypto";
import { DOCTOR_TAB, DOMAINS, REVISIONS_TAB, SCHEMA_VERSION, TABLE_NAMES, columnsOf } from "../schema/tables";
import { colLetters, quoteSheet } from "./a1";
import type { SheetsClient } from "./client";

export function schemaHash(): string {
  const def = Object.fromEntries(TABLE_NAMES.map((t) => [t, columnsOf(t)]));
  return createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 16);
}

const SYSTEM_TABS: Record<string, string[]> = {
  [REVISIONS_TAB]: ["domain", "token", "updated_at"],
  [DOCTOR_TAB]: ["marker", "value", "written_at"],
};

export interface SetupReport {
  created: string[];
  headersWritten: string[];
  columnsAdded: { tab: string; columns: string[] }[];
  protectedTabs: string[];
  revisionsSeeded: string[];
}

/**
 * Idempotent: creates missing tabs and headers, appends missing columns at the right edge,
 * freezes header rows, adds warning-only protection. NEVER creates the spreadsheet (spec 4.8)
 * and never overwrites data.
 */
export async function setupSpreadsheet(client: SheetsClient): Promise<SetupReport> {
  const report: SetupReport = { created: [], headersWritten: [], columnsAdded: [], protectedTabs: [], revisionsSeeded: [] };
  const wanted: Record<string, string[]> = { ...SYSTEM_TABS };
  for (const t of TABLE_NAMES) wanted[t] = columnsOf(t);

  let meta = await client.getMeta();
  const existing = new Set(meta.sheets.map((s) => s.properties.title));
  const toCreate = Object.keys(wanted).filter((t) => !existing.has(t));
  if (toCreate.length) {
    await client.batchUpdate(
      toCreate.map((title) => ({
        addSheet: { properties: { title, gridProperties: { rowCount: 2, columnCount: wanted[title].length, frozenRowCount: 1 } } },
      })),
    );
    report.created.push(...toCreate);
    meta = await client.getMeta();
  }

  const titles = Object.keys(wanted);
  const headers = await client.batchGet(titles.map((t) => `${quoteSheet(t)}!1:1`));
  for (let i = 0; i < titles.length; i++) {
    const tab = titles[i];
    const header = (headers[i][0] ?? []).map((h) => String(h ?? "").trim());
    if (header.length === 0) {
      await client.update(`${quoteSheet(tab)}!A1:${colLetters(wanted[tab].length - 1)}1`, [wanted[tab]]);
      report.headersWritten.push(tab);
      continue;
    }
    const missing = wanted[tab].filter((c) => !header.includes(c));
    if (missing.length) {
      const start = header.length;
      await client.update(`${quoteSheet(tab)}!${colLetters(start)}1:${colLetters(start + missing.length - 1)}1`, [missing]);
      report.columnsAdded.push({ tab, columns: missing });
    }
  }

  const structural: unknown[] = [];
  for (const s of meta.sheets) {
    if (!(s.properties.title in wanted)) continue;
    if ((s.properties.gridProperties?.frozenRowCount ?? 0) < 1) {
      structural.push({
        updateSheetProperties: { properties: { sheetId: s.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" },
      });
    }
    if (!s.protectedRanges || s.protectedRanges.length === 0) {
      structural.push({
        addProtectedRange: {
          protectedRange: {
            range: { sheetId: s.properties.sheetId },
            warningOnly: true,
            description: "Managed by Valemont OS. Edit through the app; manual edits can break rows.",
          },
        },
      });
      report.protectedTabs.push(s.properties.title);
    }
    structural.push({
      repeatCell: {
        range: { sheetId: s.properties.sheetId },
        cell: { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    });
  }
  if (structural.length) await client.batchUpdate(structural);

  const [revs] = await client.batchGet([`${quoteSheet(REVISIONS_TAB)}!A1:A${DOMAINS.length + 10}`]);
  const present = new Set(revs.slice(1).map((r) => String(r[0] ?? "")));
  const missingDomains = DOMAINS.filter((d) => !present.has(d));
  if (missingDomains.length) {
    await client.append(
      `${quoteSheet(REVISIONS_TAB)}!A1`,
      missingDomains.map((d) => [d, randomUUID(), new Date().toISOString()]),
    );
    report.revisionsSeeded.push(...missingDomains);
  }
  return report;
}

export { SCHEMA_VERSION };
