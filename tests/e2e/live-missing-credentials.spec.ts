import { expect, test } from "@playwright/test";
import { fr } from "./helpers";

const LIVE = "http://localhost:3200";

test("scenario 11: LIVE without Google credentials shows a setup error, never a fake save or DEMO fallback", async ({ page, request }) => {
  await page.goto(`${LIVE}/login`);
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByRole("heading", { name: fr("Setup required") })).toBeVisible();
  await expect(page.getByText(/ne bascule pas en Démo/)).toBeVisible();
  await expect(page.getByText(/GOOGLE_SERVICE_ACCOUNT_KEY_BASE64/)).toBeVisible();
  await expect(page.getByText(/Mode Démo/)).toHaveCount(0);

  const save = await request.post(`${LIVE}/api/activities`, { data: { idempotency_key: crypto.randomUUID(), activity_type: "cold_call" } });
  expect(save.status()).toBe(503);
  expect((await save.json()).error).toBe("setup_required");

  const demo = await request.post(`${LIVE}/api/auth/demo`, { form: { founder: "theo" }, maxRedirects: 0 });
  expect(demo.status()).toBe(303);
  expect(demo.headers().location).toContain("/setup");
});

test("D086: /setup lists the bootstrap variables by name (never a value), shows the redirect URIs", async ({ page }) => {
  const res = await page.goto(`${LIVE}/setup`);
  const html = (await res?.text()) ?? "";
  // The server knows SESSION_SECRET; the page must never contain it.
  expect(html).not.toContain("e2e-live-secret-that-is-long-enough-1234567");
  const todo = page.locator("section", { has: page.getByRole("heading", { name: fr("Still to do ({n})", { n: 6 }) }) });
  await expect(todo).toBeVisible();
  for (const name of ["FOUNDER_THEO_EMAIL", "FOUNDER_PABLO_EMAIL", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "SHEETS_SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64"]) {
    await expect(todo.locator(`[data-var="${name}"]`)).toContainText(fr("Missing"));
  }
  const done = page.locator("section", { has: page.getByRole("heading", { name: fr("Already done ({n})", { n: 5 }) }) });
  await expect(done.locator('[data-var="SESSION_SECRET"]')).toContainText(fr("Is set"));
  await expect(done.locator('[data-var="FOUNDER_THEO_TIMEZONE"]')).toContainText(fr("Default value"));
  await expect(page.getByText("http://localhost:3200/api/auth/google/callback", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: fr("Check again") })).toBeVisible();
});
