import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeGoogleServer } from "@/fake-google/server";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { GoogleHttp } from "@/data/google/http";
import { GoogleBackupDrive } from "@/data/google/backup-drive";
import { readAllTabs, restoreInto, RestoreRefusedError } from "@/data/sheets/backup";
import type { DataRepository } from "@/data/repository";
import { backupName, isBundle, statsOf } from "@/domain/backup";
import type { AppContext } from "@/server/context";
import { backupStatus, exportBundle, maybeBackup, resetBackupLocks, runBackup, verifyBackup, QUOTA_ERROR, type BackupEnv } from "@/server/services/backups";
import { seedBaseline } from "@/server/services/baseline";
import { newId } from "@/lib/ids";
import { columnsOf } from "@/data/schema/tables";
import { LEAD_STATUSES } from "@/domain/constants";
import { TEST_SHEET_ID, freshSheetsRepo, makeClient, makeRepo } from "../helpers";

/**
 * Stage 4B backups (D084) on the fake Sheets + fake Drive servers: Drive copy by the service account, verification,
 * once per day (lock + lease + done row), retention, the quota error of personal accounts, and restore round-trips
 * into a NEW spreadsheet (from the Drive copy and from the JSON bundle), never over the live one.
 */
const FOLDER = "backups-folder-001";

