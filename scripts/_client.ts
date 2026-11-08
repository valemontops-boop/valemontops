import { decodeServiceAccountKey, serviceAccountTokenProvider } from "../src/data/sheets/auth";
import { SheetsClient } from "../src/data/sheets/client";

/** Builds a Sheets client from env only (no Claude account, no connector): spec 3.15. */
export function clientFromEnv(): { client: SheetsClient; target: string; serviceEmail: string | null } {
  const id = process.env.SHEETS_SPREADSHEET_ID;
  const base = (process.env.SHEETS_API_BASE_URL || "https://sheets.googleapis.com").replace(/\/$/, "");
  const isFake = base !== "https://sheets.googleapis.com";
  if (!id) fail("SHEETS_SPREADSHEET_ID is not set.");
  if (isFake) {
    return { client: new SheetsClient({ baseUrl: base, spreadsheetId: id!, getToken: async () => "fake-token" }), target: `fake server ${base}`, serviceEmail: null };
  }
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!b64) fail("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not set.");
  const key = decodeServiceAccountKey(b64!);
  return { client: new SheetsClient({ baseUrl: base, spreadsheetId: id!, getToken: serviceAccountTokenProvider(key) }), target: "Google Sheets", serviceEmail: key.client_email };
}

export function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
