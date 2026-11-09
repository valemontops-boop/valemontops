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

test("call mode: before / during / after, undo, objections on any outcome, yes goes to the pipeline with the message card", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/call");
  await page.getByRole("button", { name: fr("Start free session") }).click();
  const outcome = (o: string) => page.getByRole("button", { name: new RegExp(`^${fr(o)}`) });
  // Before: one big Call button. Logging without dialling is one tap away.
  await expect(page.getByRole("button", { name: new RegExp(`^${fr("Call")}`) })).toBeVisible();
  await page.getByRole("button", { name: fr("Already called? Log the outcome") }).click();
  await outcome("No answer").click();
  await expect(page.getByText(fr("No answer"), { exact: true }).last()).toBeVisible();
  // Undo for 10 seconds: the tap no longer counts.
  await page.getByRole("button", { name: new RegExp(`^${fr("Undo")}`) }).click();
  await expect(page.getByText(fr("Undone: the call no longer counts."))).toBeVisible();
  // During: Enter dials, G = too expensive (reply card), 4 = not interested (physical key, works on AZERTY).
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: new RegExp(`^${fr("Hang up")}`) })).toBeVisible();
  const tooExpensive = page.getByRole("button", { name: new RegExp(`^${fr("Too expensive")}`) });
  await page.keyboard.press("g");
  await expect(tooExpensive).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/paie les 99 €/)).toBeVisible(); // live three-step reply from the playbook
  await page.keyboard.press("Digit4");
  await expect(page.getByRole("button", { name: new RegExp(`^${fr("Call")}`) })).toBeVisible(); // next call: back to Before
  // A yes can carry objections too: Enter, D = send me info, X hang up, then 7 = meeting.
  await page.keyboard.press("Enter");
  await page.keyboard.press("d");
  await page.keyboard.press("x");
  await expect(outcome("Meeting booked")).toBeVisible();
  await page.keyboard.press("Digit7");
  await page.getByLabel(fr("Business name")).fill("Carrosserie Rapide (e2e)");
  await page.getByRole("button", { name: fr("Save · {outcome}", { outcome: fr("Meeting booked") }) }).click();
  await expect(page.getByText(fr("{outcome}: added to your pipeline", { outcome: fr("Meeting booked") }))).toBeVisible();
  // The message card is inline, in the founder's language (meeting → confirmation); the missing address is asked right there.
  const card = page.getByRole("region", { name: fr("Message card") });
  await expect(card.getByText(fr("Message for {name}", { name: "Carrosserie Rapide (e2e)" }))).toBeVisible();
  await expect(card.getByLabel(fr("Subject"))).toHaveValue(/Carrosserie Rapide/);
  await expect(card.getByRole("radio", { name: new RegExp(fr("Confirm")) })).toHaveAttribute("aria-checked", "true");
  await card.getByLabel(fr("To")).fill("contact@carrosserie-e2e.example.com");
  await page.context().route("https://mail.google.com/**", (r) => r.fulfill({ body: "Gmail (e2e stub)", contentType: "text/plain" }));
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: new RegExp(fr("Open in Gmail")) }).click();
  await (await popup).close();
  await page.getByRole("button", { name: new RegExp(`^${fr("Yes, sent")}`) }).click();
  await expect(page.getByText(fr("Email sent and logged"))).toBeVisible();
  await page.getByRole("button", { name: fr("End session") }).click();
  await expect(page.getByRole("heading", { name: fr("Session summary") })).toBeVisible();
  await expect(page.getByText(fr("Too expensive")).first()).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: fr("Send me info") })).toContainText(fr("{n} heard · {won} won over", { n: 1, won: 1 })); // still a yes
  await expect(page.getByText(fr("{n} messages sent during this session.", { n: 1 }))).toBeVisible();
  await page.goto("/crm");
  await expect(page.getByRole("region", { name: fr("Meeting booked") })).toContainText("Carrosserie Rapide (e2e)");
});

test("LinkedIn session: follow-ups first, copy the message, one tap per result, limits shown", async ({ page }) => {
  await signIn(page, "pablo");
  await page.goto("/call");
  await page.getByRole("radio", { name: "LinkedIn" }).click();
  await expect(page.getByText(es("LinkedIn follow-ups due"))).toBeVisible();
  await expect(page.getByText(es("Invitations: {n}/{total} today", { n: 0, total: 20 }))).toBeVisible();
  await page.getByRole("button", { name: es("Start the session") }).click();
  await expect(page.getByRole("heading", { level: 1, name: es("LinkedIn session") })).toBeVisible();
  // Follow-ups due come first: an invitation to check (Lucas). "Accepted" brings his first message, first name filled in.
  await expect(page.getByText(es("Check if the invitation was accepted"), { exact: true })).toBeVisible();
  await expect(page.getByText("Lucas Ejemplo").first()).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${es("Accepted")}`) }).click();
  await expect(page.getByText(es("Send the first message"), { exact: true })).toBeVisible();
  await expect(page.getByLabel(es("Message to copy"))).toHaveValue(/Lucas/);
  await page.keyboard.press("m");
  await expect(page.getByText(es("Message sent"), { exact: true }).first()).toBeVisible();
  // Next due: Sara (accepted yesterday). S skips her; then a new prospect, I logs an invitation against the limit.
  await expect(page.getByLabel(es("Message to copy"))).toHaveValue(/Sara/);
  await page.keyboard.press("s");
  await expect(page.getByText(es("New prospect"))).toBeVisible();
  await page.keyboard.press("i");
  await expect(page.getByText(es("Invitations: {n}/{total} today", { n: 1, total: 20 }))).toBeVisible();
  await page.getByRole("button", { name: es("End session") }).click();
  await expect(page.getByRole("heading", { name: es("LinkedIn session summary") })).toBeVisible();
});
