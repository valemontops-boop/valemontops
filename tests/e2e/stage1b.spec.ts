import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("scenario 4: a P0 task for Pablo appears in his day; completing it syncs to Théo", async ({ browser }) => {
  const theo = await (await browser.newContext()).newPage();
  const pablo = await (await browser.newContext()).newPage();
  await signIn(theo, "theo");
  await theo.goto("/tasks");
  await theo.getByRole("button", { name: "New task" }).click();
  const d = theo.getByRole("dialog");
  await d.getByLabel("Title").fill("Send Spanish price sheet (e2e)");
  await d.getByLabel("Owner").selectOption("pablo");
  await d.getByLabel("Priority").selectOption("P0");
  await d.getByRole("button", { name: "Add task" }).click();
  await expect(theo.getByText("Saved", { exact: true })).toBeVisible();

  await signIn(pablo, "pablo");
  const sales = pablo.getByRole("region", { name: "Sales" });
  await expect(sales.getByText("Send Spanish price sheet (e2e)")).toBeVisible();
  await sales.getByRole("checkbox", { name: "Complete Send Spanish price sheet (e2e)" }).click();
  await expect(sales.getByText("Send Spanish price sheet (e2e)")).toHaveCount(0);

  await theo.goto("/tasks");
  await theo.getByRole("radio", { name: "Assigned to Pablo" }).click();
  await expect(theo.getByRole("checkbox", { name: "Reopen Send Spanish price sheet (e2e)" })).toBeVisible();
});

test("scenario 17: Pablo sees Théo's private event only as Busy", async ({ page }) => {
  await signIn(page, "pablo");
  const r = await page.request.get("/api/agenda");
  const body = await r.text();
  expect(body).not.toContain("Job interview (private)");
  expect(body).toContain('"title":"Busy"');
  await page.goto("/agenda");
  await expect(page.getByText("Busy").first()).toBeVisible();
  await expect(page.getByText("Job interview (private)")).toHaveCount(0);
});

test("scenario 18 (UI): founder point offers free slots and lands in the shared calendar", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Schedule founder point" }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByRole("radio")).toHaveCount(3);
  await d.getByRole("radio").first().check();
  await d.getByRole("button", { name: "Add to calendar" }).click();
  await expect(page.getByText("Added to the Valemont calendar")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Details" }).getByRole("heading", { name: "Weekly review" })).toBeVisible();
});

test("scenario 19: a third idea in Testing during the sprint asks which one to park", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/ideas");
  await page.getByRole("textbox", { name: "New idea" }).fill("Referral bonus for garages (e2e)");
  await page.getByRole("button", { name: "Add idea" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Referral bonus for garages (e2e)" });
  await row.getByLabel("Status").selectOption("testing");
  await expect(page.getByRole("dialog", { name: "Park one idea first" })).toBeVisible();
  await page.getByRole("button", { name: /^Park “Offer a 14-day free pilot/ }).click();
  await expect(page.getByRole("region", { name: "Parked" })).toContainText("Offer a 14-day free pilot to garages");
});

test("scenario 20 (UI): upload asks for the founder's own Drive permission first", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/files");
  await expect(page.getByText("Valemont Local pitch FR (demo).pdf")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("link", { name: "Allow Drive access" })).toBeVisible();
});

test("scenario 23: Command Center Now shows exactly five primary numbers", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/command-center");
  const nums = page.getByTestId("primary-numbers");
  await expect(nums.locator(":scope > div")).toHaveCount(5);
  await expect(nums).toContainText("Not tracked yet");
  for (const tab of ["Sales", "Money", "Content"]) {
    await page.getByRole("radio", { name: tab }).click();
    await expect(page.getByRole("radio", { name: tab })).toHaveAttribute("aria-checked", "true");
  }
  await expect(page.getByText("Audience, latest figures")).toBeVisible();
});

test("call mode: free dialling counts refusals by tap and puts the yes in the pipeline", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/call");
  await page.getByRole("button", { name: "Start free session" }).click();
  await page.getByRole("button", { name: /^No answer/ }).click();
  await expect(page.getByText("No answer", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: /^Not interested/ }).click();
  await page.getByRole("button", { name: "Too expensive" }).click();
  await expect(page.getByText("Why? (one tap)")).toHaveCount(0); // saved
  await expect(page.getByRole("button", { name: /^Meeting booked/ })).toBeEnabled();
  await page.keyboard.press("7"); // Meeting booked
  await page.getByLabel("Business name").fill("Carrosserie Rapide (e2e)");
  await page.getByRole("button", { name: /^Save · Meeting booked/ }).click();
  await expect(page.getByText("Meeting booked: added to your pipeline")).toBeVisible();
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByRole("heading", { name: "Session summary" })).toBeVisible();
  await expect(page.getByText("Too expensive")).toBeVisible();
  await page.goto("/crm");
  await expect(page.getByRole("region", { name: "Meeting booked" })).toContainText("Carrosserie Rapide (e2e)");
});
