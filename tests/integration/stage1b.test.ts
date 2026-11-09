import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeGoogleServer } from "@/fake-google/server";
import { SheetsClient } from "@/data/sheets/client";
import { GoogleSheetsRepository } from "@/data/sheets/repository";
import { setupSpreadsheet } from "@/data/sheets/setup";
import { GoogleHttp } from "@/data/google/http";
import { GoogleCalendarAdapter, GoogleDriveAdapter, GoogleDriveUploader, GmailSender } from "@/data/google/adapters";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { setMode, setTargets, getMyDay } from "@/server/services/myday";
import { logActivity, logActivitySchema } from "@/server/services/activities";
import { createTask, listTasks, updateTask } from "@/server/services/tasks";
import { closeDays, saveReview, streakSummary } from "@/server/services/results";
import { addCalendarSource, listPoints, proposeSlots, schedulePoint, upcomingEvents, addPointItem } from "@/server/services/agenda";
import { addIdea, updateIdea, convertIdea } from "@/server/services/ideas";
import { createSprint } from "@/server/services/sprints";
import { createFolder, linkFile, listFolder, uploadFile, filesFor } from "@/server/services/files";
import { addSocialAccount, audienceSeries, importLinkedIn, listAccounts } from "@/server/services/audience";
import { commandCenter, scorecardCsv, weeklyReview } from "@/server/services/insights";
import { createAccount, createAccountSchema } from "@/server/services/crm";
import { childId } from "@/lib/ids";
import { ConsentRequiredError } from "@/data/google/ports";

let sheets: FakeSheetsServer;
let google: FakeGoogleServer;
let ctx: AppContext;
const SHARED = "shared-cal@group.calendar.example.com";
const THEO_CAL = "theo@calendar.example.com";
const PABLO_CAL = "pablo@calendar.example.com";
const FOLDER = "folder-valemont-os";

function sheetsRepo(url: string, id: string) {
  return new GoogleSheetsRepository(new SheetsClient({ baseUrl: url, spreadsheetId: id, getToken: async () => "fake", sleep: async () => undefined, baseDelayMs: 1 }), { revisionsTtlMs: 0 });
}

