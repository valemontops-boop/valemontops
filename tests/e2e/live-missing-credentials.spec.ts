import { expect, test } from "@playwright/test";

const LIVE = "http://localhost:3200";

test("scenario 11: LIVE without Google credentials shows a setup error, never a fake save or DEMO fallback", async ({ page, request }) => {
  await page.goto(`${LIVE}/login`);
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByRole("heading", { name: "Setup required" })).toBeVisible();
  await expect(page.getByText(/does not fall back to DEMO/)).toBeVisible();
  await expect(page.getByText(/GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is missing/)).toBeVisible();
  await expect(page.getByText("DEMO mode")).toHaveCount(0);

  const save = await request.post(`${LIVE}/api/activities`, { data: { idempotency_key: crypto.randomUUID(), activity_type: "cold_call" } });
  expect(save.status()).toBe(503);
  expect((await save.json()).error).toBe("setup_required");

  const demo = await request.post(`${LIVE}/api/auth/demo`, { form: { founder: "theo" }, maxRedirects: 0 });
  expect(demo.status()).toBe(303);
  expect(demo.headers().location).toContain("/setup");
});
