import { describe, expect, it } from "vitest";
import { GoogleSheetsRepository } from "./repository";
import { StorageError } from "../repository";
import type { SheetsClient } from "./client";
import { DOMAINS, columnsOf } from "../schema/tables";

/** Stub client: answers the revisions range and one table, then starts returning 429 on demand. */
function stub() {
  let quota = false;
  let calls = 0;
  const header = columnsOf("Ideas");
  const client = {
    async batchGet(ranges: string[]) {
      calls++;
      if (quota) throw new StorageError("Google Sheets returned 429: Quota exceeded", 429, true);
      return ranges.map((r) => (r.startsWith("'_Revisions'") || r.includes("Revisions") ? [["domain", "token", "at"], ...DOMAINS.map((d) => [d, "t1", ""])] : [header]));
    },
  } as unknown as SheetsClient;
  return { client, setQuota: (q: boolean) => { quota = q; }, calls: () => calls };
}

describe("Sheets read quota (429)", () => {
  it("serves cached rows and revision tokens instead of failing while Google refuses reads", async () => {
    const s = stub();
    const repo = new GoogleSheetsRepository(s.client, { revisionsTtlMs: 0, tableTtlMs: 0 });
    const first = await repo.list("Ideas");
    s.setQuota(true);
    const again = await repo.list("Ideas");
    expect(again.rows).toEqual(first.rows);
  });

  it("still reports the error when nothing is cached yet", async () => {
    const s = stub();
    s.setQuota(true);
    const repo = new GoogleSheetsRepository(s.client);
    await expect(repo.list("Ideas")).rejects.toThrow(/429/);
  });
});
