import { describe, expect, it } from "vitest";
import { setupSpreadsheet } from "./setup";
import type { SheetsClient } from "./client";
import { columnsOf, TABLE_NAMES } from "../schema/tables";

/** A tab created with exactly its old column count must grow before a new column is written (Google rejects writes past the grid). */
describe("setup grows short tabs before adding columns", () => {
  it("sends appendDimension for Playbook when its grid is one column short", async () => {
    const calls: { kind: string; body: unknown }[] = [];
    const cols = columnsOf("Playbook");
    const sheets = TABLE_NAMES.map((t, i) => ({ properties: { sheetId: i + 1, title: t, gridProperties: { rowCount: 2, columnCount: t === "Playbook" ? cols.length - 1 : columnsOf(t).length + 20, frozenRowCount: 1 } }, protectedRanges: [{}] }));
    const client = {
      getMeta: async () => ({ properties: { title: "x" }, sheets }),
      batchGet: async (ranges: string[]) =>
        ranges.map((r) => {
          const tab = r.replace(/^'?([^'!]+)'?!.*$/, "$1");
          if (tab === "Playbook") return [cols.slice(0, -1)];
          return (TABLE_NAMES as readonly string[]).includes(tab) ? [columnsOf(tab as never)] : [];
        }),
      batchUpdate: async (body: unknown[]) => { calls.push({ kind: "batchUpdate", body }); return {}; },
      updateMany: async (body: unknown) => { calls.push({ kind: "updateMany", body }); },
      append: async () => ({}),
    } as unknown as SheetsClient;
    await setupSpreadsheet(client, "shared");
    const growIdx = calls.findIndex((c) => c.kind === "batchUpdate" && JSON.stringify(c.body).includes("appendDimension"));
    const writeIdx = calls.findIndex((c) => c.kind === "updateMany" && JSON.stringify(c.body).includes("Playbook"));
    expect(growIdx).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(calls[growIdx].body)).toContain('"sheetId":' + (TABLE_NAMES.indexOf("Playbook") + 1));
    expect(writeIdx).toBeGreaterThan(growIdx);
  });
});
