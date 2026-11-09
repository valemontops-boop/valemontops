import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 4B: a mutation is audited and shown in Settings › Diagnostics with health and backups, FR then ES", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  // One mutation through the UI's API (same origin, session cookie), with our own correlation id.
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json", "x-request-id": "e2e-audit-0001" }, body: JSON.stringify({ id: crypto.randomUUID(), text: "Idée e2e audit" }) });
    return { status: r.status, id: r.headers.get("x-request-id") };
  });
  expect(status).toEqual({ status: 200, id: "e2e-audit-0001" });

  await page.goto("/settings");
  await page.getByRole("radio", { name: fr("Diagnostics") }).click();
  await expect(page.getByRole("heading", { name: fr("Health"), exact: true })).toBeVisible();
  await expect(page.getByText(fr("Ready"), { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: fr("Backups"), exact: true })).toBeVisible();
  await expect(page.getByText(re(fr("Demo: no copy of a real spreadsheet is made. The JSON copy contains the demo data.")))).toBeVisible();
  await expect(page.getByRole("button", { name: fr("Back up now") })).toHaveCount(0); // DEMO: nothing to copy, no inert button
  await expect(page.getByRole("heading", { name: fr("Audit log"), exact: true })).toBeVisible();
  await expect(page.getByText("POST /ideas").first()).toBeVisible();
  await expect(page.locator('tr[title="e2e-audit-0001"]')).toHaveCount(1);
  await expect(page.getByText("Idée e2e audit")).toHaveCount(0); // field names only, never values
  // Filter by entity.
  await page.getByLabel(fr("Entity")).selectOption("ideas");
  await expect(page.locator('tr[title="e2e-audit-0001"]')).toHaveCount(1);
  // JSON copy downloads.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: fr("Download a copy (JSON)") }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^valemont-os-backup-\d{4}-\d{2}-\d{2}\.json$/);

  // Pablo reads the same panels in Spanish.
  await page.context().clearCookies();
  await signIn(page, "pablo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: es("Diagnostics") }).click();
  await expect(page.getByRole("heading", { name: es("Audit log"), exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: es("Backups"), exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: es("Health"), exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: es("Download a copy (JSON)") })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Stage 4B: health is public but minimal, security headers and request ids are set", async ({ request }) => {
  const live = await request.get("/api/health?probe=live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toMatchObject({ status: "ok" });
  const ready = await request.get("/api/health", { headers: { "x-request-id": "e2e-health-0001" } });
  expect(ready.status()).toBe(200);
  expect(ready.headers()["x-request-id"]).toBe("e2e-health-0001");
  const body = await ready.json();
  expect(body.checks).toEqual({ process: "ok", config: "ok", sheets: "ok" });
  expect(JSON.stringify(body)).not.toMatch(/secret|example\.com|spreadsheet/i);
  const details = await request.get("/api/health/details");
  expect(details.status()).toBe(401);
  const page = await request.get("/login");
  const h = page.headers();
  expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  expect(h["content-security-policy"]).toMatch(/object-src 'none'/);
  expect(h["strict-transport-security"]).toMatch(/max-age=\d+/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-request-id"]).toBeUndefined(); // /login is not behind the proxy matcher; API and app pages are
  const api = await request.get("/api/sync");
  expect(api.status()).toBe(401);
  expect(api.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("Stage 4B: a cross-site sign-out is refused", async ({ request }) => {
  expect((await request.post("/api/auth/logout", { headers: { origin: "https://evil.example.com" }, maxRedirects: 0 })).status()).toBe(403);
});
