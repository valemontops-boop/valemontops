import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("scenario 13: field visit on a phone with touch only counts one new business and appears in the WhatsApp report", async ({ page }) => {
  await signIn(page, "theo", { tap: true });
  await page.getByRole("button", { name: "Log activity" }).tap();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Field visit" }).tap();
  await dialog.getByRole("button", { name: "Add a new business" }).tap();
  await dialog.getByLabel("Business name").fill("Carrosserie Mobile (e2e)");
  await dialog.getByRole("button", { name: "Met the owner" }).tap();
  await dialog.getByRole("button", { name: "Save" }).tap();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /Logged today/ }).getByText("Field visit")).toBeVisible();

  const day = await (await page.request.get("/api/my-day")).json();
  expect(day.tally.field_visits).toBe(1);
  expect(day.tally.new_businesses).toBe(1);

  await page.getByRole("button", { name: "WhatsApp report" }).tap();
  await page.getByRole("button", { name: "Build report" }).tap();
  await expect(page.getByLabel("Report text")).toHaveValue(/- Field visit: 1/);
  await expect(page.getByLabel("Report text")).toHaveValue(/- New businesses contacted: 1/);
});