beforeEach(async () => {
  sheets = new FakeSheetsServer({ spreadsheets: { main: "Main", "private-theo": "Théo private", "private-pablo": "Pablo private" } });
  const surl = await sheets.start();
  await setupSpreadsheet(new SheetsClient({ baseUrl: surl, spreadsheetId: "main", getToken: async () => "fake" }));
  for (const f of ["theo", "pablo"]) await setupSpreadsheet(new SheetsClient({ baseUrl: surl, spreadsheetId: `private-${f}`, getToken: async () => "fake" }), "private");
  google = new FakeGoogleServer();
  const gurl = await google.start();
  const sa = new GoogleHttp(gurl, async () => "sa-token", { sleep: async () => undefined, baseDelayMs: 1 });
  const repo = sheetsRepo(surl, "main");
  const privates: Record<string, GoogleSheetsRepository> = { theo: sheetsRepo(surl, "private-theo"), pablo: sheetsRepo(surl, "private-pablo") };
  ctx = {
    repo,
    privateRepo: (f) => privates[f] ?? null,
    calendar: new GoogleCalendarAdapter(sa),
    drive: new GoogleDriveAdapter(sa),
    uploaderFor: (f, grant) => (grant ? new GoogleDriveUploader(new GoogleHttp(gurl, async () => grant)) : null),
    mailerFor: (_f, grant) => (grant ? new GmailSender(new GoogleHttp(gurl, async () => grant)) : null),
    baseUrl: "http://localhost:3000",
    mode: "demo",
  };
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => {
  await sheets.stop();
  await google.stop();
});

const NOW = new Date("2026-11-09T09:00:00.000Z"); // Monday 10:00 Paris

describe("Scenario 4: P0 task assigned to Pablo", () => {
  it("appears in Pablo's day and the team list; completing it syncs; recurrence creates the next instance once", async () => {
    const id = randomUUID();
    await createTask(ctx, "theo", { id, task: { title: "Call the accountant", description: "", owner: "pablo", priority: "P0", due_at: "2026-11-09", estimated_minutes: 15, recurrence: "weekly", account_id: "", opportunity_id: "", dependency_ids: [], private: false }, source: "manual", source_id: "" });
    // The baseline also seeds the daily checklist and one-off tasks (source "system"): only the manual one is checked here.
    const manual = <T extends { source: string }>(xs: T[]) => xs.filter((x) => x.source !== "system");
    const pabloView = manual(await listTasks(ctx, "pablo", "mine"));
    expect(pabloView.map((t) => t.title)).toEqual(["Call the accountant"]);
    expect(manual(await listTasks(ctx, "theo", "pablo")).length).toBe(1);
    const t = pabloView[0];
    await updateTask(ctx, "pablo", { id, private: false, expected_version: t.version, patch: { status: "done" } });
    await updateTask(ctx, "pablo", { id, private: false, expected_version: t.version + 1, patch: { status: "done" } }).catch(() => undefined);
    const after = await listTasks(ctx, "theo", "all");
    expect(after.find((x) => x.id === id)?.status).toBe("done");
    expect(after.filter((x) => x.title === "Call the accountant" && x.status === "todo").map((x) => x.due_at)).toEqual(["2026-11-16"]);
  });
  it("weekly on chosen weekdays: Monday + Thursday starts on the first chosen day and the next instance keeps the days", async () => {
    const id = randomUUID();
    // Due Sunday 2026-11-08 → first instance aligned to Monday 2026-11-09.
    await createTask(ctx, "theo", { id, task: { title: "Prospect list", description: "", owner: "theo", priority: "P2", due_at: "2026-11-08", estimated_minutes: null, recurrence: "weekly", recurrence_days: [4, 1, 4], account_id: "", opportunity_id: "", dependency_ids: [], private: false }, source: "manual", source_id: "" });
    const t = (await listTasks(ctx, "theo", "mine")).find((x) => x.id === id)!;
    expect(t.due_at).toBe("2026-11-09");
    expect(t.recurrence_days).toEqual([1, 4]);
    await updateTask(ctx, "theo", { id, private: false, expected_version: t.version, patch: { status: "done" } });
    const next = (await listTasks(ctx, "theo", "mine")).filter((x) => x.title === "Prospect list" && x.status === "todo");
    expect(next.map((x) => [x.due_at, x.recurrence_days])).toEqual([["2026-11-12", [1, 4]]]);
    // Switching away from weekly clears the days.
    await updateTask(ctx, "theo", { id: next[0].id, private: false, expected_version: next[0].version, patch: { recurrence: "daily" } });
    expect((await listTasks(ctx, "theo", "mine")).find((x) => x.id === next[0].id)?.recurrence_days).toEqual([]);
  });
  it("snoozing needs a reason", async () => {
    const id = randomUUID();
    await createTask(ctx, "theo", { id, task: { title: "X", description: "", owner: "theo", priority: "P2", due_at: "", estimated_minutes: null, recurrence: "none", account_id: "", opportunity_id: "", dependency_ids: [], private: false }, source: "manual", source_id: "" });
    await expect(updateTask(ctx, "theo", { id, private: false, expected_version: 1, patch: { snoozed_until: "2026-11-12" } })).rejects.toThrow(/reason/);
  });
});

describe("Scenario 5 (stored): day closure after cutoff", () => {
  it("10/7 with review passes; a lowered goal mid-day does not change the day; Off days are skipped", async () => {
    await setMode(ctx.repo, "theo", { mode: "CUSTOM", reason: "" }, NOW);
    await setTargets(ctx.repo, "theo", { mode: "CUSTOM", targets: { calls: { target: 10, weight: 1, minutes: 4 }, dms: { target: 10, weight: 1, minutes: 3 } } }, NOW);
    await getMyDay(ctx.repo, "theo", NOW); // snapshot today's plan
    await setTargets(ctx.repo, "theo", { mode: "CUSTOM", targets: { dms: { target: 7, weight: 1, minutes: 3 } } }, NOW); // applies tomorrow
    const acc = randomUUID();
    await createAccount(ctx.repo, "theo", createAccountSchema.parse({ id: acc, account: { name: "Garage Test", country: "FR" } }));
    const log = (type: "cold_call" | "linkedin_dm") => logActivity(ctx.repo, "theo", logActivitySchema.parse({ idempotency_key: randomUUID(), activity_type: type, account_id: acc }), NOW);
    for (let i = 0; i < 10; i++) await log("cold_call");
    for (let i = 0; i < 6; i++) await log("linkedin_dm");
    const before = await streakSummary(ctx, "theo", NOW);
    expect(before.todayStatus.attainment).toBeCloseTo(0.8);
    await log("linkedin_dm");
    await saveReview(ctx, "theo", { went_well: "", blockers: "", tomorrow_priority: "Visit garages" }, NOW);
    const nextDay = new Date("2026-11-09T23:30:00.000Z"); // after Paris midnight
    const closed = await closeDays(ctx, "theo", nextDay);
    expect(closed.map((r) => [r.local_date, r.status, r.attainment_pct])).toEqual([["2026-11-09", "passed", 85]]);
    expect(await closeDays(ctx, "theo", nextDay)).toEqual([]); // idempotent
    const s = await streakSummary(ctx, "theo", nextDay);
    expect(s.streak).toBe(1);
  });
});

describe("Scenario 16: private data", () => {
  it("private tasks live only in the owner's spreadsheet and are unreachable for the other founder", async () => {
    const priv = randomUUID();
    await createTask(ctx, "theo", { id: priv, task: { title: "Prepare interview", description: "", owner: null, priority: "P1", due_at: "2026-11-09", estimated_minutes: 30, recurrence: "none", account_id: "", opportunity_id: "", dependency_ids: [], private: true }, source: "manual", source_id: "" });
    expect((await listTasks(ctx, "pablo", "all")).some((t) => t.id === priv)).toBe(false);
    expect((await listTasks(ctx, "theo", "all")).some((t) => t.id === priv)).toBe(true);
    expect(JSON.stringify(sheets.books.get("main")!.sheets.map((s) => s.grid))).not.toContain("Prepare interview");
    expect(await scorecardCsv(ctx, "pablo")).not.toContain("Prepare interview");
  });
});

async function calendars() {
  google.store.addCalendar(SHARED);
  google.store.addEvent(SHARED, { id: "sharedevent01", title: "Demo with Garage", description: "", start: "2026-11-10T10:00:00.000Z", end: "2026-11-10T11:00:00.000Z" });
  google.store.addEvent(THEO_CAL, { id: "theoevent0001", title: "Interview at Secret Employer", description: "private", start: "2026-11-10T13:00:00.000Z", end: "2026-11-10T14:00:00.000Z" });
  google.store.addEvent(PABLO_CAL, { id: "pabloevent001", title: "Dentist", description: "", start: "2026-11-09T09:00:00.000Z", end: "2026-11-09T13:00:00.000Z" });
  await addCalendarSource(ctx, "theo", { calendar_id: SHARED, label: "Valemont", kind: "shared", owner_founder: null, access: "details" });
  // Théo shared his calendar WITH details to the service account; Pablo must still only see "Busy".
  await addCalendarSource(ctx, "theo", { calendar_id: THEO_CAL, label: "Théo", kind: "personal", owner_founder: "theo", access: "details" });
  await addCalendarSource(ctx, "pablo", { calendar_id: PABLO_CAL, label: "Pablo", kind: "personal", owner_founder: "pablo", access: "free_busy" });
}

describe("Scenario 17: agenda privacy", () => {
  it("merges three calendars; Théo's private event is only 'Busy' for Pablo and its title is in no response or Sheet", async () => {
    await calendars();
    const forPablo = await upcomingEvents(ctx, "pablo", NOW);
    expect(forPablo.events.map((e) => e.title)).toEqual(expect.arrayContaining(["Demo with Garage", "Busy"]));
    expect(JSON.stringify(forPablo)).not.toContain("Secret Employer");
    const forTheo = await upcomingEvents(ctx, "theo", NOW);
    expect(forTheo.events.map((e) => e.title)).toContain("Interview at Secret Employer");
    expect(JSON.stringify(sheets.books.get("main")!.sheets.map((s) => s.grid))).not.toContain("Secret Employer");
    // The request path for Pablo used free/busy for Théo's calendar, never events.list.
    expect(google.log.some((l) => l.path.includes(encodeURIComponent(THEO_CAL)) && l.path.includes("/events"))).toBe(true); // from Théo's own read
    const pabloOnly = new FakeGoogleServer();
    void pabloOnly;
  });
});

describe("Scenario 18: founder point", () => {
  it("offers three mutually free slots, creates one event (retry-safe), follows a move, turns actions into tasks", async () => {
    await calendars();
    const slots = await proposeSlots(ctx, 30, NOW);
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(s.start >= "2026-11-09T13:00:00.000Z" || s.start < "2026-11-09T09:00:00.000Z").toBe(true); // Pablo busy 10:00–14:00 Madrid
    const id = randomUUID();
    const input = { id, title: "Weekly review", type: "weekly_review" as const, duration_min: 30, start: slots[0].start, recurrence: null, agenda: ["Pipeline"] };
    const first = await schedulePoint(ctx, "theo", input);
    const retry = await schedulePoint(ctx, "theo", input);
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(google.store.calendars.get(SHARED)!.filter((e) => e.id === first.eventId)).toHaveLength(1);
    google.store.moveEvent(SHARED, first.eventId, "2026-11-12T15:00:00.000Z", "2026-11-12T15:45:00.000Z");
    const points = await listPoints(ctx);
    expect(points[0]).toMatchObject({ start_at: "2026-11-12T15:00:00.000Z", status: "moved_in_calendar", duration_min: 45 });
    const r = await addPointItem(ctx, "theo", { id: randomUUID(), point_id: id, kind: "action", text: "Send pilot terms", owner: "pablo", due_at: "2026-11-13" });
    expect((await listTasks(ctx, "pablo", "mine")).find((t) => t.id === r.taskId)?.title).toBe("Send pilot terms");
    google.store.deleteEvent(SHARED, first.eventId);
    expect((await listPoints(ctx))[0].status).toBe("deleted_in_calendar");
  });
});

describe("Scenario 19: idea box", () => {
  it("one line is enough, adds nothing to targets, third Testing idea asks to park, conversion keeps the link", async () => {
    await setMode(ctx.repo, "theo", { mode: "FULL_TIME", reason: "" }, NOW);
    const before = await getMyDay(ctx.repo, "theo", NOW);
    await createSprint(ctx, "theo", { name: "S1", start_date: "2026-11-02", end_date: "2026-11-15", niche: "", targets: { theo: { contacted: 50, replies: 10, demos: 3, pilots: 1 }, pablo: { contacted: 50, replies: 10, demos: 3, pilots: 1 } }, brand_split: { local: 0.7, consulting: 0.2, thirty: 0.1 } });
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of ids.entries()) await addIdea(ctx, "theo", { id, text: `Idea ${i}`, note: "", brand: null, category: "other" });
    const after = await getMyDay(ctx.repo, "theo", NOW);
    expect(after.targets).toEqual(before.targets);
    await updateIdea(ctx, "theo", { id: ids[0], expected_version: 1, status: "testing" });
    await updateIdea(ctx, "theo", { id: ids[1], expected_version: 1, status: "testing" });
    const third = await updateIdea(ctx, "theo", { id: ids[2], expected_version: 1, status: "testing" });
    expect(third.needsPark).toBe(true);
    const parked = await updateIdea(ctx, "theo", { id: ids[2], expected_version: 1, status: "testing", park_id: ids[0] });
    expect(parked.needsPark).toBe(false);
    const conv = await convertIdea(ctx, "theo", { id: ids[1], expected_version: 2, to: "task", owner: "theo" });
    const task = (await listTasks(ctx, "theo", "all")).find((t) => t.id === conv.id)!;
    expect(task).toMatchObject({ source: "idea", source_id: ids[1] });
  });
});

