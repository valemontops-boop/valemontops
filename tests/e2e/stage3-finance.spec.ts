import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 3 finance: Théo reads the dashboard, the P&L with drill-down, toggles USD and records an entry that survives a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.getByRole("link", { name: fr("Money") }).first().click();
  await expect(page.getByRole("heading", { name: fr("Money") })).toBeVisible();
  await expect(page.getByText(fr("Cash"), { exact: true })).toBeVisible();
  await expect(page.getByText(fr("Runway"), { exact: true })).toBeVisible();
  await expect(page.getByText(fr("Revenue and costs, 12 months")).first()).toBeVisible();

  await page.getByRole("radio", { name: fr("P&L") }).click();
  await expect(page.getByText(fr("Managerial P&L by month"))).toBeVisible();
  const row = page.getByRole("row", { name: re(fr("Cash received")) });
  await row.getByRole("button").last().click();
  const panel = page.getByRole("complementary", { name: fr("Details") });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: fr("Close details") }).click();

  await page.getByRole("radio", { name: "USD" }).click();
  await expect(page.getByText(re("1.1000"))).toBeVisible();
  await page.getByRole("radio", { name: "EUR" }).click();

  await page.getByRole("radio", { name: fr("Movements") }).click();
  await page.getByRole("button", { name: fr("Add an entry") }).click();
  await page.getByLabel(fr("Amount ex VAT")).fill("12,00");
  await page.getByLabel(fr("Client or supplier")).fill("Papeterie (e2e)");
  await page.getByRole("button", { name: fr("Save") }).click();
  await expect(page.getByText("Papeterie (e2e)")).toBeVisible();
  await page.reload();
  await page.getByRole("radio", { name: fr("Movements") }).click();
  await expect(page.getByText("Papeterie (e2e)")).toBeVisible();

  await page.getByRole("radio", { name: fr("Contracts") }).click();
  await expect(page.getByText(fr("Client contracts"))).toBeVisible();
  await expect(page.getByText(fr("Revenue schedule"))).toBeVisible();
  expect(errors).toEqual([]);
});

test("Stage 3 finance: Pablo sees Money in Spanish", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "pablo");
  await page.getByRole("link", { name: es("Money") }).first().click();
  await expect(page.getByText(es("Runway"), { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: es("P&L") }).click();
  await expect(page.getByText(es("Managerial P&L by month"))).toBeVisible();
  await page.getByRole("radio", { name: es("Contracts") }).click();
  await expect(page.getByText(es("Exchange rates"))).toBeVisible();
  expect(errors).toEqual([]);
});
