import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeWiseServer } from "@/fake-wise/server";
import { InMemoryRepository } from "@/data/memory";
import { createSessionToken } from "@/server/session";
import { getContext } from "@/server/repo";
import { resetRateLimits } from "@/server/guard";
import { setLogSink } from "@/server/log";
import { signJob } from "@/server/job-auth";
import { websiteLimiter } from "@/server/website-webhook";
import { flushAudit } from "@/server/services/audit-log";
import { connectorEnvSync, resetConnectorCache } from "@/server/connector-env";
import { wiseFromEnv } from "@/server/connector-ports";
import { refreshConnectorEnv, vaultAction } from "@/server/services/vault";
import { testIntegration } from "@/server/services/integrations";
import type { AppContext } from "@/server/context";
import { GET as vaultGET, POST as vaultPOST } from "@/app/api/integrations/vault/route";
import { POST as testPOST } from "@/app/api/integrations/test/route";
import { POST as websitePOST } from "@/app/api/webhooks/website/route";
import { POST as inboxPOST } from "@/app/api/inbox/webhook/route";

/**
 * D087 through the real route handlers: DEMO on the fake Sheets server (the same adapter as LIVE), so what the vault
 * writes can be read back cell by cell. Plus the LIVE port path (Wise) with a value that exists only in the vault.
 */
/** Built at runtime: no provider-key-shaped literal in the repository (push protection). */
const fakeKey = (prefix: string, body: string) => [prefix, "live", body].join("_");
const SECRET = "vault-session-secret-long-enough-0123456789";
const BOOK = "vault-demo-sheet";
const saved: Record<string, string | undefined> = {};
let fake: FakeSheetsServer;
let theo = "";
let pablo = "";
const lines: string[] = [];

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(init.cookie ? { cookie: `vos_session=${init.cookie}` } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...init.headers };
  return new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body) });
}
const post = (body: unknown, cookie = theo, headers: Record<string, string> = {}) => vaultPOST(req("/api/integrations/vault", { method: "POST", body, cookie, headers: { origin: "http://localhost", ...headers } }));
const overview = async (cookie = theo) => (await vaultGET(req("/api/integrations/vault", { cookie }))).json();
const fieldState = async (key: string, name: string, cookie = theo) => {
  const o = await overview(cookie);
  return o.connectors.find((c: { key: string }) => c.key === key).fields.find((f: { name: string }) => f.name === name);
};
/** Every cell of a tab on the fake server, as text. */
const rawCells = (tab: string) => JSON.stringify(fake.sheet(BOOK, tab)?.grid ?? []);
const lead = (eventId: string) => JSON.stringify({ event_id: eventId, site: "valemont", form_type: "contact", language: "fr", name: "Claire Test", company: "Boulangerie Exemple (vault test)", email: `claire+${eventId}@example.com`, phone: "", message: "Bonjour", consent: { marketing: false, text: "", version: "" }, elapsed_ms: 9000 });
const website = (raw: string, secret: string) => {
  const s = signJob(raw, secret);
  return websitePOST(req("/api/webhooks/website", { method: "POST", body: raw, headers: { "x-valemont-timestamp": s.ts, "x-valemont-signature": s.sig, "x-forwarded-for": "198.51.100.7" } }));
};

beforeAll(async () => {
  fake = new FakeSheetsServer({ spreadsheets: { [BOOK]: "Vault test", [`${BOOK}-private-theo`]: "p1", [`${BOOK}-private-pablo`]: "p2" } });
  const url = await fake.start();
  const env = { APP_MODE: "demo", DEMO_BACKEND: "fake-sheets", FAKE_SHEETS_URL: url, FAKE_SHEETS_SPREADSHEET_ID: BOOK, SESSION_SECRET: SECRET, APP_BASE_URL: "http://localhost" };
  for (const k of [...Object.keys(env), "WEBSITE_WEBHOOK_SECRET", "INBOX_WEBHOOK_SECRET", "STRIPE_API_KEY"]) saved[k] = process.env[k];
  Object.assign(process.env, env);
  for (const k of ["WEBSITE_WEBHOOK_SECRET", "INBOX_WEBHOOK_SECRET", "STRIPE_API_KEY"]) delete process.env[k];
  resetConnectorCache();
  theo = await createSessionToken({ founder: "theo", role: "founder", mode: "demo" }, SECRET);
  pablo = await createSessionToken({ founder: "pablo", role: "founder", mode: "demo" }, SECRET);
  setLogSink((l) => lines.push(l));
}, 60_000);
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setLogSink(null);
  resetConnectorCache();
  await fake.stop();
});
beforeEach(() => { resetRateLimits(); websiteLimiter.reset(); });

