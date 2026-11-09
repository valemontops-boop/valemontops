import { defineConfig } from "@playwright/test";

const PORT = 3100;
const FAKE = 4012;
const DATA = `.data/e2e-fake-sheets-${Date.now()}.json`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  webServer: [
    {
      command: `npx tsx scripts/fake-sheets.ts`,
      env: { FAKE_SHEETS_PORT: String(FAKE), FAKE_SHEETS_PERSIST: DATA, FAKE_SHEETS_SPREADSHEET_ID: "e2e-spreadsheet" },
      url: `http://127.0.0.1:${FAKE}/__fake/health`,
      reuseExistingServer: false,
    },
    {
      // Production build in DEMO mode, data on the fake Sheets server through the real Sheets adapter.
      command: `npx next start -p ${PORT}`,
      env: {
        APP_MODE: "demo",
        DEMO_BACKEND: "fake-sheets",
        FAKE_SHEETS_URL: `http://127.0.0.1:${FAKE}`,
        FAKE_SHEETS_SPREADSHEET_ID: "e2e-spreadsheet",
        DEMO_ACCESS_CODE: "e2e-access-code-123",
        SESSION_SECRET: "e2e-session-secret-that-is-long-enough-123456",
        APP_BASE_URL: `http://localhost:${PORT}`,
        SYNC_POLL_SECONDS: "30",
      },
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Scenario 11: LIVE mode with no Google credentials.
      command: `npx next start -p 3200`,
      env: { APP_MODE: "live", SESSION_SECRET: "e2e-live-secret-that-is-long-enough-1234567", APP_BASE_URL: "http://localhost:3200", SHEETS_SPREADSHEET_ID: "", GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: "" },
      url: `http://localhost:3200/setup`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
