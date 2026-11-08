import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "@/data/sheets/doctor";
import { seedBaseline } from "@/server/services/baseline";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { TEST_SHEET_ID, freshSheetsRepo, makeClient, startFake } from "../helpers";

let fake: FakeSheetsServer;
afterEach(async () => fake?.stop());

describe("doctor:sheets", () => {
  it("passes on a freshly set-up Sheet and cleans its test row", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
    const checks = await runDoctor(makeClient(env.url));
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.find((c) => c.name === "Read/write round-trip")?.status).toBe("ok");
    expect(fake.sheet(TEST_SHEET_ID, "_Doctor")!.grid[1].every((c) => c === "")).toBe(true);
  });

  it("reports missing tabs, edited headers, duplicates and orphans without crashing", async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    const grid = fake.sheet(TEST_SHEET_ID, "Contacts")!.grid;
    const h = grid[0] as string[];
    const row = h.map((c) => (c === "id" ? "11111111-1111-4111-8111-111111111111" : c === "account_id" ? "22222222-2222-4222-8222-222222222222" : c === "version" ? "1" : c.endsWith("_at") && c !== "retention_review_at" ? "2026-11-09T10:00:00.000Z" : c === "contact_type" ? "consumer" : c === "consent_status" ? "unknown" : c === "is_decision_maker" || c === "is_archived" ? "FALSE" : ""));
    grid.push(row, [...row]);
    (fake.sheet(TEST_SHEET_ID, "Accounts")!.grid[0] as string[])[3] = "renamed by hand";
    const checks = await runDoctor(makeClient(env.url));
    const by = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(by.Headers.status).toBe("fail");
    expect(by["Duplicate ids"].status).toBe("warn");
    expect(by.References.detail).toMatch(/Contact 1111/);
  });

  it("fails clearly when the spreadsheet is missing", async () => {
    const env = await startFake();
    fake = env.fake;
    fake.books.delete(TEST_SHEET_ID);
    const checks = await runDoctor(makeClient(env.url));
    expect(checks[0]).toMatchObject({ name: "Access", status: "fail" });
    expect(checks[0].detail).toMatch(/SHEETS_SPREADSHEET_ID/);
  });
});
