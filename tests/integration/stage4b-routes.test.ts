import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createSessionToken } from "@/server/session";
import { getContext } from "@/server/repo";
import { resetRateLimits } from "@/server/guard";
import { enqueueAudit, flushAudit, listAudit } from "@/server/services/audit-log";
import { resetHealthCache } from "@/server/services/health";
import { setLogSink } from "@/server/log";
import { POST as ideaPOST } from "@/app/api/ideas/route";
import { GET as auditGET } from "@/app/api/audit/route";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as detailsGET } from "@/app/api/health/details/route";
import { GET as backupsGET, POST as backupsPOST } from "@/app/api/backups/route";
import { GET as bundleGET } from "@/app/api/backups/bundle/route";
import { POST as jobBackupPOST } from "@/app/api/jobs/backup/route";
import { POST as inboxPOST } from "@/app/api/inbox/webhook/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as driveGrantGET } from "@/app/api/auth/google/drive/route";

/**
 * Stage 4B through the real route handlers (DEMO, memory backend): the central audit hook of route(), correlation
 * ids, same-origin / size refusals, health endpoints, the protected backup job, webhook rate limits, redirects.
 */
const SECRET = "stage4b-session-secret-long-enough-0123456789";
const ENV: Record<string, string> = { APP_MODE: "demo", DEMO_BACKEND: "memory", SESSION_SECRET: SECRET, APP_BASE_URL: "http://localhost" };
const saved: Record<string, string | undefined> = {};
let theo = "";
let pablo = "";
const lines: string[] = [];

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(init.cookie ? { cookie: `vos_session=${init.cookie}` } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers };
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body) });
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  theo = await createSessionToken({ founder: "theo", role: "founder", mode: "demo" }, SECRET);
  pablo = await createSessionToken({ founder: "pablo", role: "founder", mode: "demo" }, SECRET);
  setLogSink((l) => lines.push(l));
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setLogSink(null);
});
beforeEach(() => { resetRateLimits(); lines.length = 0; });

describe("route(): audit trail, correlation id, refusals (D084)", () => {
  it("records an authenticated mutation: who, action, entity, record id, field names, status, correlation id — no values", async () => {
    const id = randomUUID();
    const res = await ideaPOST(req("/api/ideas", { method: "POST", cookie: theo, body: { id, text: "Offre secrète pour +33612345678" }, headers: { origin: "http://localhost", "x-request-id": "corr-test-0001", "x-forwarded-for": "203.0.113.9" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("corr-test-0001");
    const { repo } = await getContext();
    await flushAudit(repo);
    const { rows: raw } = await repo.list("AuditLog", { fresh: true });
    const row = raw.find((r) => r.correlation_id === "corr-test-0001")!;
    expect(row).toMatchObject({ actor: "theo", action: "POST /ideas", table_name: "ideas", record_id: id, http_status: 200, audit_scope: "team" });
    expect(row.fields.split(",")).toEqual(expect.arrayContaining(["text", "note", "brand", "category"]));
    expect(row.input_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(row)).not.toMatch(/secrète|612345678|203\.0\.113/);
    // The structured log line carries the same id and no body.
    const log = lines.map((l) => JSON.parse(l)).find((l) => l.event === "request" && l.correlationId === "corr-test-0001");
    expect(log).toMatchObject({ level: "info", method: "POST", path: "/api/ideas", status: 200, founder: "theo" });
    expect(lines.join("\n")).not.toMatch(/secrète|612345678/);
  });

  it("a malformed or foreign Origin is refused with 403 (and audited), never a 500", async () => {
    for (const origin of ["null", "https://evil.example.com"]) {
      const res = await ideaPOST(req("/api/ideas", { method: "POST", cookie: theo, body: { id: randomUUID(), text: "x" }, headers: { origin, "x-request-id": `corr-origin-${origin.length}` } }));
      expect(res.status).toBe(403);
    }
    const { repo } = await getContext();
    await flushAudit(repo);
    const out = await listAudit(repo, "theo", { entity: "ideas", founder: "theo", from: "", to: "", limit: 50 });
    expect(out.rows.some((r) => r.status === 403)).toBe(true);
  });

  it("refuses an oversized body with 413 before reading it", async () => {
    const res = await ideaPOST(req("/api/ideas", { method: "POST", cookie: theo, body: "{}", headers: { origin: "http://localhost", "content-length": "5000000" } }));
    expect(res.status).toBe(413);
  });

  it("unauthenticated requests are not audited (no actor) and get a request id", async () => {
    const res = await ideaPOST(req("/api/ideas", { method: "POST", body: { id: randomUUID(), text: "x" }, headers: { "x-request-id": "corr-anon-0001" } }));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBe("corr-anon-0001");
    const { repo } = await getContext();
    await flushAudit(repo);
    expect((await repo.list("AuditLog", { fresh: true })).rows.some((r) => r.correlation_id === "corr-anon-0001")).toBe(false);
  });

  it("viewer: filters by entity, founder and date; a private mutation is visible only to its author and carries no detail", async () => {
    const { repo } = await getContext();
    enqueueAudit(repo, { founder: "theo", method: "PATCH", path: "/api/tasks", status: 200, correlationId: "corr-private-01", input: { private: true, id: randomUUID(), patch: { title: "Entretien chez X" } }, secret: SECRET });
    await flushAudit(repo);
    const asTheo = await (await auditGET(req("/api/audit?founder=theo", { cookie: theo }))).json();
    const priv = asTheo.rows.find((r: { correlation_id: string }) => r.correlation_id === "corr-private-01");
    expect(priv).toMatchObject({ entity: "private", record_id: "", fields: [] });
    const asPablo = await (await auditGET(req("/api/audit?founder=theo", { cookie: pablo }))).json();
    expect(asPablo.rows.some((r: { correlation_id: string }) => r.correlation_id === "corr-private-01")).toBe(false);
    const future = await (await auditGET(req("/api/audit?from=2999-01-01", { cookie: theo }))).json();
    expect(future.rows).toEqual([]);
    expect((await auditGET(req("/api/audit?from=yesterday", { cookie: theo }))).status).toBe(400);
  });
});

describe("health (D084)", () => {
  it("liveness answers without touching Sheets; readiness checks config + Sheets; nothing secret", async () => {
    resetHealthCache();
    const live = await healthGET(req("/api/health?probe=live"));
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "ok" });
    const ready = await healthGET(req("/api/health"));
    expect(ready.status).toBe(200);
    const body = await ready.json();
    expect(body).toMatchObject({ status: expect.stringMatching(/^(ok|degraded)$/), checks: { process: "ok", config: "ok", sheets: "ok" } });
    expect(JSON.stringify(body)).not.toMatch(/SECRET|example\.com|demo/i);
  });

  it("readiness fails with 503 when the configuration is invalid", async () => {
    process.env.APP_MODE = "";
    try {
      const res = await healthGET(req("/api/health"));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ status: "fail", checks: { config: "fail" } });
    } finally {
      process.env.APP_MODE = "demo";
    }
  });

  it("details need a founder session", async () => {
    expect((await detailsGET(req("/api/health/details"))).status).toBe(401);
    const res = await detailsGET(req("/api/health/details", { cookie: pablo }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ready: true, mode: "demo", sheets: { ok: true }, config: { ok: true } });
  });

  it("is rate limited", async () => {
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await healthGET(req("/api/health?probe=live", { headers: { "x-forwarded-for": "198.51.100.7" } }))).status;
    expect(last).toBe(429);
  });
});

