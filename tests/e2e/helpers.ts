import { expect, type Page } from "@playwright/test";

export const DEMO_CODE = "e2e-access-code-123";

export async function signIn(page: Page, founder: "theo" | "pablo", opts: { tap?: boolean } = {}) {
  await page.goto("/login");
  await page.getByLabel("Demo access code").fill(DEMO_CODE);
  const btn = page.getByRole("button", { name: founder === "theo" ? "Continue as Théo (demo)" : "Continue as Pablo (demo)" });
  if (opts.tap) await btn.tap();
  else await btn.click();
  await expect(page).toHaveURL(/\/my-day/);
  await expect(page.getByRole("heading", { name: "My Day" })).toBeVisible();
}
