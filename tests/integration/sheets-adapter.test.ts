import { afterEach, describe, expect, it } from "vitest";
import { StorageError } from "@/data/repository";
import { setupSpreadsheet } from "@/data/sheets/setup";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { TEST_SHEET_ID, freshSheetsRepo, makeClient, makeRepo, uuid } from "../helpers";

let fake: FakeSheetsServer;
afterEach(async () => fake?.stop());

const acc = (p: Record<string, unknown> = {}) => ({
  id: uuid(), name: "Garage Test", sector: "", niche: "", country: "ES" as const, city: "", website: "", domain_normalized: "",
  phone: "", email: "", linkedin_url: "", lead_source: "", lead_type: null, brand: "local" as const, owner_founder: null,
  lead_status: "new" as const, observed_problem: "", problem_evidence: "", language: "", notes: "", import_batch_id: "", ...p,
});

describe("Sheets adapter against the fake server", () => {
  it("stores user strings as text with RAW (scenario 15) — USER_ENTERED would corrupt them", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const a = acc({ phone: "+33612345678", notes: "=SUM(A1)", observed_problem: "-12.00" });
    await env.repo.insert("Accounts", [a], { founder: "theo" });
    const grid = fake.sheet(TEST_SHEET_ID, "Accounts")!.grid;
    const header = grid[0] as string[];
    const row = grid[1];
    expect(row[header.indexOf("phone")]).toBe("+33612345678");
    expect(typeof row[header.indexOf("phone")]).toBe("string");
    expect(row[header.indexOf("notes")]).toBe("=SUM(A1)");
    expect(row[header.indexOf("observed_problem")]).toBe("-12.00");
    // Prove the fake models the danger RAW avoids:
    await makeClient(env.url).update("'_Doctor'!A5:B5", [["+33612345678", "=SUM(A1)"]]);
    expect(fake.sheet(TEST_SHEET_ID, "_Doctor")!.grid[4]).toEqual(["+33612345678", "=SUM(A1)"]);
  });

  it("retries 429 with backoff and succeeds", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const sleeps: number[] = [];
    const repo = makeRepo(env.url, { sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 100, random: () => 0.5 });
    fake.faults.push({ status: 429, times: 2, method: "GET" });
    const res = await repo.list("Accounts");
    expect(res.rows).toEqual([]);
    expect(sleeps).toEqual([75, 150]); // exponential with jitter: cap/2 + rand*cap/2
    expect(repo.stats().retries).toBe(2);
  });

  it("surfaces 5xx exhaustion as a StorageError (UI shows Error: retry) and writes nothing", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    fake.faults.push({ status: 503, times: 99, method: "POST", pathIncludes: ":append" });
    const err = await env.repo.insert("Accounts", [acc()], { founder: "theo" }).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).status).toBe(503);
    fake.faults = [];
    expect((await makeRepo(env.url).list("Accounts", { fresh: true })).rows).toHaveLength(0);
  });

  it("does not retry non-retryable errors", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    fake.faults.push({ status: 403, times: 5 });
    const repo = makeRepo(env.url);
    await expect(repo.list("Accounts", { fresh: true })).rejects.toBeInstanceOf(StorageError);
    expect(repo.stats().retries).toBe(0);
  });

  it("resolves rows by id, not position, when a human sorts the tab", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const a = acc({ name: "A" });
    const b = acc({ name: "B" });
    await env.repo.insert("Accounts", [a, b], { founder: "theo" });
    const grid = fake.sheet(TEST_SHEET_ID, "Accounts")!.grid;
    [grid[1], grid[2]] = [grid[2], grid[1]];
    await env.repo.update("Accounts", a.id, 1, { city: "Madrid" }, { founder: "pablo" });
    const rows = (await makeRepo(env.url).list("Accounts", { fresh: true })).rows;
    expect(rows.find((r) => r.id === a.id)?.city).toBe("Madrid");
    expect(rows.find((r) => r.id === b.id)?.city).toBe("");
  });

  it("reads columns by header name after columns are moved and warns on malformed rows", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const a = acc({ name: "Moved" });
    await env.repo.insert("Accounts", [a], { founder: "theo" });
    const grid = fake.sheet(TEST_SHEET_ID, "Accounts")!.grid;
    for (const row of grid) [row[1], row[7]] = [row[7], row[1]];
    grid.push(["not-a-uuid", "x"]);
    const res = await makeRepo(env.url).list("Accounts", { fresh: true });
    expect(res.rows.map((r) => r.name)).toEqual(["Moved"]);
    expect(res.warnings.some((w) => w.kind === "malformed_row")).toBe(true);
  });

  it("de-duplicates a retried append by id", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const a = acc();
    await env.repo.insert("Accounts", [a], { founder: "theo" });
    const grid = fake.sheet(TEST_SHEET_ID, "Accounts")!.grid;
    grid.push([...grid[1]]);
    const res = await makeRepo(env.url).list("Accounts", { fresh: true });
    expect(res.rows).toHaveLength(1);
    expect(res.warnings.map((w) => w.kind)).toContain("duplicate_id");
  });

  it("polls a single small range: revisions are cached and tables refetch only on token change", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const repo = makeRepo(env.url);
    await repo.list("Accounts");
    const before = fake.requestLog.length;
    await repo.list("Accounts"); // revision read only (TTL 0 in tests), no table read
    const reads = fake.requestLog.slice(before).filter((r) => r.path.endsWith("values:batchGet"));
    expect(reads).toHaveLength(1);
  });

  it("setup is idempotent and never overwrites data", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const a = acc();
    await env.repo.insert("Accounts", [a], { founder: "theo" });
    const report = await setupSpreadsheet(makeClient(env.url));
    expect(report.created).toEqual([]);
    expect(report.headersWritten).toEqual([]);
    expect(report.protectedTabs).toEqual([]);
    expect((await makeRepo(env.url).list("Accounts", { fresh: true })).rows).toHaveLength(1);
    const sheet = fake.sheet(TEST_SHEET_ID, "Accounts")!;
    expect(sheet.frozenRowCount).toBe(1);
    expect(sheet.protectedRanges[0].warningOnly).toBe(true);
  });

  it("detects a lost write via write_id confirmation (residual race window)", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const a = acc();
    await env.repo.insert("Accounts", [a], { founder: "theo" });
    const sheet = fake.sheet(TEST_SHEET_ID, "Accounts")!;
    fake.afterPut = () => {
      const h = sheet.grid[0] as string[];
      sheet.grid[1][h.indexOf("write_id")] = "another-writer";
      sheet.grid[1][h.indexOf("city")] = "Sevilla";
      fake.afterPut = null;
    };
    const err = await makeRepo(env.url).update("Accounts", a.id, 1, { city: "Lyon" }, { founder: "theo" }).catch((e) => e);
    expect((err as { code?: string }).code).toBe("conflict");
    expect((err as { current?: { city?: string } }).current?.city).toBe("Sevilla");
  });
});
