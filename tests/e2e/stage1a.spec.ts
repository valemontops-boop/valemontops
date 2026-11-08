import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test("DEMO is clearly labelled on every screen", async ({ page }) => {
  await signIn(page, "theo");
  await expect(page.getByRole("status").filter({ hasText: "DEMO mode" })).toContainText("local fake Google Sheets server");
  await page.goto("/crm");
  await expect(page.getByRole("status").filter({ hasText: "DEMO mode" })).toBeVisible();
});

test("unauthenticated and forged sessions are refused", async ({ page, request }) => {
  const r = await request.get("/api/my-day");
  expect(r.status()).toBe(401);
  await page.context().addCookies([{ name: "vos_session", value: "forged", url: "http://localhost:3100" }]);
  const r2 = await page.request.get("/api/crm");
  expect(r2.status()).toBe(401);
  await page.goto("/my-day");
  await expect(page).toHaveURL(/\/login/);
});

test("scenario 2: a cold call logged once appears once and survives reload; visible to Pablo (scenario 3)", async ({ browser }) => {
  const theoCtx = await browser.newContext();
  const theo = await theoCtx.newPage();
  await signIn(theo, "theo");
  await theo.getByRole("button", { name: "Log activity" }).first().click();
  const dialog = theo.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Call" }).click();
  await dialog.getByLabel("Business").fill("Garage du Parc");
  await dialog.getByRole("button", { name: /Garage du Parc/ }).click();
  await dialog.getByRole("radio", { name: "No answer" }).click();
  await dialog.getByLabel("Next action").fill("Call back Monday");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(theo.getByText("Saved", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  const logged = theo.getByRole("region", { name: /Logged today/ });
  await expect(logged.getByText("Call, no answer")).toHaveCount(1);
  await theo.reload();
  await expect(theo.getByRole("region", { name: /Logged today/ }).getByText("Call, no answer")).toHaveCount(1);

  const pabloCtx = await browser.newContext();
  const pablo = await pabloCtx.newPage();
  await signIn(pablo, "pablo");
  await pablo.goto("/crm");
  await pablo.getByRole("radio", { name: "All businesses" }).click();
  await pablo.getByRole("button", { name: "Garage du Parc (demo)" }).click();
  const panel = pablo.getByRole("complementary", { name: "Details" });
  await expect(panel.getByText("Call, no answer")).toHaveCount(1);
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
  const pa = a.getByRole("complementary", { name: "Details" });
  const pb = b.getByRole("complementary", { name: "Details" });
  await pb.getByLabel("Next step").fill("Pablo: send the demo video");
  await pb.getByRole("button", { name: "Save next step" }).click();
  await expect(b.getByText("Saved", { exact: true })).toBeVisible();
  await pa.getByLabel("Next step").fill("Théo: visit on Thursday");
  await pa.getByRole("button", { name: "Save next step" }).click();
  await expect(pa.getByRole("alert")).toContainText("Someone else saved this record");
  await expect(pa.getByRole("alert")).toContainText("Pablo: send the demo video");
  await a.reload();
  await a.getByRole("button", { name: /^Chauffage Morel \(demo\)/ }).click();
  await expect(a.getByRole("complementary", { name: "Details" }).getByLabel("Next step")).toHaveValue("Pablo: send the demo video");
});

test("scenario 14: an opted-out contact is blocked in the UI and by the server for both founders", async ({ page }) => {
  await signIn(page, "pablo");
  await page.goto("/crm");
  await page.getByRole("radio", { name: "All businesses" }).click();
  await page.getByRole("button", { name: "Climatización Ortega (demo)" }).click();
  const panel = page.getByRole("complementary", { name: "Details" });
  await expect(panel.getByText("This contact opted out.")).toBeVisible();
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
    data: { id, account: { name: "=SUM(A1) Plomberie", country: "FR", phone: "+33612345678", notes: "-12.00" } },
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
  await page.getByLabel("Or paste CSV").fill(csv);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText(/1\s+new · 1\s+duplicates skipped/)).toBeVisible();
  await expect(page.getByText("Ignored columns: Extra")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 new" }).click();
  await expect(page.getByText(/Imported 1 businesses/).first()).toBeVisible();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText(/0\s+new · 2\s+duplicates skipped/)).toBeVisible();
});
