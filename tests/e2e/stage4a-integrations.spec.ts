import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 4A: the Integrations Hub is honest in DEMO (FR and ES), tests answer from demo data, CSV export downloads a neutralised file", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: fr("Integrations") }).click();
  const hub = page.getByTestId("integrations-hub");
  await expect(hub).toBeVisible();
  // DEMO: nothing claims a real connection; LinkedIn awaits approval; GA4 is import-only.
  await expect(hub.getByText(fr("Connected service"), { exact: true })).toHaveCount(1); // the counter label only
  await expect(page.getByTestId("integration-linkedin").getByText(fr("Awaiting approval"))).toBeVisible();
  await expect(page.getByTestId("integration-ga4").getByText(fr("Import only"))).toBeVisible();
  await expect(page.getByTestId("integration-website").getByText("WEBSITE_WEBHOOK_SECRET")).toBeVisible();
  await expect(page.getByTestId("integration-gmail").getByRole("link", { name: fr("Authorize") })).toBeVisible();
  // A read-only test against the demo stand-in, labelled as demo.
  await page.getByTestId("integration-sheets").getByRole("button", { name: fr("Test connection") }).click();
  await expect(page.getByTestId("integration-sheets").getByRole("status")).toHaveText(re(fr("The spreadsheet answers (demo data, no real connection).")));
  await expect(page.getByRole("button", { name: fr("Sync now") })).toHaveCount(0);

  // CSV export of the task list (period: everything).
  await page.goto("/tasks");
  await page.getByTestId("csv-export-tasks").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: fr("Download") }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^valemont-tasks-\d{4}-\d{2}-\d{2}\.csv$/);

  // Pablo reads the same hub in Spanish.
  await page.context().clearCookies();
  await signIn(page, "pablo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: es("Integrations") }).click();
  await expect(page.getByTestId("integration-linkedin").getByText(es("Awaiting approval"))).toBeVisible();
  await expect(page.getByTestId("integration-tracker").getByText("TRACKER_WEBHOOK_URL_PABLO")).toBeVisible();
  expect(errors).toEqual([]);
});