describe("connector vault through the routes (D087)", () => {
  it("saves a secret as ciphertext only: the fake Sheet, the overview, the audit row and the logs never hold the value", async () => {
    const key = fakeKey("rk", "fixturevaultroutetestQWER");
    const res = await post({ action: "save", integration: "stripe", changes: { STRIPE_API_KEY: key }, expected_versions: {} }, theo, { "x-request-id": "corr-vault-0001" });
    expect(res.status).toBe(200);
    const cells = rawCells("IntegrationSecrets");
    expect(cells).toContain("STRIPE_API_KEY");
    expect(cells).not.toContain("vaultroutetest");
    expect(cells).toMatch(/d1-[0-9a-f]{10}/); // key_version: the DEMO in-memory key
    for (const tab of ["SystemSettings", "AuditLog", "IntegrationStatuses"]) expect(rawCells(tab)).not.toContain("vaultroutetest");
    const f = await fieldState("stripe", "STRIPE_API_KEY");
    expect(f).toMatchObject({ saved: true, last4: "QWER", source: "app", value: "", updatedBy: "theo", version: 1 });
    expect(JSON.stringify(await overview())).not.toContain("vaultroutetest");
    const { repo } = await getContext();
    await flushAudit(repo);
    const audit = (await repo.list("AuditLog", { fresh: true })).rows.find((r) => r.correlation_id === "corr-vault-0001")!;
    expect(audit).toMatchObject({ actor: "theo", action: "POST /integrations/vault", http_status: 200, input_hash: "" });
    expect(audit.fields.split(",")).toEqual(expect.arrayContaining(["action", "integration", "STRIPE_API_KEY"]));
    expect(lines.join("\n")).not.toContain("vaultroutetest");
  });

  it("generates a secret once; the test connection and the website webhook both use the vault value", async () => {
    // Before: not configured anywhere → the self-test says so and the webhook refuses everything.
    const before = await (await testPOST(req("/api/integrations/test", { method: "POST", body: { key: "website" }, cookie: theo, headers: { origin: "http://localhost" } }))).json();
    expect(before.ok).toBe(false);
    expect((await website(lead("vault-evt-0000"), "x".repeat(40))).status).toBe(503);

    const g = await (await post({ action: "generate", integration: "website", field: "WEBSITE_WEBHOOK_SECRET", expected_version: 0 })).json();
    expect(g.value).toMatch(/^[0-9a-f]{64}$/);
    expect(rawCells("IntegrationSecrets")).not.toContain(g.value);
    expect(JSON.stringify(await overview())).not.toContain(g.value); // shown once, never again

    const after = await (await testPOST(req("/api/integrations/test", { method: "POST", body: { key: "website" }, cookie: theo, headers: { origin: "http://localhost" } }))).json();
    expect(after).toMatchObject({ ok: true });
    const ok = await website(lead("vault-evt-0001"), g.value);
    expect(ok.status).toBe(200);
    expect((await website(lead("vault-evt-0002"), "another-secret-0123456789abcdef0123")).status).toBe(401);

    // Replace: the new value works, the old one no longer does.
    const v1 = (await fieldState("website", "WEBSITE_WEBHOOK_SECRET")).version;
    const g2 = await (await post({ action: "generate", integration: "website", field: "WEBSITE_WEBHOOK_SECRET", expected_version: v1 })).json();
    expect(g2.value).not.toBe(g.value);
    expect((await website(lead("vault-evt-0003"), g.value)).status).toBe(401);
    expect((await website(lead("vault-evt-0004"), g2.value)).status).toBe(200);

    // Delete: the ciphertext is gone from the Sheet and the endpoint refuses everything again.
    const v2 = (await fieldState("website", "WEBSITE_WEBHOOK_SECRET")).version;
    expect((await post({ action: "delete", integration: "website", field: "WEBSITE_WEBHOOK_SECRET", expected_version: v2 })).status).toBe(200);
    expect((await fieldState("website", "WEBSITE_WEBHOOK_SECRET")).saved).toBe(false);
    expect((await website(lead("vault-evt-0005"), g2.value)).status).toBe(503);
  });

  it("the inbox relay webhook verifies with the vault secret too", async () => {
    const g = await (await post({ action: "generate", integration: "inbox", field: "INBOX_WEBHOOK_SECRET", expected_version: 0 })).json();
    const body = JSON.stringify({ external_id: `vault-${randomUUID()}`, platform: "instagram", kind: "comment", author_name: "Test", text: "Bonjour", received_at: new Date().toISOString() });
    const sig = (s: string) => `sha256=${createHmac("sha256", s).update(body).digest("hex")}`;
    const bad = await inboxPOST(req("/api/inbox/webhook", { method: "POST", body, headers: { "x-valemont-signature": sig("wrong-secret-0123456789abcdef0123456789") } }));
    expect(bad.status).toBe(401);
    const good = await inboxPOST(req("/api/inbox/webhook", { method: "POST", body, headers: { "x-valemont-signature": sig(g.value) } }));
    expect([200, 400]).toContain(good.status); // authenticated: 200, or 400 only if the sample item shape is refused after verification
    expect(good.status).not.toBe(401);
  });

  it("a stale version is a 409 that names who changed it, never the value; settings are plain and versioned too", async () => {
    const first = await post({ action: "save", integration: "wise", changes: { WISE_API_TOKEN: "1b2c3d4e-0000-4000-8000-123456789abc", WISE_PROFILE_ID: "12345" }, expected_versions: {} });
    expect(first.status).toBe(200);
    expect(rawCells("SystemSettings")).toContain("connector:WISE_PROFILE_ID");
    expect(rawCells("IntegrationSecrets")).not.toContain("123456789abc");
    expect((await fieldState("wise", "WISE_PROFILE_ID")).value).toBe("12345"); // not a secret: shown back
    const stale = await post({ action: "save", integration: "wise", changes: { WISE_API_TOKEN: "2b2c3d4e-0000-4000-8000-123456789abc" }, expected_versions: { WISE_API_TOKEN: 0 } }, pablo);
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.current).toMatchObject({ updated_by: "theo", version: 1 });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|123456789abc/);
  });

  it("refuses bad input, foreign origins, missing sessions and floods", async () => {
    expect((await post({ action: "save", integration: "stripe", changes: { STRIPE_API_KEY: fakeKey("pk", "fixturepublishable") }, expected_versions: { STRIPE_API_KEY: 1 } })).status).toBe(422);
    expect((await post({ action: "generate", integration: "stripe", field: "STRIPE_API_KEY", expected_version: 1 })).status).toBe(422); // provider values are pasted, not generated
    expect((await post({ action: "save", integration: "stripe", changes: { SESSION_SECRET: "x".repeat(40) }, expected_versions: {} })).status).toBe(422); // bootstrap values are not vault fields
    expect((await post({ action: "rotate" }, theo, { origin: "https://evil.example.com" })).status).toBe(403);
    expect((await vaultGET(req("/api/integrations/vault"))).status).toBe(401);
    resetRateLimits();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await post({ action: "rotate" })).status;
    expect(last).toBe(429);
  });
});

