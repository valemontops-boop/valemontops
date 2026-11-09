import { expect, test } from "@playwright/test";
import { es, fr, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("scenario 4: a P0 task for Pablo appears in his day; completing it syncs to Théo", async ({ browser }) => {
  const theo = await (await browser.newContext()).newPage();
  const pablo = await (await browser.newContext()).newPage();
  await signIn(theo, "theo");
  await theo.goto("/tasks");
  await theo.getByRole("button", { name: fr("New task") }).click();
  const d = theo.getByRole("dialog");
  await d.getByLabel(fr("Title")).fill("Send Spanish price sheet (e2e)");
  await d.getByLabel(fr("Owner")).selectOption("pablo");
  await d.getByLabel(fr("Priority")).selectOption("P0");
  await d.getByRole("button", { name: fr("Add task") }).click();
  await expect(theo.getByText(fr("Saved"), { exact: true })).toBeVisible();

  await signIn(pablo, "pablo");
  const sales = pablo.getByRole("region", { name: es("Sales") });
  await expect(sales.getByText("Send Spanish price sheet (e2e)")).toBeVisible();
  await sales.getByRole("checkbox", { name: es("Complete {title}", { title: "Send Spanish price sheet (e2e)" }) }).click();
  await expect(sales.getByText("Send Spanish price sheet (e2e)")).toHaveCount(0);

  await theo.goto("/tasks");
  await theo.getByRole("radio", { name: fr("Assigned to {name}", { name: "Pablo" }) }).click();
  await expect(theo.getByRole("checkbox", { name: fr("Reopen {title}", { title: "Send Spanish price sheet (e2e)" }) })).toBeVisible();
});

test("scenario 17: Pablo sees Théo's private event only as Busy", async ({ page }) => {
  await signIn(page, "pablo");
  const r = await page.request.get("/api/agenda");
  const body = await r.text();
  expect(body).not.toContain("Rendez-vous perso (privé)");
  expect(body).toContain('"title":"Busy"');
  await page.goto("/agenda");
  await expect(page.getByText(es("Busy")).first()).toBeVisible();
  await expect(page.getByText("Rendez-vous perso (privé)")).toHaveCount(0);
});

test("scenario 18 (UI): founder point offers free slots and lands in the shared calendar", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/agenda");
  await page.getByRole("button", { name: fr("Schedule founder point") }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByRole("radio")).toHaveCount(3);
  await d.getByRole("radio").first().check();
  await d.getByRole("button", { name: fr("Add to calendar") }).click();
  await expect(page.getByText(fr("Added to the Valemont calendar"))).toBeVisible();
  await expect(page.getByRole("complementary", { name: fr("Details") }).getByRole("heading", { name: fr("Weekly review") })).toBeVisible();
});

test("scenario 19: a third idea in Testing during the sprint asks which one to park", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/ideas");
  await page.getByRole("textbox", { name: fr("New idea") }).fill("Referral bonus for garages (e2e)");
  await page.getByRole("button", { name: fr("Add idea") }).click();
  const row = page.getByRole("listitem").filter({ hasText: fr("Referral bonus for garages (e2e)") });
  await row.getByLabel(fr("Status")).selectOption("testing");
  await expect(page.getByRole("dialog", { name: fr("Park one idea first") })).toBeVisible();
  await page.getByRole("button", { name: fr("Park “{text}”", { text: "Proposer un pilote gratuit de 14 jours aux garages" }) }).click();
  await expect(page.getByRole("region", { name: fr("Parked") })).toContainText("Proposer un pilote gratuit de 14 jours aux garages");
});

test("scenario 20 (UI): upload asks for the founder's own Drive permission first", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/files");
  await expect(page.getByText(fr("Valemont Local pitch FR (demo).pdf"))).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: fr("note.txt"), mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("link", { name: fr("Allow Drive access") })).toBeVisible();
});

test("scenario 23: Command Center Now shows exactly five primary numbers", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/command-center");
  const nums = page.getByTestId("primary-numbers");
  await expect(nums.locator(":scope > div")).toHaveCount(5);
  await expect(nums).toContainText(fr("Not tracked yet"));
  for (const tab of ["Sales", "Money", "Content"]) {
    await page.getByRole("radio", { name: fr(tab) }).click();
    await expect(page.getByRole("radio", { name: fr(tab) })).toHaveAttribute("aria-checked", "true");
  }
  await expect(page.getByText(fr("Audience, latest figures"))).toBeVisible();
});

test("call mode: objections on any outcome, one-key outcomes, yes goes to the pipeline with a message ready", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/call");
  await page.getByRole("button", { name: fr("Start free session") }).click();
  const outcome = (o: string) => page.getByRole("button", { name: new RegExp(`^${fr(o)}`) });
  await outcome("No answer").click();
  await expect(page.getByText(fr("No answer"), { exact: true }).last()).toBeVisible();
  // A refusal with its objection, by keyboard: G = too expensive, 4 = not interested (physical key, works on AZERTY).
  const tooExpensive = page.getByRole("button", { name: new RegExp(`^${fr("Too expensive")}`) });
  await expect(tooExpensive).toBeVisible();
  await page.keyboard.press("g");
  await expect(tooExpensive).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/paie les 99 €/)).toBeVisible(); // live three-step reply from the playbook
  await page.keyboard.press("Digit4");
  await expect(tooExpensive).toHaveAttribute("aria-pressed", "false");
  // A yes can carry objections too: D = send me info, then 7 = meeting.
  await page.keyboard.press("d");
  await page.keyboard.press("Digit7");
  await page.getByLabel(fr("Business name")).fill("Carrosserie Rapide (e2e)");
  await page.getByRole("button", { name: fr("Save · {outcome}", { outcome: fr("Meeting booked") }) }).click();
  await expect(page.getByText(fr("{outcome}: added to your pipeline", { outcome: fr("Meeting booked") }))).toBeVisible();
  // The message for the person just called is ready (meeting → confirmation); E opens it in their language.
  await expect(page.getByText(fr("Message for {name}", { name: "Carrosserie Rapide (e2e)" }), { exact: false })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByLabel(fr("Subject"))).toHaveValue(/Carrosserie Rapide/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: fr("End session") }).click();
  await expect(page.getByRole("heading", { name: fr("Session summary") })).toBeVisible();
  await expect(page.getByText(fr("Too expensive")).first()).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: fr("Send me info") })).toContainText(fr("{n} heard · {won} won over", { n: 1, won: 1 })); // still a yes
  await page.goto("/crm");
  await expect(page.getByRole("region", { name: fr("Meeting booked") })).toContainText("Carrosserie Rapide (e2e)");
});
