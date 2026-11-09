import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Content Studio: Théo writes a LinkedIn post, sees the live score, schedules, publishes and enters its 24 h numbers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.goto("/marketing/content");
  await expect(page.getByRole("heading", { name: fr("Content Studio") })).toBeVisible();
  await expect(page.getByRole("button", { name: re("Ce que révèle un audit (démo)") })).toBeVisible();

  // One-line idea straight on the board.
  await page.getByLabel(fr("Quick idea")).fill("Idée e2e en une ligne");
  await page.getByRole("button", { name: fr("Add the idea") }).click();
  await expect(page.locator('[data-column="idea"]').getByText("Idée e2e en une ligne")).toBeVisible();

  // Full post on Théo's LinkedIn profile.
  await page.getByRole("button", { name: fr("New content") }).click();
  await page.getByLabel(fr("Title")).fill("Post e2e LinkedIn");
  await page.getByRole("checkbox", { name: "LinkedIn Théo FR" }).check();
  await page.getByRole("button", { name: fr("Write the post") }).click();
  const composer = page.locator("[data-composer]");
  await expect(composer.getByRole("heading", { name: "Post e2e LinkedIn" })).toBeVisible();
  const score = composer.locator("[data-score]");
  const before = Number(await score.getAttribute("data-score"));
  await composer.getByLabel(fr("Hook"), { exact: true }).fill("3 leçons de 40 appels à froid cette semaine.");
  await composer.getByLabel(fr("Body / caption")).fill("1. Appeler avant 9 h.\n\n2. Parler de leur chantier, pas de nous.\n\n3. Un non poli est une porte ouverte pour dans trois mois.");
  await composer.getByRole("textbox", { name: fr("Call to action") }).fill("Et vous, quelle phrase ouvre la conversation ?");
  await expect.poll(async () => Number(await score.getAttribute("data-score"))).toBeGreaterThan(before);
  await expect(composer.getByText(fr("Saved")).first()).toBeVisible({ timeout: 10_000 });

  const day = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA");
  await composer.getByLabel(fr("Publishing date")).fill(day);
  await composer.getByLabel(fr("Time"), { exact: true }).fill("08:30");
  await composer.getByRole("button", { name: fr("Schedule"), exact: true }).click();
  await expect(composer.getByRole("button", { name: fr("Unschedule") })).toBeVisible();
  await expect(composer.getByRole("button", { name: fr("Copy the caption") })).toBeVisible();
  await composer.getByLabel(fr("Post link (once it is out)")).fill("https://www.linkedin.com/feed/update/e2e-fr/");
  await composer.getByRole("button", { name: fr("Mark as published") }).click();
  await expect(composer.getByRole("heading", { name: fr("Numbers at a fixed age") })).toBeVisible();
  await composer.getByLabel(fr("Impressions"), { exact: true }).fill("500");
  await composer.getByLabel(fr("Link clicks")).fill("7");
  await composer.getByRole("button", { name: fr("Save the numbers") }).click();
  await expect(composer.getByText(fr("entered by hand")).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("radio", { name: fr("Results") }).click();
  await expect(page.getByRole("button", { name: re("FR · Post e2e LinkedIn") })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Content Studio: Pablo reaches the studio from Growth in Spanish, filters, plans by week and month, picks media in Drive", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "pablo");
  await page.getByRole("link", { name: es("Growth") }).first().click();
  await page.locator('[data-shortcut="content"]').click();
  await page.getByRole("link", { name: es("Open the Content Studio") }).click();
  await expect(page.getByRole("heading", { name: es("Content Studio") })).toBeVisible();

  await page.getByLabel(es("Type")).selectOption("carousel");
  await expect(page.getByRole("button", { name: re("3 erreurs des artisans") })).toBeVisible();
  await expect(page.getByRole("button", { name: re("Ce que révèle un audit") })).toHaveCount(0);
  await page.getByRole("button", { name: es("Clear filters") }).click();

  await page.getByRole("radio", { name: es("Planning") }).click();
  await expect(page.getByRole("button", { name: re(es("Recommended slot")) }).first()).toBeVisible();
  await page.getByRole("radio", { name: es("Month") }).click();
  await expect(page.locator("td[data-day]").first()).toBeVisible();
  await page.getByRole("radio", { name: es("Checklists") }).click();
  await expect(page.getByRole("heading", { name: es("Publishing checklist") })).toBeVisible();

  await page.getByRole("radio", { name: es("Board") }).click();
  await page.getByRole("button", { name: re("3 erreurs des artisans") }).click();
  const composer = page.locator("[data-composer]");
  await composer.getByRole("button", { name: es("Pick in Drive") }).click();
  const picker = page.getByRole("dialog", { name: es("Pick in Drive") });
  await picker.getByRole("button", { name: "Contenu" }).click();
  await picker.getByRole("button", { name: "Visuels" }).click();
  await picker.getByRole("button", { name: re("Carrousel 3 erreurs 1") }).click();
  await picker.getByRole("button", { name: re("Carrousel 3 erreurs 2") }).click();
  await picker.getByRole("button", { name: es("Add ({n})", { n: 2 }) }).click();
  await expect(composer.getByRole("link", { name: re("Carrousel 3 erreurs 2") })).toBeVisible();
  await expect(composer.getByText(es("Saved")).first()).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
