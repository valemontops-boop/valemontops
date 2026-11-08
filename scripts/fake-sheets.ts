import fs from "node:fs";
import { FakeSheetsServer } from "../src/fake-sheets/server";

/** Local fake Google Sheets API for DEMO_BACKEND=fake-sheets and manual testing. Never real data. */
async function main() {
  fs.mkdirSync(".data", { recursive: true });
  const port = Number(process.env.FAKE_SHEETS_PORT || 4010);
  const id = process.env.FAKE_SHEETS_SPREADSHEET_ID || "demo-spreadsheet";
  const server = new FakeSheetsServer({ port, persistPath: process.env.FAKE_SHEETS_PERSIST ?? ".data/fake-sheets.json", spreadsheets: { [id]: "Valemont OS — Demo (fake server)" } });
  const url = await server.start();
  console.log(`Fake Sheets API on ${url} (spreadsheet "${id}"). Data persists in .data/. Ctrl+C to stop.`);
}
main();