describe("backups through the routes (DEMO)", () => {
  it("status says not configured, run now copies nothing, the JSON copy downloads and is audited", async () => {
    expect(await (await backupsGET(req("/api/backups", { cookie: theo }))).json()).toMatchObject({ configured: false, mode: "demo" });
    expect(await (await backupsPOST(req("/api/backups", { method: "POST", cookie: theo, headers: { origin: "http://localhost" } }))).json()).toEqual({ status: "not_configured" });
    const res = await bundleGET(req("/api/backups/bundle", { cookie: theo, headers: { "x-request-id": "corr-bundle-001" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/valemont-os-backup-\d{4}-\d{2}-\d{2}\.json/);
    const b = await res.json();
    expect(b).toMatchObject({ format: "valemont-os-backup", version: 1, source: "memory" });
    expect(b.tabs.PrivateTasks).toBeUndefined(); // private founder data is never exported (spec 4.7)
    const { repo } = await getContext();
    await flushAudit(repo);
    expect((await repo.list("AuditLog", { fresh: true })).rows.some((r) => r.correlation_id === "corr-bundle-001" && r.action === "GET /backups/bundle")).toBe(true);
  });

  it("the scheduler endpoint is refused unless configured and authenticated; DEMO never copies", async () => {
    delete process.env.BACKUP_JOB_TOKEN;
    delete process.env.BACKUP_JOB_SECRET;
    delete process.env.CRON_SECRET;
    expect((await jobBackupPOST(req("/api/jobs/backup", { method: "POST" }))).status).toBe(503);
    process.env.BACKUP_JOB_TOKEN = "backup-job-token-0123456789abcdef";
    try {
      expect((await jobBackupPOST(req("/api/jobs/backup", { method: "POST", headers: { authorization: "Bearer wrong-token-0123456789abcdef" } }))).status).toBe(401);
      expect((await jobBackupPOST(req("/api/jobs/backup", { method: "POST", headers: { authorization: "Bearer backup-job-token-0123456789abcdef" } }))).status).toBe(409);
    } finally {
      delete process.env.BACKUP_JOB_TOKEN;
    }
  });
});

describe("security fixes (D084)", () => {
  it("webhooks: oversized bodies are refused from Content-Length, bursts are rate limited", async () => {
    process.env.INBOX_WEBHOOK_SECRET = "inbox-secret-for-tests";
    try {
      const big = await inboxPOST(req("/api/inbox/webhook", { method: "POST", body: "{}", headers: { "content-length": "9000000" } }));
      expect(big.status).toBe(413);
      const body = JSON.stringify({ items: [] });
      const sig = `sha256=${createHmac("sha256", "wrong").update(body).digest("hex")}`;
      const statuses: number[] = [];
      for (let i = 0; i < 125; i++) statuses.push((await inboxPOST(req("/api/inbox/webhook", { method: "POST", body, headers: { "x-valemont-signature": sig, "x-forwarded-for": "192.0.2.44" } }))).status);
      expect(statuses[0]).toBe(401);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      delete process.env.INBOX_WEBHOOK_SECRET;
    }
  });

  it("consent return paths cannot leave the site", async () => {
    const res = await driveGrantGET(req("/api/auth/google/drive?back=/%5Cevil.example.com", { cookie: theo }));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(new URL(res.headers.get("location")!).host).toBe("localhost");
  });

  it("sign-out refuses a cross-site post", async () => {
    expect((await logoutPOST(req("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example.com" } }))).status).toBe(403);
    expect((await logoutPOST(req("/api/auth/logout", { method: "POST", headers: { origin: "http://localhost" } }))).status).toBe(303);
  });
});
