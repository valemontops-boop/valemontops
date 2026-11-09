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
