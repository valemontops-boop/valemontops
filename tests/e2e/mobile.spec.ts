import { expect, test } from "@playwright/test";
import { fr, re, signIn } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("scenario 13: field visit on a phone with touch only counts one new business and appears in the WhatsApp report", async ({ page }) => {
  await signIn(page, "theo", { tap: true });
  await page.getByRole("button", { name: fr("Log activity") }).tap();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: fr("Field visit") }).tap();
  await dialog.getByRole("button", { name: fr("Add a new business") }).tap();
  await dialog.getByLabel(fr("Business name")).fill("Carrosserie Mobile (e2e)");
  await dialog.getByRole("button", { name: fr("Met the owner") }).tap();
  await dialog.getByRole("button", { name: fr("Save") }).tap();
  await expect(page.getByText(fr("Saved"), { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: re(fr("Logged today")) }).getByText(fr("Field visit"))).toBeVisible();

  const day = await (await page.request.get("/api/my-day")).json();
  expect(day.tally.field_visits).toBe(1);
  expect(day.tally.new_businesses).toBe(1);

  await page.getByRole("button", { name: fr("WhatsApp") }).tap();
  await page.getByRole("button", { name: fr("Build report") }).tap();
  await expect(page.getByLabel(fr("Report text"))).toHaveValue(/- Visites terrain : 1/);
  await expect(page.getByLabel(fr("Report text"))).toHaveValue(/- Nouveaux contacts : 1/);
});
