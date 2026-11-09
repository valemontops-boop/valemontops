import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { FakeSheetsServer } from "@/fake-sheets/server";
import { createSessionToken } from "@/server/session";
import { getContext } from "@/server/repo";
import { getConfig } from "@/server/config";
import { flushAudit } from "@/server/services/audit-log";
import { resetRateLimits } from "@/server/guard";
import { needsInstall, resetInstallCache } from "@/server/services/install";
import { bootstrapStatus } from "@/server/bootstrap";
import { wantedTabs } from "@/data/sheets/setup";
import { ENTRIES } from "@/i18n/dict";
import { GET as statusGET } from "@/app/api/install/status/route";
import { POST as runPOST } from "@/app/api/install/run/route";
import { POST as doctorPOST } from "@/app/api/install/doctor/route";

/**
 * D086: in-app Installation through the real route handlers, LIVE mode against the fake Sheets server
 * (empty spreadsheet, as a founder creates it): setup + seed + doctor, idempotency, permission errors, founder-only.
 */
const SECRET = "install-session-secret-long-enough-0123456789";
const SHARED = "install-shared";
const PRIV_THEO = "install-private-theo";
const SA_EMAIL = "valemont-os@example-project.iam.gserviceaccount.com";
const KEY = Buffer.from(JSON.stringify({ client_email: SA_EMAIL, private_key: "not-a-real-key" })).toString("base64");
let fake: FakeSheetsServer;
let theo = "";
let pablo = "";
const saved: Record<string, string | undefined> = {};

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(init.cookie ? { cookie: `vos_session=${init.cookie}` } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.origin ? { origin: init.origin } : {}) };
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const post = (path: string, body: unknown, cookie = theo) => req(path, { method: "POST", body, cookie, origin: "http://localhost" });

beforeAll(async () => {
  fake = new FakeSheetsServer({ spreadsheets: { [SHARED]: "Valemont OS", [PRIV_THEO]: "Valemont OS – private Théo" } });
  const url = await fake.start();
  const env: Record<string, string> = {
    APP_MODE: "live", SESSION_SECRET: SECRET, APP_BASE_URL: "http://localhost",
    FOUNDER_THEO_EMAIL: "theo@example.com", FOUNDER_PABLO_EMAIL: "pablo@example.com",
    GOOGLE_OAUTH_CLIENT_ID: "client-id.example.com", GOOGLE_OAUTH_CLIENT_SECRET: "client-secret-test",
    SHEETS_SPREADSHEET_ID: SHARED, SHEETS_API_BASE_URL: url, GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: KEY,
    PRIVATE_SHEET_ID_THEO: PRIV_THEO, PRIVATE_SHEET_ID_PABLO: "",
  };
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
  theo = await createSessionToken({ founder: "theo", role: "founder", mode: "live" }, SECRET);
  pablo = await createSessionToken({ founder: "pablo", role: "founder", mode: "live" }, SECRET);
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fake?.stop();
});
beforeEach(() => { resetRateLimits(); fake.faults = []; });

const tabsOf = (id: string) => fake.books.get(id)!.sheets.map((s) => s.title);

