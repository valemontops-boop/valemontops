import { randomUUID } from "node:crypto";
import { FakeSheetsServer } from "@/fake-sheets/server";
import { SheetsClient } from "@/data/sheets/client";
import { GoogleSheetsRepository } from "@/data/sheets/repository";
import { setupSpreadsheet } from "@/data/sheets/setup";

export const TEST_SHEET_ID = "test-spreadsheet";

export async function startFake() {
  const fake = new FakeSheetsServer({ spreadsheets: { [TEST_SHEET_ID]: "Valemont OS — Test Data" } });
  const url = await fake.start();
  return { fake, url };
}

export function makeClient(url: string, overrides: Partial<ConstructorParameters<typeof SheetsClient>[0]> = {}) {
  return new SheetsClient({
    baseUrl: url,
    spreadsheetId: TEST_SHEET_ID,
    getToken: async () => "fake-token",
    sleep: async () => undefined,
    baseDelayMs: 1,
    timeoutMs: 3_000,
    ...overrides,
  });
}

/** A fresh repository instance simulates a page reload or another founder's server instance. */
export function makeRepo(url: string, overrides: Partial<ConstructorParameters<typeof SheetsClient>[0]> = {}) {
  return new GoogleSheetsRepository(makeClient(url, overrides), { revisionsTtlMs: 0 });
}

export async function freshSheetsRepo() {
  const { fake, url } = await startFake();
  await setupSpreadsheet(makeClient(url));
  return { fake, url, repo: makeRepo(url) };
}

export const uuid = () => randomUUID();