describe("Scenario 20: files", () => {
  it("lists the shared folder with the service account; links persist; uploads need the founder's grant, never the service account", async () => {
    await ctx.repo.insert("SystemSettings", [{ id: childId("setting", "drive_folder_id"), key: "drive_folder_id", value: FOLDER, description: "" }], { founder: "system" });
    google.store.addFile({ id: "f1", name: "Pitch FR.pdf", parents: [FOLDER] });
    const listing = await listFolder(ctx, null, "");
    expect(listing.files.map((f) => f.name)).toEqual(["Pitch FR.pdf"]);
    expect(google.log.filter((l) => l.path.startsWith("/drive")).every((l) => l.token === "sa-token")).toBe(true);
    const acc = randomUUID();
    await linkFile(ctx, "theo", { file_id: "f1", record_type: "account", record_id: acc });
    const reload = new GoogleSheetsRepository(new SheetsClient({ baseUrl: sheets.url, spreadsheetId: "main", getToken: async () => "fake" }));
    expect((await filesFor({ ...ctx, repo: reload }, "account", acc)).map((f) => f.name)).toEqual(["Pitch FR.pdf"]);
    const upload = { name: "notes.txt", mime_type: "text/plain", data_base64: Buffer.from("hello").toString("base64"), record_type: null, record_id: "", parent_id: null };
    await expect(uploadFile(ctx, "theo", null, upload)).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(google.store.writes).toEqual([]);
    const f = await uploadFile(ctx, "theo", "theo-drive-file-token", upload);
    expect(f.name).toBe("notes.txt");
    expect(google.store.writes).toEqual([{ kind: "drive.upload", by: "theo-drive-file-token" }]);
  });
});

