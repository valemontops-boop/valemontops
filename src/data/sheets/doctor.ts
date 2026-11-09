import { randomUUID } from "node:crypto";
import { DOCTOR_TAB, REVISIONS_TAB, SCHEMA_VERSION, TABLE_NAMES, columnsOf, type TableName } from "../schema/tables";
import { quoteSheet } from "./a1";
import type { SheetsClient } from "./client";
import { GoogleSheetsRepository } from "./repository";
import { schemaHash } from "./setup";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

const CELL_LIMIT = 10_000_000;

/** `npm run doctor:sheets`: permissions, tabs, schema, integrity, quota, and a safe round-trip. */
export async function runDoctor(client: SheetsClient): Promise<DoctorCheck[]> {
  const out: DoctorCheck[] = [];
  const add = (name: string, status: DoctorCheck["status"], detail: string) => out.push({ name, status, detail });

  let meta;
  try {
    meta = await client.getMeta();
    add("Access", "ok", `Spreadsheet “${meta.properties.title}” is reachable with the service account.`);
  } catch (e) {
    const status = (e as { status?: number }).status;
    add("Access", "fail", status === 403 ? "Permission denied: share the Sheet with the service account email as Editor." : status === 404 ? "Spreadsheet not found: check SHEETS_SPREADSHEET_ID." : (e as Error).message);
    return out;
  }
  const titles = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = [...TABLE_NAMES, REVISIONS_TAB, DOCTOR_TAB].filter((t) => !titles.has(t));
  add("Tabs", missing.length ? "fail" : "ok", missing.length ? `Missing tabs: ${missing.join(", ")}. Run npm run setup:sheets.` : `All ${TABLE_NAMES.length + 2} tabs present.`);
  if (missing.length) return out;

  const headers = await client.batchGet(TABLE_NAMES.map((t) => `${quoteSheet(t)}!1:1`));
  const headerIssues: string[] = [];
  TABLE_NAMES.forEach((t, i) => {
    const h = (headers[i][0] ?? []).map(String);
    const miss = columnsOf(t).filter((c) => !h.includes(c));
    const moved = columnsOf(t).filter((c, idx) => h.includes(c) && h.indexOf(c) !== idx);
    if (miss.length) headerIssues.push(`${t}: missing ${miss.join(", ")}`);
    else if (moved.length) headerIssues.push(`${t}: columns moved (${moved.slice(0, 3).join(", ")}…), still readable by header name`);
  });
  add("Headers", headerIssues.some((x) => x.includes("missing")) ? "fail" : headerIssues.length ? "warn" : "ok", headerIssues.join("; ") || "All headers match the schema.");

  const repo = new GoogleSheetsRepository(client, { revisionsTtlMs: 0 });
  const all = await repo.listMany(TABLE_NAMES, { fresh: true });
  const mig = all.SchemaMigrations.rows.find((r) => r.schema_version === SCHEMA_VERSION && r.schema_hash === schemaHash());
  add("Schema version", mig ? "ok" : "warn", mig ? `v${SCHEMA_VERSION} (${schemaHash()})` : `No migration row for v${SCHEMA_VERSION} ${schemaHash()}. Run npm run setup:sheets.`);

  const warnings = TABLE_NAMES.flatMap((t) => all[t].warnings);
  const malformed = warnings.filter((w) => w.kind === "malformed_row");
  const dupIds = warnings.filter((w) => w.kind === "duplicate_id");
  add("Malformed rows", malformed.length ? "warn" : "ok", malformed.length ? malformed.slice(0, 10).map((w) => `${w.table} row ${w.rowNumber}: ${w.detail}`).join("; ") : "None.");
  add("Duplicate ids", dupIds.length ? "warn" : "ok", dupIds.length ? dupIds.slice(0, 10).map((w) => `${w.table} row ${w.rowNumber}`).join("; ") + " (readers keep one; harmless but worth cleaning)" : "None.");

  const keys = new Map<string, number>();
  for (const e of all.ActivityEvents.rows) keys.set(e.idempotency_key, (keys.get(e.idempotency_key) ?? 0) + 1);
  const dupKeys = [...keys.values()].filter((n) => n > 1).length;
  add("Duplicate activity rows", dupKeys ? "warn" : "ok", dupKeys ? `${dupKeys} idempotency keys appear more than once (each counts once).` : "None.");

  const ids = (t: TableName) => new Set(all[t].rows.map((r) => r.id));
  const accounts = ids("Accounts");
  const opps = ids("Opportunities");
  const orphans: string[] = [];
  for (const c of all.Contacts.rows) if (c.account_id && !accounts.has(c.account_id)) orphans.push(`Contact ${c.id}`);
  for (const o of all.Opportunities.rows) if (!accounts.has(o.account_id)) orphans.push(`Opportunity ${o.id}`);
  for (const e of all.ActivityEvents.rows) {
    if (e.account_id && !accounts.has(e.account_id)) orphans.push(`Activity ${e.id} → account`);
    if (e.opportunity_id && !opps.has(e.opportunity_id)) orphans.push(`Activity ${e.id} → opportunity`);
  }
  for (const s of all.OpportunityStageEvents.rows) if (!opps.has(s.opportunity_id)) orphans.push(`Stage event ${s.id}`);
  add("References", orphans.length ? "warn" : "ok", orphans.length ? `${orphans.length} missing references, e.g. ${orphans.slice(0, 5).join("; ")}` : "No orphans.");

  const cells = meta.sheets.reduce((n, s) => n + (s.properties.gridProperties?.rowCount ?? 0) * (s.properties.gridProperties?.columnCount ?? 0), 0);
  add("Size", cells > CELL_LIMIT * 0.7 ? "warn" : "ok", `${cells.toLocaleString("en")} grid cells of ${CELL_LIMIT.toLocaleString("en")} (${((cells / CELL_LIMIT) * 100).toFixed(2)}%). ActivityEvents rows: ${all.ActivityEvents.rows.length}.`);

  // Round-trip on the dedicated _Doctor tab with an explicit marker, cleaned up afterwards.
  const marker = `doctor-${randomUUID()}`;
  const probe = [marker, "+33612345678|=SUM(A1)|-12.00", new Date().toISOString()];
  try {
    await client.update(`${quoteSheet(DOCTOR_TAB)}!A2:C2`, [probe]);
    const [back] = await client.batchGet([`${quoteSheet(DOCTOR_TAB)}!A2:C2`]);
    const ok = String(back[0]?.[0]) === marker && String(back[0]?.[1]) === probe[1];
    add("Read/write round-trip", ok ? "ok" : "fail", ok ? "Wrote and read back a marked test row; special values survived unchanged." : "Values changed on round-trip: check valueInputOption.");
  } catch (e) {
    add("Read/write round-trip", "fail", (e as Error).message);
  } finally {
    await client.clear(`${quoteSheet(DOCTOR_TAB)}!A2:C2`).catch(() => undefined);
  }
  const s = client.stats;
  add("Quota use (this run)", "ok", `${s.requests} requests, ${s.retries} retries, ${s.errors} errors. Budget: 60/min per user (the service account is shared by both founders).`);
  return out;
}
