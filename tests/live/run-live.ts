/**
 * npm run test:live — runs against a DEDICATED test spreadsheet on the real Google API.
 * Gated by credentials in .env.live-test (never the production Sheet). Prints NOT RUN when absent.
 */
import { randomUUID } from "node:crypto";
import { decodeServiceAccountKey, serviceAccountTokenProvider } from "../../src/data/sheets/auth";
import { SheetsClient } from "../../src/data/sheets/client";
import { GoogleSheetsRepository } from "../../src/data/sheets/repository";
import { setupSpreadsheet } from "../../src/data/sheets/setup";
import { runDoctor } from "../../src/data/sheets/doctor";

async function main() {
  const id = process.env.LIVE_TEST_SPREADSHEET_ID;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!id || !b64) {
    console.log("test:live NOT RUN: set LIVE_TEST_SPREADSHEET_ID and GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 in .env.live-test (use a dedicated test Sheet).");
    return;
  }
  if (id === process.env.SHEETS_SPREADSHEET_ID) throw new Error("LIVE_TEST_SPREADSHEET_ID must not be the production Sheet.");
  const client = new SheetsClient({ baseUrl: "https://sheets.googleapis.com", spreadsheetId: id, getToken: serviceAccountTokenProvider(decodeServiceAccountKey(b64)) });
  await setupSpreadsheet(client);
  const repo = new GoogleSheetsRepository(client, { revisionsTtlMs: 0 });
  const rowId = randomUUID();
  await repo.insert("Accounts", [{
    id: rowId, name: "LIVE TEST ROW (safe to archive)", sector: "", niche: "", country: "FR", city: "", website: "", domain_normalized: "",
    phone: "+33612345678", email: "", linkedin_url: "", lead_source: "test:live", lead_type: null, brand: null, owner_founder: null,
    lead_status: "disqualified", observed_problem: "-12.00", problem_evidence: "", language: "", notes: "=SUM(A1)", import_batch_id: "",
  }], { founder: "system" });
  const back = await new GoogleSheetsRepository(client).get("Accounts", rowId, { fresh: true });
  const ok = back?.phone === "+33612345678" && back?.notes === "=SUM(A1)" && back?.observed_problem === "-12.00";
  await repo.update("Accounts", rowId, 1, { is_archived: true }, { founder: "system" });
  const checks = await runDoctor(client);
  for (const c of checks) console.log(`${c.status.toUpperCase()} ${c.name}: ${c.detail}`);
  console.log(ok ? "VERIFIED_LIVE: scenario 15 round-trip on the real API" : "FAILED: values changed on the real API");
  process.exit(ok && !checks.some((c) => c.status === "fail") ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
