import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("D087: configure the website forms connector in the app — generate once, save and test, FR and ES", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "theo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: fr("Integrations") }).click();
  await expect(page.getByTestId("bootstrap-env").getByText("SESSION_SECRET")).toBeVisible();
  await page.getByTestId("configure-website").click();
  const form = page.getByTestId("connector-form-website");
  await expect(form).toBeVisible();
  await expect(form.getByText(fr("Demo: nothing is really saved. Values are encrypted with a temporary key and never used to reach a real service."))).toBeVisible();
  await expect(form.getByRole("textbox", { name: fr("Form webhook address") })).toHaveValue(/\/api\/webhooks\/website$/);

  // We create the secret: shown once, then only its last 4 characters.
  await form.getByRole("button", { name: fr("Generate") }).click();
  const generated = form.getByTestId("connector-generated");
  await expect(generated).toHaveValue(/^[0-9a-f]{64}$/);
  const value = await generated.inputValue();
  await expect(form.getByTestId("connector-status-WEBSITE_WEBHOOK_SECRET")).toHaveText(re(fr("Set · ends with {tail}", { tail: value.slice(-4) })));
  await expect(form.getByTestId("connector-status-WEBSITE_WEBHOOK_SECRET")).toContainText(value.slice(-4));

  await form.getByRole("button", { name: fr("Save and test") }).click();
  await expect(form.getByTestId("connector-result")).toHaveText(re(fr("It works.")));
  await form.getByRole("button", { name: fr("Close") }).first().click();
  // The hub now says where the value comes from; the secret itself is nowhere on the page.
  await expect(page.getByTestId("integration-website").getByText(re(fr("saved in the app")))).toBeVisible();
  expect(await page.content()).not.toContain(value);

  // Light validation before anything is sent: a publishable Stripe key is refused.
  await page.getByTestId("configure-stripe").click();
  const stripe = page.getByTestId("connector-form-stripe");
  await stripe.getByLabel(fr("Restricted key (read-only)")).fill(["pk", "live", "fixturepublishable"].join("_")) // built at runtime: no key-shaped literal in the repo;
  await expect(stripe.getByText(fr("This is a publishable key (pk_): create a restricted key (rk_) instead."))).toBeVisible();
  await expect(stripe.getByRole("button", { name: fr("Save and test") })).toBeDisabled();

  // Pablo reads it in Spanish.
  await page.context().clearCookies();
  await signIn(page, "pablo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: es("Integrations") }).click();
  await page.getByTestId("configure-tracker").click();
  await expect(page.getByTestId("connector-form-tracker").getByText(es("Tracker address"))).toBeVisible();
  await expect(page.getByTestId("connector-form-tracker").getByRole("button", { name: es("Save and test") })).toBeVisible();
  expect(errors).toEqual([]);
});
