import { expect, test } from "@playwright/test";
import { es, fr, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("Stage 2A: audit → quote → approve → PDF → sent, in French (Théo)", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/crm");
  await page.getByText("Chauffage Morel").first().click();
  await page.getByRole("link", { name: fr("Start the audit") }).click();
  await expect(page).toHaveURL(/\/crm\/deal\?opp=/);
  await page.getByRole("button", { name: fr("Start the audit") }).click();
  await page.getByLabel("Combien d'appels manquez-vous par semaine (estimation) ?").fill("12");
  await page.getByRole("button", { name: fr("Save answers") }).click();
  const summary = page.getByRole("region", { name: fr("Opportunity summary") });
  await expect(summary.getByText("12 appels manqués par semaine, donc des demandes perdues.")).toBeVisible();
  await expect(summary.getByText(fr("draft to validate")).first()).toBeVisible();
  await summary.getByRole("button", { name: fr("Go to the quote") }).click();
  await page.getByRole("button", { name: fr("Create the quote from the audit") }).click();
  await page.getByLabel(fr("Contract term (months)")).fill("12");
  await page.getByRole("button", { name: fr("Save the draft") }).click();
  await expect(page.getByRole("button", { name: fr("Save the draft") })).toBeDisabled();
  await page.getByRole("button", { name: fr("Approve"), exact: true }).click();
  await expect(page.getByRole("button", { name: fr("I sent it to the client") })).toBeVisible();
  // PDF from the Node route handler (pdf-lib).
  const opp = new URL(page.url()).searchParams.get("opp")!;
  const ws = await (await page.request.get(`/api/quotes?opportunity_id=${opp}`)).json();
  const pdf = await page.request.get(`/api/quotes/pdf?id=${ws.quotes[0].id}&download=1`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: fr("I sent it to the client") }).click();
  await expect(page.getByRole("button", { name: fr("Client accepted") })).toBeVisible();
});

test("Stage 2A: Pablo's workspace is in Spanish", async ({ page }) => {
  await signIn(page, "pablo");
  await page.goto("/crm");
  await page.getByText("Fontanería Ruiz").first().click();
  await page.getByRole("link", { name: es("Start the audit") }).click();
  await expect(page.getByRole("button", { name: es("Start the audit") })).toBeVisible();
  await page.getByRole("radio", { name: es("Note templates") }).click();
  await expect(page.getByRole("textbox", { name: es("Note templates") })).toHaveValue(/Llamada de descubrimiento/);
});