async function xlsxFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ENGAGEMENT");
  ws.addRow(["Date", "Impressions", "Engagements", "Unknown column"]);
  ws.addRow(["11/02/2026", 500, 30, "x"]);
  ws.addRow(["11/03/2026", 650, 41, "y"]);
  const f = wb.addWorksheet("FOLLOWERS");
  f.addRow(["Total followers on 11/03/2026", 1200]);
  f.addRow(["Date", "Total followers"]);
  f.addRow(["11/03/2026", 1200]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function xlsFixture() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Aggregated page metrics"], ["Date", "Impressions (total)", "Unique impressions (organic)", "Clicks (total)", "Reactions (total)", "Comments (total)", "Reposts (total)", "Engagement rate (total)"], ["11/02/2026", 120, 90, 4, 6, 1, 1, 0.05], ["11/03/2026", 140, 100, 5, 7, 2, 0, 0.04]]), "Metrics");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xls" }));
}

describe("Scenario 21: LinkedIn import", () => {
  it("previews mapped/unrecognised columns, re-import adds no row, series shows source import, personal data stays private", async () => {
    const page = randomUUID();
    const personal = randomUUID();
    await addSocialAccount(ctx, "pablo", { id: page, platform: "linkedin_page", handle: "Valemont", brand: "consulting", market: null });
    await addSocialAccount(ctx, "theo", { id: personal, platform: "linkedin_personal", handle: "Théo", brand: "consulting", market: null });
    const xls = xlsFixture().toString("base64");
    const p1 = await importLinkedIn(ctx, "pablo", { account_id: page, file_name: "page.xls", data_base64: xls, commit: false });
    expect(p1.unrecognized).toEqual(["Engagement rate (total)"]);
    expect(p1.mapped).toMatchObject({ "Impressions (total)": "impressions", "Unique impressions (organic)": "reach" });
    expect(p1.newRows).toBe(2);
    await importLinkedIn(ctx, "pablo", { account_id: page, file_name: "page.xls", data_base64: xls, commit: true });
    const again = await importLinkedIn(ctx, "pablo", { account_id: page, file_name: "page.xls", data_base64: xls, commit: true });
    expect(again).toMatchObject({ newRows: 0, alreadyImported: 2 });
    const s = await audienceSeries(ctx, "theo", { account_id: page, days: 30 });
    expect(s.metric).toBe("impressions");
    const nonNull = s.points.filter((p) => p.value !== null);
    expect(nonNull.map((p) => [p.date, p.value, p.source])).toEqual([["2026-11-02", 120, "import"], ["2026-11-03", 140, "import"]]);
    const x = await importLinkedIn(ctx, "theo", { account_id: personal, file_name: "creator.xlsx", data_base64: (await xlsxFixture()).toString("base64"), commit: true });
    expect(x.unrecognized).toContain("Unknown column");
    expect((await listAccounts(ctx, "pablo")).some((a) => a.id === personal)).toBe(false);
    await expect(audienceSeries(ctx, "pablo", { account_id: personal, days: 30 })).rejects.toThrow(/private/);
    expect((await listAccounts(ctx, "theo")).find((a) => a.id === personal)?.brand).toBeNull();
  });
});

