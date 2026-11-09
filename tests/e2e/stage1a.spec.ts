import { expect, test } from "@playwright/test";
import { es, fr, re, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("DEMO is clearly labelled on every screen", async ({ page }) => {
  await signIn(page, "theo");
  await expect(page.getByRole("status").filter({ hasText: /Mode Démo/ })).toContainText(/faux serveur Google Sheets/);
  await page.goto("/crm");
  await expect(page.getByRole("status").filter({ hasText: /Mode Démo/ })).toBeVisible();
});

test("unauthenticated and forged sessions are refused", async ({ page, request }) => {
  const r = await request.get("/api/my-day");
  expect(r.status()).toBe(401);
  await page.context().addCookies([{ name: fr("vos_session"), value: "forged", url: "http://localhost:3100" }]);
  const r2 = await page.request.get("/api/crm");
  expect(r2.status()).toBe(401);
  await page.goto("/my-day");
  await expect(page).toHaveURL(/\/login/);
});

test("scenario 2: a cold call logged once appears once and survives reload; visible to Pablo (scenario 3)", async ({ browser }) => {
  const theoCtx = await browser.newContext();
  const theo = await theoCtx.newPage();
  await signIn(theo, "theo");
  await theo.getByRole("button", { name: fr("Log activity") }).first().click();
  const dialog = theo.getByRole("dialog");
  await dialog.getByRole("radio", { name: fr("Phone call") }).click();
  await dialog.getByLabel(fr("Business")).fill("Garage du Parc");
  await dialog.getByRole("button", { name: re(fr("Garage du Parc")) }).click();
  await dialog.getByRole("radio", { name: fr("No answer") }).click();
  await dialog.getByLabel(fr("Next action")).fill("Call back Monday");
  await dialog.getByRole("button", { name: fr("Save") }).click();
  await expect(theo.getByText(fr("Saved"), { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  const logged = theo.getByRole("region", { name: re(fr("Logged today")) });
  await expect(logged.getByText(fr("Call, no answer"))).toHaveCount(1);
  await theo.reload();
  await expect(theo.getByRole("region", { name: re(fr("Logged today")) }).getByText(fr("Call, no answer"))).toHaveCount(1);

  const pabloCtx = await browser.newContext();
  const pablo = await pabloCtx.newPage();
  await signIn(pablo, "pablo");
  await pablo.goto("/crm");
  await pablo.getByRole("radio", { name: es("All businesses") }).click();
  await pablo.getByRole("button", { name: es("Garage du Parc (demo)") }).click();
  const panel = pablo.getByRole("complementary", { name: es("Details") });
  await expect(panel.getByText(es("Call, no answer"))).toHaveCount(1);
  await expect(panel.getByText(/Théo/).first()).toBeVisible();
  await theoCtx.close();
  await pabloCtx.close();
});

test("scenario 3: concurrent edits on the same opportunity show a conflict, never a silent overwrite", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, "theo");
  await signIn(b, "pablo");
  for (const p of [a, b]) {
    await p.goto("/crm");
    await p.getByRole("button", { name: /^Chauffage Morel \(demo\)/ }).click();
  }
  const pa = a.getByRole("complementary", { name: fr("Details") });
  const pb = b.getByRole("complementary", { name: es("Details") });
  await pb.getByLabel(es("Next step")).fill("Pablo: send the demo video");
  await pb.getByRole("button", { name: es("Save next step") }).click();
  await expect(b.getByText(es("Saved"), { exact: true })).toBeVisible();
  await pa.getByLabel(fr("Next step")).fill("Théo: visit on Thursday");
  await pa.getByRole("button", { name: fr("Save next step") }).click();
  await expect(pa.getByRole("alert")).toContainText(fr("Someone else saved this record while you were editing.").slice(0, 40));
  await expect(pa.getByRole("alert")).toContainText(fr("Pablo: send the demo video"));
  await a.reload();
  await a.getByRole("button", { name: /^Chauffage Morel \(demo\)/ }).click();
  await expect(a.getByRole("complementary", { name: fr("Details") }).getByLabel(fr("Next step"))).toHaveValue("Pablo: send the demo video");
});

test("scenario 14: an opted-out contact is blocked in the UI and by the server for both founders", async ({ page }) => {
  await signIn(page, "pablo");
  await page.goto("/crm");
  await page.getByRole("radio", { name: es("All businesses") }).click();
  await page.getByRole("button", { name: es("Climatización Ortega (demo)") }).click();
  const panel = page.getByRole("complementary", { name: es("Details") });
  await expect(panel.getByText(es("This contact opted out."))).toBeVisible();
  const crm = await (await page.request.get("/api/crm")).json();
  const account = crm.accounts.find((x: { name: string }) => x.name === "Climatización Ortega (demo)");
  const contact = crm.contacts.find((c: { account_id: string }) => c.account_id === account.id);
  const res = await page.request.post("/api/activities", {
    data: { idempotency_key: crypto.randomUUID(), activity_type: "cold_call", account_id: account.id, contact_id: contact.id },
    headers: { origin: "http://localhost:3100" },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).error).toBe("blocked");
});

test("server rejects malformed input and cross-origin mutations", async ({ page }) => {
  await signIn(page, "theo");
  const bad = await page.request.post("/api/activities", { data: { idempotency_key: "nope", activity_type: "teleport" }, headers: { origin: "http://localhost:3100" } });
  expect(bad.status()).toBe(400);
  const cross = await page.request.post("/api/settings/mode", { data: { mode: "VACATION" }, headers: { origin: "https://evil.example.com" } });
  expect(cross.status()).toBe(403);
});

test("CSV export neutralises formula text and keeps phone numbers (scenario 15, export)", async ({ page }) => {
  await signIn(page, "theo");
  const id = crypto.randomUUID();
  const created = await page.request.post("/api/crm/accounts", {
    data: { id, account: { name: fr("=SUM(A1) Plomberie"), country: "FR", phone: "+33612345678", notes: "-12.00" } },
    headers: { origin: "http://localhost:3100" },
  });
  expect(created.status()).toBe(200);
  const csv = await (await page.request.get("/api/crm/export")).text();
  const line = csv.split("\r\n").find((l) => l.includes(id))!;
  expect(line).toContain(`"'=SUM(A1) Plomberie"`);
  expect(line).toContain(`"+33612345678"`);
  const back = await (await page.request.get("/api/crm")).json();
  const acc = back.accounts.find((a: { id: string }) => a.id === id);
  expect(acc.name).toBe("=SUM(A1) Plomberie");
  expect(acc.phone).toBe("+33612345678");
  expect(acc.notes).toBe("-12.00");
});

test("CSV import previews, dedupes and is idempotent on re-submit", async ({ page }) => {
  await signIn(page, "theo");
  await page.goto("/crm/import");
  const csv = "Company,Website,Phone,Country,Extra\nToitures Nouvelles (e2e),toitures-nouvelles.example.com,+33100000555,FR,x\nPlomberie Duval bis,plomberie-duval.example.com,,FR,y";
  await page.getByLabel(fr("Or paste CSV")).fill(csv);
  await page.getByRole("button", { name: fr("Preview") }).click();
  const summary = (n: number, d: number) => page.getByText(new RegExp(`${fr("{n} new", { n })}\\s*·\\s*${fr("{n} duplicates skipped", { n: d })}`));
  await expect(summary(1, 1)).toBeVisible();
  await expect(page.getByText(fr("Ignored columns: {list}", { list: "Extra" }))).toBeVisible();
  await page.getByRole("button", { name: fr("Import {n} new", { n: 1 }) }).click();
  await expect(page.getByText(fr("Imported {n} businesses", { n: 1 }), { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: fr("Preview") }).click();
  await expect(summary(0, 2)).toBeVisible();
});
