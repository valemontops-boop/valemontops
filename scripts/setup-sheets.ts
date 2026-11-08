import { GoogleSheetsRepository } from "../src/data/sheets/repository";
import { setupSpreadsheet } from "../src/data/sheets/setup";
import { seedBaseline } from "../src/server/services/baseline";
import { clientFromEnv, fail } from "./_client";

async function main() {
  const { client, target, serviceEmail } = clientFromEnv();
  console.log(`Preparing tabs on ${target}…`);
  try {
    const meta = await client.getMeta();
    console.log(`✓ Found “${meta.properties.title}”`);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 403) fail(`Permission denied. Share the Sheet with ${serviceEmail ?? "the service account"} as Editor.`);
    if (status === 404) fail("Spreadsheet not found. Check SHEETS_SPREADSHEET_ID (setup never creates the Sheet: a founder creates it).");
    fail((e as Error).message);
  }
  const report = await setupSpreadsheet(client);
  console.log(`✓ Tabs created: ${report.created.length ? report.created.join(", ") : "none (already present)"}`);
  if (report.headersWritten.length) console.log(`✓ Headers written: ${report.headersWritten.join(", ")}`);
  for (const c of report.columnsAdded) console.log(`✓ ${c.tab}: added columns ${c.columns.join(", ")}`);
  if (report.protectedTabs.length) console.log(`✓ Warning-only protection added on ${report.protectedTabs.length} tabs`);
  const added = await seedBaseline(new GoogleSheetsRepository(client), {
    theo: process.env.FOUNDER_THEO_TIMEZONE || "Europe/Paris",
    pablo: process.env.FOUNDER_PABLO_TIMEZONE || "Europe/Madrid",
  });
  console.log(`✓ Seed rows added: ${Object.keys(added).length ? Object.entries(added).map(([t, n]) => `${t} ${n}`).join(", ") : "none (already seeded, existing values untouched)"}`);
  console.log("Done. Next: npm run doctor:sheets");
}
main().catch((e) => fail((e as Error).message));
