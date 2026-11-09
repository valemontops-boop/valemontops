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

test("call mode: new call → picked up / not picked up, objections, instant mail while on the phone, downsell ladder, hung up → outcome", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/call");
  await page.getByRole("button", { name: fr("Start free session") }).click();
  const outcome = (o: string) => page.getByRole("button", { name: new RegExp(`^${fr(o)}`) });
  const newCall = page.getByRole("button", { name: new RegExp(`^${fr("New call")}`) });
  // Not picked up: Enter = new call, 2 = not picked up, then no answer / voicemail. Undo for 10 seconds.
  await expect(newCall).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(outcome("They picked up")).toBeVisible();
  await page.keyboard.press("Digit2");
  await outcome("No answer").click();
  await expect(newCall).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${fr("Undo")}`) }).click();
  await expect(page.getByText(fr("Undone: the call no longer counts."))).toBeVisible();

  // Picked up: G = too expensive (reply card), O = offer Local, N = no → 30/30, N = no; X hung up; 4 = not interested.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Digit1");
  await expect(page.getByRole("button", { name: new RegExp(`^${fr("Hung up")}`) })).toBeVisible();
  await page.keyboard.press("g");
  await expect(page.getByRole("button", { name: new RegExp(`^${fr("Too expensive")}`) })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/paie les 99 €/)).toBeVisible(); // live three-step reply from the playbook
  await page.keyboard.press("o");
  await expect(page.getByText(/Valemont Local, 100 € par mois/)).toBeVisible(); // Local pitch, price from the setting
  await page.keyboard.press("n");
  await expect(page.getByText(fr("Offer 30/30"))).toBeVisible();
  await page.keyboard.press("n");
  await expect(page.getByText(fr("No to Local and 30/30"))).toBeVisible();
  await page.keyboard.press("x");
  await expect(outcome("Yes Local")).toBeVisible(); // offered on the ladder, so it is an outcome
  await expect(outcome("Yes 30/30")).toBeVisible();
  await page.keyboard.press("Digit4");
  await expect(newCall).toBeVisible();

  // "Send me info" while on the phone: the instant mail opens, the address is typed as they spell it, one click sends.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Digit1");
  await page.keyboard.press("d");
  const mail = page.getByRole("group", { name: fr("Instant mail") });
  await mail.getByRole("button", { name: fr("Deck"), exact: true }).click();
  await mail.getByLabel(fr("Their email address")).fill("contact@carrosserie-e2e.example.com");
  await mail.getByLabel(fr("Business"), { exact: true }).fill("Carrosserie Rapide (e2e)");
  await page.context().route("https://mail.google.com/**", (r) => r.fulfill({ body: "Gmail (e2e stub)", contentType: "text/plain" }));
  const popup = page.waitForEvent("popup");
  await mail.getByRole("button", { name: new RegExp(`^${fr("Send · {name}", { name: fr("Deck") })}`) }).click();
  await (await popup).close();
  await page.getByRole("button", { name: new RegExp(`^${fr("Yes, sent")}`) }).click();
  await expect(page.getByText(fr("Email sent and logged"))).toBeVisible();
  await expect(page.getByRole("button", { name: `${fr("Deck")} · ${fr("sent")}` })).toBeVisible();
  // Still on the phone: hang up, 1 = meeting; the business typed for the mail is already there.
  await page.keyboard.press("x");
  await page.keyboard.press("Digit1");
  await expect(page.getByLabel(fr("Business name"))).toHaveValue("Carrosserie Rapide (e2e)");
  await page.getByRole("button", { name: fr("Save · {outcome}", { outcome: fr("Meeting booked") }) }).click();
  await expect(page.getByText(fr("{outcome}: added to your pipeline", { outcome: fr("Meeting booked") }))).toBeVisible();
  await expect(newCall).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${fr("Write")}`) })).toHaveCount(0); // the mail already went out: nothing more suggested

  // A yes to Local: Y on the ladder, then Enter after hanging up picks "Yes Local"; the message stays folded (E opens it).
  await page.keyboard.press("Enter");
  await page.keyboard.press("Digit1");
  await page.keyboard.press("o");
  await page.keyboard.press("y");
  await expect(page.getByText(fr("Yes to Local: hang up, then confirm"))).toBeVisible();
  await page.keyboard.press("x");
  await page.keyboard.press("Enter");
  await page.getByLabel(fr("Business name")).fill("Garage Local (e2e)");
  await page.getByRole("button", { name: fr("Save · {outcome}", { outcome: fr("Yes Local") }) }).click();
  await expect(page.getByText(fr("{outcome}: added to your pipeline", { outcome: fr("Yes Local") }))).toBeVisible();
  await expect(newCall).toBeVisible(); // never blocked by the message
  await page.keyboard.press("e");
  const card = page.getByRole("region", { name: fr("Message card") });
  await expect(card.getByRole("radio", { name: new RegExp(fr("Local offer")) })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: fr("End session") }).click();
  await expect(page.getByRole("heading", { name: fr("Session summary") })).toBeVisible();
  await expect(page.getByText(fr("After a no to Consulting: Local offered {lo}, yes {ly} · 30/30 offered {to}, yes {ty}.", { lo: 2, ly: 1, to: 1, ty: 0 }))).toBeVisible();
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