describe("backups with tested restore (D084)", () => {
  let fake: FakeSheetsServer;
  let url: string;
  let repo: DataRepository;
  let google: FakeGoogleServer;
  let ctx: AppContext;

  const env = (over: Partial<BackupEnv> = {}): BackupEnv => ({
    sourceId: TEST_SHEET_ID,
    clientFor: (id) => makeClient(url, { spreadsheetId: id }),
    drive: new GoogleBackupDrive(new GoogleHttp(google.url, async () => "sa-token", { maxRetries: 1, baseDelayMs: 1, sleep: async () => undefined })),
    folderId: FOLDER,
    retentionDays: 30,
    ...over,
  });

  beforeEach(async () => {
    ({ fake, url, repo } = await freshSheetsRepo());
    await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
    // Values that must survive a backup and a restore unchanged (scenario 15).
    const blank = Object.fromEntries(columnsOf("Accounts").map((c) => [c, ""]));
    await repo.insert("Accounts", [{ ...blank, id: newId(), name: "=SUM(A1)", city: "Lyon", phone: "+33612345678", lead_status: LEAD_STATUSES[0], notes: "-12.00" } as never], { founder: "theo" });
    google = new FakeGoogleServer();
    await google.start();
    google.copySpreadsheet = (src, id, name) => fake.copyBook(src, id, name);
    google.store.sharedDriveFolders.add(FOLDER);
    resetBackupLocks();
    ctx = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "https://app.example.com", mode: "live", backup: env() };
  });
  afterEach(async () => {
    await fake.stop();
    await google.stop();
  });

  it("copies the live spreadsheet into the backups folder, verifies it, and runs once per day", async () => {
    const now = new Date("2026-11-09T07:00:00Z");
    const r = await runBackup(ctx, { trigger: "scheduler", now });
    expect(r).toMatchObject({ status: "done", day: "2026-11-09", verify: "ok" });
    if (r.status !== "done") throw new Error("unreachable");
    expect(r.tabs).toBeGreaterThan(20);
    const file = google.store.files.find((f) => f.id === r.file_id)!;
    expect(file).toMatchObject({ name: backupName("2026-11-09"), parents: [FOLDER], owner: "service-account" });
    // Same tabs and rows as live.
    // (The run's own "done" row and integration status are written to live after the copy.)
    const without = (x: ReturnType<typeof statsOf>) => Object.fromEntries(Object.entries(x).filter(([t]) => t !== "BackupRuns" && t !== "IntegrationStatuses"));
    expect(without(statsOf(await readAllTabs(makeClient(url, { spreadsheetId: r.file_id }))))).toEqual(without(statsOf(await readAllTabs(makeClient(url)))));
    // A repeat the same day (another trigger, another instance after the lock) is a no-op.
    expect(await runBackup(ctx, { trigger: "first_request", now: new Date("2026-11-09T18:00:00Z") })).toEqual({ status: "skipped", day: "2026-11-09" });
    expect(google.store.writes.filter((w) => w.kind === "drive.copy")).toHaveLength(1);
    const st = await backupStatus(ctx);
    expect(st.lastDone).toMatchObject({ day: "2026-11-09", verify: "ok", file_id: r.file_id });
  });

  it("two concurrent triggers in one process make one copy (in-process lock)", async () => {
    const now = new Date("2026-11-10T07:00:00Z");
    const [a, b] = await Promise.all([runBackup(ctx, { trigger: "scheduler", now }), maybeBackup(ctx, now)]);
    expect(a).toBe(await b);
    expect(google.store.writes.filter((w) => w.kind === "drive.copy")).toHaveLength(1);
  });

  it("a second server instance that loses the lease does not copy (first writer wins)", async () => {
    const now = new Date("2026-11-11T07:00:00Z");
    const other: AppContext = { ...ctx, repo: makeRepo(url) };
    const first = runBackup(ctx, { trigger: "scheduler", now });
    resetBackupLocks(); // the other instance has its own memory
    const second = await runBackup(other, { trigger: "first_request", now });
    expect(["busy", "skipped", "done"]).toContain(second.status);
    await first;
    expect(google.store.writes.filter((w) => w.kind === "drive.copy")).toHaveLength(1);
  });

  it("a personal Google account (no Shared Drive) gives a clear error, nothing is closed, the next trigger retries", async () => {
    google.store.sharedDriveFolders.clear();
    const now = new Date("2026-11-12T07:00:00Z");
    const r = await runBackup(ctx, { trigger: "scheduler", now });
    expect(r).toMatchObject({ status: "error", error: QUOTA_ERROR });
    google.store.sharedDriveFolders.add(FOLDER);
    expect(await runBackup(ctx, { trigger: "scheduler", now: new Date("2026-11-12T08:00:00Z") })).toMatchObject({ status: "done" });
  });

  it("a 5xx from Drive on copy is an error row, never a silent success", async () => {
    google.faults.push({ status: 503, times: 5, pathIncludes: "/copy" });
    const r = await runBackup(ctx, { trigger: "founder", now: new Date("2026-11-13T07:00:00Z") });
    expect(r.status).toBe("error");
    const st = await backupStatus(ctx);
    expect(st.runs[0]).toMatchObject({ status: "error" });
    expect(st.lastDone).toBeNull();
  });

  it("retention trashes copies older than N days, keeps recent ones and foreign files", async () => {
    for (const [id, day] of [["old1", "2026-09-01"], ["old2", "2026-10-01"], ["recent", "2026-11-01"]]) google.store.addFile({ id, name: backupName(day), parents: [FOLDER], mimeType: "application/vnd.google-apps.spreadsheet" });
    google.store.addFile({ id: "foreign", name: "Notes 2020-01-01", parents: [FOLDER] });
    const r = await runBackup(ctx, { trigger: "scheduler", now: new Date("2026-11-09T07:00:00Z") });
    expect(r).toMatchObject({ status: "done", deleted: 2 });
    const left = google.store.files.filter((f) => f.parents.includes(FOLDER) && !f.trashed).map((f) => f.id);
    expect(left).toEqual(expect.arrayContaining(["recent", "foreign"]));
    expect(left).not.toContain("old1");
  });

  it("verify: a backup against live after new writes reports newer rows, refuses foreign files", async () => {
    const r = await runBackup(ctx, { trigger: "scheduler", now: new Date("2026-11-09T07:00:00Z") });
    if (r.status !== "done") throw new Error(r.status);
    await repo.insert("Tasks", [{ id: newId(), title: "Nouvelle tâche", description: "", owner: "theo", created_by_founder: "theo", account_id: "", opportunity_id: "", project_id: "", client_id: "", priority: "P2", status: "todo", estimated_minutes: null, due_at: null, recurrence: "none", recurrence_parent_id: "", dependency_ids: [], completion_evidence: "", completed_at: null, visibility: "team", snoozed_until: null, snooze_reason: "", source: "manual", source_id: "" } as never], { founder: "theo" });
    const v = await verifyBackup(ctx, { file_id: r.file_id });
    expect(v.ok).toBe(true);
    expect(v.newerRows).toBeGreaterThanOrEqual(1); // the new task (+ the run's own done/status rows)
    google.store.addFile({ id: "foreign-file", name: "Budget", parents: [FOLDER] });
    await expect(verifyBackup(ctx, { file_id: "foreign-file" })).rejects.toThrow(/not a backup/);
  });

  it("restore round-trip: Drive copy → NEW empty spreadsheet → same tabs, rows and values", async () => {
    const r = await runBackup(ctx, { trigger: "scheduler", now: new Date("2026-11-09T07:00:00Z") });
    if (r.status !== "done") throw new Error(r.status);
    fake.createSpreadsheet("restored-sheet", "Valemont OS — restored");
    const report = await restoreInto(makeClient(url, { spreadsheetId: "restored-sheet" }), "restored-sheet", await readAllTabs(makeClient(url, { spreadsheetId: r.file_id })), { liveId: TEST_SHEET_ID });
    expect(report.verify).toMatchObject({ ok: true });
    // The app pointed at the restored spreadsheet reads the same data (SHEETS_SPREADSHEET_ID switch).
    const restored = makeRepo(url, { spreadsheetId: "restored-sheet" });
    const [a, b] = await Promise.all([repo.list("Accounts", { fresh: true }), restored.list("Accounts", { fresh: true })]);
    expect(b.rows).toEqual(a.rows);
    expect(b.warnings).toEqual([]);
    const acc = b.rows.find((x) => x.phone === "+33612345678")!;
    expect(acc).toMatchObject({ name: "=SUM(A1)", notes: "-12.00" });
    expect((await restored.list("Users")).rows.length).toBe((await repo.list("Users")).rows.length);
  });

  it("restore round-trip from the JSON bundle", async () => {
    const b = await exportBundle(ctx, new Date("2026-11-09T07:00:00Z"));
    expect(b.filename).toBe("valemont-os-backup-2026-11-09.json");
    const bundle: unknown = JSON.parse(b.body);
    if (!isBundle(bundle)) throw new Error("not a bundle");
    expect(Object.keys(bundle.tabs)).toContain("Accounts");
    fake.createSpreadsheet("restored-from-json", "Valemont OS — restored");
    const report = await restoreInto(makeClient(url, { spreadsheetId: "restored-from-json" }), "restored-from-json", bundle.tabs, { liveId: TEST_SHEET_ID });
    expect(report.verify.ok).toBe(true);
    const restored = makeRepo(url, { spreadsheetId: "restored-from-json" });
    expect((await restored.list("Accounts")).rows).toEqual((await repo.list("Accounts", { fresh: true })).rows);
  });

  it("restore never overwrites: the live spreadsheet and a non-empty target are refused", async () => {
    const tabs = await readAllTabs(makeClient(url));
    await expect(restoreInto(makeClient(url), TEST_SHEET_ID, tabs, { liveId: TEST_SHEET_ID })).rejects.toBeInstanceOf(RestoreRefusedError);
    fake.createSpreadsheet("used-sheet", "Someone's sheet");
    await restoreInto(makeClient(url, { spreadsheetId: "used-sheet" }), "used-sheet", tabs, { liveId: TEST_SHEET_ID });
    await expect(restoreInto(makeClient(url, { spreadsheetId: "used-sheet" }), "used-sheet", tabs, { liveId: TEST_SHEET_ID })).rejects.toThrow(/already holds data/);
  });

  it("DEMO and missing folder: nothing is copied", async () => {
    expect(await runBackup({ ...ctx, mode: "demo" }, { trigger: "founder" })).toEqual({ status: "not_configured" });
    expect(await runBackup({ ...ctx, backup: env({ drive: null, folderId: "" }) }, { trigger: "founder" })).toEqual({ status: "not_configured" });
    expect(maybeBackup({ ...ctx, mode: "demo" })).toBeNull();
    expect(google.store.writes).toEqual([]);
  });
});
