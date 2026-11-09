import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 3 content: Théo plans a concept, schedules and publishes the French version, enters its 24 h numbers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.goto("/marketing/content");
  await expect(page.getByRole("heading", { name: fr("Content Studio") })).toBeVisible();
  await expect(page.getByRole("button", { name: re("Ce que révèle un audit (démo)") })).toBeVisible();

  await page.getByRole("button", { name: fr("New piece") }).click();
  await page.getByLabel(fr("Title")).fill("Concept e2e Reel");
  await page.getByLabel(fr("Hook")).fill("Accroche e2e");
  await page.getByRole("button", { name: fr("Create") }).click();
  const panel = page.getByRole("complementary", { name: fr("Details") });
  await expect(panel.getByText("Concept e2e Reel").first()).toBeVisible();

  const day = new Date().toLocaleDateString("en-CA");
  await panel.getByLabel(fr("Publishing date")).fill(day);
  await panel.getByRole("button", { name: fr("Schedule") }).click();
  await expect(panel.getByRole("button", { name: fr("Unschedule") })).toBeVisible();
  await panel.getByLabel(fr("Post link (once it is out)")).fill("https://www.instagram.com/reel/e2e-fr/");
  await panel.getByRole("button", { name: fr("Mark as published") }).click();
  await expect(panel.getByRole("heading", { name: fr("Numbers at a fixed age") })).toBeVisible();
  await panel.getByLabel(fr("Views"), { exact: true }).fill("500");
  await panel.getByLabel(fr("Link clicks")).fill("7");
  await panel.getByRole("button", { name: fr("Save the numbers") }).click();
  await expect(panel.getByText(fr("entered by hand")).first()).toBeVisible();

  await page.reload();
  await page.getByRole("radio", { name: fr("Results") }).click();
  await expect(page.getByRole("button", { name: re("FR · Concept e2e Reel") })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Stage 3 content: Pablo reaches the studio from Growth, in Spanish, and reads the calendar and checklists", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "pablo");
  await page.getByRole("link", { name: es("Growth") }).first().click();
  await page.locator('[data-shortcut="content"]').click();
  await page.getByRole("link", { name: es("Open the Content Studio") }).click();
  await expect(page.getByRole("heading", { name: es("Content Studio") })).toBeVisible();
  await page.getByRole("radio", { name: es("Calendar") }).click();
  await expect(page.getByText(es("Free slot")).first()).toBeVisible();
  await page.getByRole("radio", { name: es("Checklists") }).click();
  await expect(page.getByRole("heading", { name: es("Publishing checklist") })).toBeVisible();
  await page.getByRole("radio", { name: es("Batch production") }).click();
  await expect(page.getByRole("button", { name: re(es("Move selected to {stage}", { stage: es("Editing") })) })).toBeVisible();
  expect(errors).toEqual([]);
});