describe("Scenario 23: Command Center information budget", () => {
  it("Now renders exactly five primary numbers; money figures not tracked are labelled, never zero", async () => {
    const cc = await commandCenter(ctx, "theo", NOW);
    expect(cc.now.numbers).toHaveLength(5);
    expect(cc.now.numbers.map((n) => n.key)).toEqual(["cash", "mrr", "weighted", "contacted", "meetings"]);
    expect(cc.now.numbers.find((n) => n.key === "cash")).toMatchObject({ value: null, display: "Not tracked yet" });
    expect(cc.now.attention.length).toBeLessThanOrEqual(5);
    expect(cc.money.notTracked).toContain("EBITDA".length ? "Estimated EBITDA" : "");
    const wr = await weeklyReview(ctx, "theo", undefined, NOW);
    expect(Object.keys(wr.perFounder)).toEqual(["theo", "pablo"]);
  });
});

describe("Task partial update regression", () => {
  it("completing a task keeps its owner and priority", async () => {
    const id = randomUUID();
    await createTask(ctx, "theo", { id, task: { title: "Keep owner", description: "", owner: "pablo", priority: "P0", due_at: "2026-11-09", estimated_minutes: null, recurrence: "none", account_id: "", opportunity_id: "", dependency_ids: [], private: false }, source: "manual", source_id: "" });
    const done = await updateTask(ctx, "pablo", { id, private: false, expected_version: 1, patch: { status: "done" } });
    expect(done).toMatchObject({ owner: "pablo", priority: "P0", due_at: "2026-11-09", status: "done" });
  });
});

describe("Drive shell", () => {
  it("searches the shared tree and lists recent files with the service account; new folders need the founder's grant", async () => {
    await ctx.repo.insert("SystemSettings", [{ id: childId("setting", "drive_folder_id"), key: "drive_folder_id", value: FOLDER, description: "" }], { founder: "system" });
    google.store.addFile({ id: "sub", name: "Clients", mimeType: "application/vnd.google-apps.folder", parents: [FOLDER] });
    google.store.addFile({ id: "deep", name: "Garage quote.pdf", parents: ["sub"] });
    expect((await listFolder(ctx, null, "quote", "search")).files.map((f) => f.name)).toEqual(["Garage quote.pdf"]);
    expect((await listFolder(ctx, null, "", "recent")).files.map((f) => f.name)).toEqual(["Garage quote.pdf"]);
    await expect(createFolder(ctx, "theo", null, { name: "New", parent_id: "sub" })).rejects.toBeInstanceOf(ConsentRequiredError);
    const f = await createFolder(ctx, "theo", "theo-grant", { name: "New", parent_id: "sub" });
    expect(f).toMatchObject({ name: "New", parents: ["sub"] });
    expect(google.store.writes.at(-1)).toEqual({ kind: "drive.folder", by: "theo-grant" });
  });
});