describe("LIVE ports use a value that exists only in the vault (D087)", () => {
  it("Wise 'Test connection' reaches the provider with the vault token; env still wins when set", async () => {
    const wise = new FakeWiseServer();
    wise.token = "3c2c3d4e-0000-4000-8000-123456789abc";
    const url = await wise.start();
    try {
      const env = { CONNECTORS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"), SESSION_SECRET: SECRET };
      const ctx: AppContext = { repo: new InMemoryRepository(), privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "live" };
      await vaultAction(ctx, "theo", { action: "save", integration: "wise", changes: { WISE_API_TOKEN: wise.token }, expected_versions: {} }, "founder", env);
      await refreshConnectorEnv(ctx, { env, force: true });
      ctx.bank = wiseFromEnv({ ...connectorEnvSync({}), WISE_API_BASE_URL: url });
      expect(await testIntegration(ctx, "theo", { key: "wise" })).toMatchObject({ ok: true });
      // An env value (here a wrong one) takes precedence over the vault: unchanged behaviour when env is set.
      ctx.bank = wiseFromEnv({ ...connectorEnvSync({ WISE_API_TOKEN: "0c2c3d4e-0000-4000-8000-000000000000" }), WISE_API_BASE_URL: url });
      expect(await testIntegration(ctx, "theo", { key: "wise" })).toMatchObject({ ok: false });
    } finally {
      await wise.stop();
      resetConnectorCache();
    }
  });
});
