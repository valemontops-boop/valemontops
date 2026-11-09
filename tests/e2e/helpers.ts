import { expect, type Page } from "@playwright/test";
import { translate } from "../../src/i18n";

export const DEMO_CODE = "e2e-access-code-123";
/** The UI has no English (D048): Théo reads French, Pablo Spanish. Tests keep English keys and translate them. */
export const fr = (s: string, v?: Record<string, string | number>) => translate("fr", s, v);
export const es = (s: string, v?: Record<string, string | number>) => translate("es", s, v);
/** RegExp from a translated text (special characters escaped). */
export const re = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

export async function signIn(page: Page, founder: "theo" | "pablo", opts: { tap?: boolean } = {}) {
  await page.goto("/login");
  // The login page has no founder yet: French unless the browser asks for Spanish.
  await page.getByLabel(fr("Demo access code")).fill(DEMO_CODE);
  const btn = page.getByRole("button", { name: fr("Continue as {name} (demo)", { name: founder === "theo" ? "Théo" : "Pablo" }) });
  if (opts.tap) await btn.tap();
  else await btn.click();
  await expect(page).toHaveURL(/\/my-day/);
  await expect(page.getByRole("heading", { name: (founder === "theo" ? fr : es)("My Day") })).toBeVisible();
}
