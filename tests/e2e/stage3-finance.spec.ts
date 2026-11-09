import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 3 finance: Théo reads the dashboard, the P&L with drill-down (all in EUR, no currency switch: D082) and records an entry that survives a reload", async ({ page }) => {
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

  await expect(page.getByRole("radio", { name: "USD" })).toHaveCount(0);

  await page.getByRole("radio", { name: fr("Movements") }).click();
  await page.getByRole("button", { name: fr("Add an entry") }).click();
  // D085: USD only to pay a supplier (no display switch); EUR stays the default.
  await expect(page.getByLabel(fr("Currency"))).toHaveValue("EUR");
  await expect(page.getByLabel(fr("Currency")).locator("option")).toHaveCount(2);
  await page.getByLabel(fr("Amount ex VAT")).fill("12,00");
  await page.getByLabel(fr("Client or supplier")).fill("Papeterie (e2e)");
  await page.getByRole("button", { name: fr("Save") }).click();
  await expect(page.getByText("Papeterie (e2e)")).toBeVisible();
  await page.reload();
  await page.getByRole("radio", { name: fr("Movements") }).click();
  await expect(page.getByText("Papeterie (e2e)")).toBeVisible();
  await expect(page.getByText(fr("Contractors paid in USD"))).toBeVisible();
  await expect(page.getByText(fr("demo rate")).first()).toBeVisible(); // the demo USD entry: "120 $US ≈ 110,40 € (taux démo)"

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
  await expect(page.getByText(es("Client contracts"))).toBeVisible();
  await expect(page.getByText("Tipos de cambio")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("D091: the whole Wise history is imported once by the page, Movements filter since the start, P&L by year (FR then ES)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.getByRole("link", { name: fr("Money") }).first().click();
  await page.getByRole("radio", { name: fr("Movements") }).click();
  await expect(page.getByText(fr("History since the account was opened"))).toBeVisible();
  // Started automatically after the first sync (the demo Wise holds ~2 years); the status line ends with "Terminé."
  await expect(page.getByRole("status").filter({ hasText: "Terminé" })).toBeVisible({ timeout: 20_000 });
  const period = page.getByLabel(fr("Period"));
  await expect(period.locator("option").first()).toHaveText(/Depuis le début/);
  expect(await period.locator("option").count()).toBeGreaterThanOrEqual(4); // all, 12 months, ≥ 2 years
  await expect(page.getByText(fr("Expenses by category over the period"))).toBeVisible();
  await page.getByLabel(fr("Category")).first().selectOption("software");
  await expect(page.getByText(fr("Expenses"), { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: fr("P&L") }).click();
  await page.getByRole("radio", { name: fr("By year") }).click();
  await expect(page.getByText(fr("Managerial P&L by year"))).toBeVisible();
  await expect(page.getByRole("columnheader", { name: fr("Since the start") })).toBeVisible();

  await signIn(page, "pablo");
  await page.getByRole("link", { name: es("Money") }).first().click();
  await page.getByRole("radio", { name: es("Movements") }).click();
  await expect(page.getByText(es("History since the account was opened"))).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Terminado" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(es("Period")).locator("option").first()).toHaveText(/Desde el principio/);
  await page.getByRole("radio", { name: es("P&L") }).click();
  await page.getByRole("radio", { name: es("By year") }).click();
  await expect(page.getByRole("columnheader", { name: es("Since the start") })).toBeVisible();
  expect(errors).toEqual([]);
});
