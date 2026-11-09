import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

/** D090: Settings › Templates (edit, preview, revert, own template) and the WhatsApp card (number, copy, open, "Sent?"). */
test("Templates: edit a text with a live preview, go back to the original, create an own WhatsApp template", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: fr("Templates") }).click();
  await expect(page.getByRole("heading", { name: fr("Templates"), exact: true })).toBeVisible();
  await expect(page.getByText(re(fr("Sent from {address}", { address: "contact@valemont-demo.example.com" })))).toBeVisible();

  await page.getByLabel(fr("Search templates")).fill("essayé de vous appeler");
  const row = page.getByRole("button", { name: re(fr("Tried to reach you (no answer)")) }).first();
  await row.click();
  const form = page.getByRole("form", { name: fr("Tried to reach you (no answer)") });
  const text = form.getByLabel(fr("Text"));
  await text.fill("Bonjour {contact}, petit essai e2e pour {business}.\n{signature}");
  await expect(form.getByLabel(fr("Preview"))).toContainText("Bonjour Julien, petit essai e2e pour Plomberie Martin.");
  await form.getByRole("button", { name: fr("Save") }).click();
  await expect(page.getByText(fr("Saved")).first()).toBeVisible();
  await expect(page.getByRole("button", { name: re(fr("Tried to reach you (no answer)")) }).first()).toContainText(fr("edited"));

  // The editor stays open after saving: back to the original text from there.
  await page.getByRole("button", { name: fr("Back to the original text") }).click();
  await expect(page.getByRole("button", { name: re(fr("Tried to reach you (no answer)")) }).first()).toContainText(fr("original"));

  // LinkedIn note: counter and limit.
  await page.getByLabel(fr("Search templates")).fill("");
  await page.getByRole("button", { name: re(fr("Connection note")) }).first().click();
  const note = page.getByRole("form", { name: fr("Connection note") });
  await note.getByLabel(fr("Text")).fill("x".repeat(301));
  await expect(note.getByText(re(fr("Too long: LinkedIn refuses a connection note over {max} characters.", { max: 300 })))).toBeVisible();
  await expect(note.getByRole("button", { name: fr("Save") })).toBeDisabled();
  await note.getByRole("button", { name: fr("Close") }).click();

  await page.getByRole("button", { name: fr("New template") }).first().click();
  await page.getByLabel(fr("Name")).fill("Relance e2e");
  await page.getByLabel(fr("Text")).fill("Bonjour {contact}, on se cale 15 minutes ? {calendly}");
  await page.getByRole("button", { name: fr("Create") }).click();
  await expect(page.getByText(fr("Template created"))).toBeVisible();
  await expect(page.getByRole("region", { name: fr("Your own templates") })).toContainText("Relance e2e");
});

test("WhatsApp card: any number read back in E.164 or refused, copy the text, open a new chat, then Sent?", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route(/web\.whatsapp\.com|wa\.me/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>wa</body></html>" }));
  await signIn(page, "theo");
  const crm = (await (await page.request.get("/api/crm")).json()) as { accounts: { id: string; name: string; country: string | null; blocked_reason?: string | null }[] };
  const acc = crm.accounts.find((a) => a.country === "FR" && !a.blocked_reason)!;
  await page.goto(`/crm?account=${acc.id}`);
  await page.getByRole("button", { name: fr("Send a message (email or WhatsApp)") }).click();
  const card = page.getByRole("region", { name: fr("Message card") });
  await card.getByRole("radio", { name: /WhatsApp/ }).click();
  // The own template made in the previous test is offered as an extra chip.
  await expect(card.getByRole("radio", { name: "Relance e2e" })).toBeVisible();
  const number = card.getByLabel(fr("WhatsApp number"));
  await number.fill("06 12");
  await expect(card.getByText(fr("Not a valid number: type it with its country code (+33…, +34…) or as 06…, 6…"))).toBeVisible();
  await number.fill("06 12 34 56 78");
  await expect(card.getByText(fr("WhatsApp opens a new chat with {number}", { number: "+33 6 12 34 56 78" }))).toBeVisible();
  await card.getByRole("button", { name: fr("Copy the text") }).click();
  await expect(page.getByText(fr("Text copied"))).toBeVisible();
  const [popup] = await Promise.all([page.waitForEvent("popup"), card.getByRole("button", { name: fr("Open WhatsApp") }).click()]);
  await expect.poll(() => popup.url()).toMatch(/web\.whatsapp\.com\/send\?phone=33612345678&text=/);
  await popup.close();
  await page.getByRole("button", { name: fr("Yes, sent") }).click();
  await expect(page.getByText(fr("WhatsApp logged"))).toBeVisible();
});

test("Templates in Spanish for Pablo: Spanish texts by default, no English", async ({ page }) => {
  await signIn(page, "pablo");
  await page.goto("/settings");
  await page.getByRole("radio", { name: es("Templates") }).click();
  await expect(page.getByRole("heading", { name: es("Templates"), exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: es("Inbox suggested replies") })).toBeVisible();
  await page.getByRole("button", { name: re(es("Answer to a price question")) }).click();
  await expect(page.getByRole("form", { name: es("Answer to a price question") }).getByLabel(es("Preview"))).toContainText("Hola Julien");
  for (const english of ["Templates", "Search templates", "Your own templates", "Back to the original text"]) await expect(page.getByText(english, { exact: true })).toHaveCount(0);
});