describe("Installation from the app (D086)", () => {
  it("an empty Sheet sends the founder to the Installation page; status lists the missing tabs and the service account email", async () => {
    expect(getConfig().ok).toBe(true);
    expect(await needsInstall(getConfig(), "theo")).toBe(true);
    const res = await statusGET(req("/api/install/status", { cookie: theo }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serviceEmail).toBe(SA_EMAIL);
    expect(body.sheets[0]).toMatchObject({ target: "shared", access: "ok", ready: false });
    expect(body.sheets[0].tabs.every((t: { state: string }) => t.state === "missing")).toBe(true);
    expect(body.sheets[1]).toMatchObject({ target: "theo", access: "ok", ready: false });
    expect(JSON.stringify(body)).not.toContain("not-a-real-key");
  });

  it("is founder-only and same-origin", async () => {
    expect((await runPOST(req("/api/install/run", { method: "POST", body: { target: "shared" }, origin: "http://localhost" }))).status).toBe(401);
    expect((await runPOST(req("/api/install/run", { method: "POST", body: { target: "shared" }, cookie: theo, origin: "https://evil.example.com" }))).status).toBe(403);
    expect((await runPOST(post("/api/install/run", { target: "everything" }))).status).toBe(400);
    expect(tabsOf(SHARED)).toEqual([]);
  });

  it("prepares the shared Sheet from empty (tabs, headers, seed rows), then the founder's own private Sheet", async () => {
    const res = await runPOST(post("/api/install/run", { target: "shared" }));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r).toMatchObject({ target: "shared", ok: true, access: "ok" });
    const wanted = Object.keys(wantedTabs("shared"));
    expect(r.tabs).toHaveLength(wanted.length);
    expect(r.tabs.every((t: { result: string }) => t.result === "created")).toBe(true);
    expect(new Set(tabsOf(SHARED))).toEqual(new Set(wanted));
    expect(r.seeded.SchemaMigrations).toBe(1);

    const own = await (await runPOST(post("/api/install/run", { target: "own" }))).json();
    expect(own).toMatchObject({ target: "theo", ok: true });
    expect(new Set(tabsOf(PRIV_THEO))).toEqual(new Set(Object.keys(wantedTabs("private"))));
    // Pablo has no private Sheet configured: nothing to prepare, nothing touched.
    const pab = await (await runPOST(post("/api/install/run", { target: "own" }, pablo))).json();
    expect(pab).toMatchObject({ target: "pablo", ok: false, access: "not_configured" });

    expect(await needsInstall(getConfig(), "theo")).toBe(false);
    expect(await needsInstall(getConfig(), "pablo")).toBe(false);
  });

  it("is safe to click twice: nothing created, nothing seeded, no row duplicated", async () => {
    const users = fake.sheet(SHARED, "Users")!.grid.length;
    const [a, b] = await Promise.all([runPOST(post("/api/install/run", { target: "shared" })), runPOST(post("/api/install/run", { target: "shared" }))]);
    for (const res of [a, b]) {
      const r = await res.json();
      expect(r.ok).toBe(true);
      expect(r.tabs.every((t: { result: string }) => t.result === "unchanged")).toBe(true);
      expect(r.seeded).toEqual({});
    }
    expect(fake.sheet(SHARED, "Users")!.grid.length).toBe(users);
  });

  it("adds a column missing after an update, and the gate sends founders back to Installation until then", async () => {
    const grid = fake.sheet(SHARED, "Ideas")!.grid;
    const last = (grid[0] as string[]).length - 1;
    const dropped = (grid[0] as string[])[last];
    (grid[0] as string[])[last] = "";
    resetInstallCache();
    expect(await needsInstall(getConfig(), "theo")).toBe(true);
    const r = await (await runPOST(post("/api/install/run", { target: "shared" }))).json();
    expect(r.tabs.find((t: { tab: string }) => t.tab === "Ideas")).toMatchObject({ result: "columns", columns: [dropped] });
    expect(await needsInstall(getConfig(), "theo")).toBe(false);
  });

  it("“Check” runs the doctor: every check passes, in the founder's language, and the test row is cleaned", async () => {
    const res = await doctorPOST(req("/api/install/doctor", { method: "POST", cookie: theo, origin: "http://localhost" }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.checks.filter((c: { status: string }) => c.status === "fail")).toEqual([]);
    expect(d.checks.find((c: { name: string }) => c.name === "Read/write round-trip").status).toBe("ok");
    expect(d.own).toMatchObject({ target: "theo", ready: true });
    for (const c of d.checks) {
      expect(ENTRIES[c.name], c.name).toBeDefined();
      expect(ENTRIES[c.key], c.key).toBeDefined();
    }
    expect(fake.sheet(SHARED, "_Doctor")!.grid[1].every((c) => c === "")).toBe(true);
  });

  it("every Installation call is audited (names only)", async () => {
    const { repo } = await getContext();
    await flushAudit(repo);
    const { rows } = await repo.list("AuditLog", { fresh: true });
    expect(rows.some((r) => r.action === "POST /install/run" && r.actor === "theo" && r.http_status === 200)).toBe(true);
    expect(rows.some((r) => r.action === "POST /install/doctor")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(SA_EMAIL);
  });

  it("without Editor access: says so, with the service account email to share the Sheet with", async () => {
    fake.faults.push({ status: 403, times: 100, method: "GET" });
    const r = await (await runPOST(post("/api/install/run", { target: "shared" }))).json();
    expect(r).toMatchObject({ ok: false, access: "forbidden", serviceEmail: SA_EMAIL });
    resetInstallCache();
    expect(await needsInstall(getConfig(), "theo")).toBe(true); // shared Sheet unreachable: Installation page explains
    fake.faults = [];

    // Shared as Viewer: reads work, the first write is refused.
    fake.books.get(SHARED)!.sheets = [];
    fake.faults.push({ status: 403, times: 100, method: "POST" });
    const ro = await (await runPOST(post("/api/install/run", { target: "shared" }))).json();
    expect(ro).toMatchObject({ ok: false, access: "read_only", serviceEmail: SA_EMAIL });
    fake.faults = [];
    expect((await (await runPOST(post("/api/install/run", { target: "shared" }))).json()).ok).toBe(true);

    fake.faults.push({ status: 404, times: 100, method: "GET" });
    expect((await (await runPOST(post("/api/install/run", { target: "shared" }))).json()).access).toBe("not_found");
  });

  it("a Google outage never blocks the app (unknown is not 'needs install')", async () => {
    resetInstallCache();
    fake.faults.push({ status: 500, times: 100 });
    expect(await needsInstall(getConfig(), "theo")).toBe(false);
  });
});

describe("/setup bootstrap status (D086)", () => {
  it("reports names and states only, never a value", () => {
    const env = {
      APP_MODE: "live", SESSION_SECRET: "short-secret-value", FOUNDER_THEO_EMAIL: "theo@example.com", FOUNDER_PABLO_EMAIL: "not-an-email",
      GOOGLE_OAUTH_CLIENT_SECRET: "oauth-secret-value-123", GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: KEY, FOUNDER_THEO_TIMEZONE: "Mars/Olympus",
      VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "os.example.com",
    };
    const out = bootstrapStatus(env);
    const by = Object.fromEntries(out.map((v) => [v.name, v]));
    expect(by.APP_MODE.state).toBe("set");
    expect(by.SESSION_SECRET).toMatchObject({ state: "invalid" });
    expect(by.APP_BASE_URL).toMatchObject({ state: "auto", required: false });
    expect(by.FOUNDER_PABLO_EMAIL.state).toBe("invalid");
    expect(by.FOUNDER_THEO_TIMEZONE.state).toBe("invalid");
    expect(by.FOUNDER_PABLO_TIMEZONE.state).toBe("default");
    expect(by.GOOGLE_OAUTH_CLIENT_ID.state).toBe("missing");
    expect(by.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64.state).toBe("set");
    expect(by.SHEETS_SPREADSHEET_ID.state).toBe("missing");
    const text = JSON.stringify(out);
    for (const v of Object.values(env)) if (!["live", "production"].includes(v)) expect(text).not.toContain(v);
    for (const v of out) if (v.problem) expect(ENTRIES[v.problem], v.problem).toBeDefined();
  });

  it("accepts the JSON key pasted as-is and a sheet URL is flagged", () => {
    const json = JSON.stringify({ client_email: SA_EMAIL, private_key: "x" });
    const out = Object.fromEntries(bootstrapStatus({ GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: json, SHEETS_SPREADSHEET_ID: "https://docs.google.com/spreadsheets/d/abc/edit" }).map((v) => [v.name, v.state]));
    expect(out.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64).toBe("set");
    expect(out.SHEETS_SPREADSHEET_ID).toBe("invalid");
  });
});
