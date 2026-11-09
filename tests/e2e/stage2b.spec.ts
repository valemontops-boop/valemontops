import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 2B: Théo opens a demo project, sees its margin and alerts, adds a milestone that survives a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.getByRole("link", { name: fr("Clients") }).first().click();
  await expect(page.getByRole("heading", { name: fr("Clients") })).toBeVisible();
  const card = page.getByRole("button", { name: re("Toitures Leroy") }).first();
  await expect(card).toBeVisible();
  await card.click();
  const panel = page.getByRole("complementary", { name: fr("Details") });
  await expect(panel.getByRole("heading", { name: fr("Costs and margin") })).toBeVisible();
  await expect(panel.getByRole("list", { name: fr("Alerts") }).getByText(re(fr("Diagnostic shared")))).toBeVisible();
  await panel.getByPlaceholder(fr("New milestone")).fill("Revue intermédiaire (e2e)");
  await panel.getByRole("button", { name: fr("Add") }).first().click();
  await expect(panel.getByText("Revue intermédiaire (e2e)")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: fr("Details") }).getByText("Revue intermédiaire (e2e)")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Stage 2B: Local subscriptions and registries in Spanish for Pablo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "pablo");
  await page.getByRole("link", { name: es("Clients") }).first().click();
  await expect(page.getByRole("heading", { name: es("Clients") })).toBeVisible();
  await page.getByRole("radio", { name: es("Local subscriptions") }).click();
  await expect(page.getByText("Electricidad Vega (demo)", { exact: true })).toBeVisible();
  await expect(page.getByText(es("Contribution margin"))).toBeVisible();
  await page.getByRole("radio", { name: es("Partners & tools") }).click();
  await expect(page.getByText("Camille Exemple (demo)", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: es("Software and AI tools") }).click();
  await expect(page.getByText("API de modèle de langage (démo)")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Stage 2B: a won deal shows its project from the CRM", async ({ page }) => {
  await signIn(page, "theo");
  const r = await page.request.get("/api/clients");
  const body = (await r.json()) as { projects: { name: string; opportunity_id: string; account_id: string }[] };
  const p = body.projects.find((x) => x.name === "Toitures Leroy");
  expect(p).toBeTruthy();
  const won = await page.request.get(`/api/clients/won?opportunity_id=${p!.opportunity_id}`);
  expect((await won.json()).status).toBe("done");
  // Retrying the workflow is a no-op (scenario 7, idempotent): still one project for that deal.
  const again = await page.request.post("/api/clients/won", { data: { opportunity_id: p!.opportunity_id }, headers: { origin: "http://localhost:3100" } });
  expect((await again.json()).alreadyDone).toBe(true);
  const after = (await (await page.request.get("/api/clients")).json()) as typeof body;
  expect(after.projects.filter((x) => x.opportunity_id === p!.opportunity_id)).toHaveLength(1);
  await page.goto(`/crm?account=${p!.account_id}`);
  await expect(page.getByRole("link", { name: fr("Open the project") })).toBeVisible();
});
