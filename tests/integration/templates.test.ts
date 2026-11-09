import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeGoogleServer } from "@/fake-google/server";
import { GmailSender } from "@/data/google/adapters";
import { GoogleHttp } from "@/data/google/http";
import { ConflictError } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { childId } from "@/lib/ids";
import { seedBaseline } from "@/server/services/baseline";
import { createCustomTemplate, customCreateSchema, getPlaybook, playbookEditSchema, savePlaybookItem } from "@/server/services/playbook";
import { sendFollowUp, sendSchema } from "@/server/services/email";
import { addSuppression } from "@/server/services/crm";
import { commit } from "@/server/services/imports";
import { BlockedError } from "@/server/errors";
import { customChips, messageFor } from "@/domain/messages";
import { customKeyOf, findItem, gmailComposeLink } from "@/domain/playbook";
import { createSessionToken } from "@/server/session";
import { resetRateLimits } from "@/server/guard";
import { GET as playbookGET, POST as playbookPOST } from "@/app/api/playbook/route";
import { DELETE as customDELETE, POST as customPOST } from "@/app/api/playbook/custom/route";
import { POST as settingsPOST } from "@/app/api/settings/system/route";
import { GET as gmailGrantGET } from "@/app/api/auth/google/gmail/route";
import { GET as gmailStatusGET } from "@/app/api/email/status/route";
import { POST as emailSendPOST } from "@/app/api/email/send/route";
import { GET as inboxGET } from "@/app/api/inbox/route";
import { freshSheetsRepo, makeRepo } from "../helpers";

/** D090: Settings › Templates (edit, revert, 409, own templates), the shared sending address and the WhatsApp number. */
const SENDER = "contact@valemont-test.example.com";

describe("templates and sending address over the Sheets adapter", () => {
  let fake: FakeSheetsServer;
  let google: FakeGoogleServer;
  let ctx: AppContext;
  let url: string;
  beforeEach(async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    url = env.url;
    google = new FakeGoogleServer();
    const gurl = await google.start();
    ctx = {
      repo: env.repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null,
      mailerFor: (_f, grant) => (grant ? new GmailSender(new GoogleHttp(gurl, async () => grant, { sleep: async () => undefined })) : null),
      baseUrl: "", mode: "demo",
    };
    await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
    await env.repo.insert("SystemSettings", [{ id: childId("setting", "email_sender_address"), key: "email_sender_address", value: SENDER, description: "" }], { founder: "theo" });
  });
  afterEach(async () => {
    await fake.stop();
    await google.stop();
  });

  it("edits a text with a version check: the second founder's stale save is a 409, revert goes back to the original", async () => {
    const edit = (founder: "theo" | "pablo", body: string, expected: number) => savePlaybookItem(ctx, founder, playbookEditSchema.parse({ kind: "email", key: "missed", language: "FR", subject: "J'ai essayé de vous appeler", body, expected_version: expected }));
    const first = await edit("theo", "Bonjour {contact}, j'ai essayé de vous appeler. {signature}", 0);
    expect(first?.version).toBe(1);
    await expect(edit("pablo", "Autre texte", 0)).rejects.toBeInstanceOf(ConflictError);
    const pb = await getPlaybook(ctx, "theo");
    const item = findItem(pb.items, "email", "missed", "FR")!;
    expect(item).toMatchObject({ edited: true, version: 1, body: "Bonjour {contact}, j'ai essayé de vous appeler. {signature}" });
    await edit("pablo", "", 1); // "Back to the original text"
    const back = findItem((await getPlaybook(ctx, "theo")).items, "email", "missed", "FR")!;
    expect(back.edited).toBe(false);
    expect(back.version).toBe(2);
    expect(back.body).toMatch(/J'ai essayé de vous appeler aujourd'hui/);
  });

  it("creates the founders' own template once (retry-safe), stores its name in the late column and offers it as a chip", async () => {
    const id = randomUUID();
    const input = customCreateSchema.parse({ id, kind: "whatsapp", name: "Relance chantier", language: "FR", body: "Bonjour {contact}, {founder} de Valemont. On se cale 15 min ? {calendly}" });
    await createCustomTemplate(ctx, "theo", input);
    await createCustomTemplate(ctx, "theo", input);
    const rows = (await makeRepo(url).list("Playbook")).rows.filter((r) => r.key === customKeyOf(id));
    expect(rows).toHaveLength(1);
    expect(rows[0].template_name).toBe("Relance chantier");
    const pb = await getPlaybook(ctx, "theo");
    expect(customChips(pb, "whatsapp", "FR")).toEqual([customKeyOf(id)]);
    expect(customChips(pb, "email", "FR")).toEqual([]);
    expect(messageFor(pb, "FR", "whatsapp", customKeyOf(id), { name: "Garage Un", contact: "Alex" }).body).toMatch(/^Bonjour Alex, Théo de Valemont/);
    // Pablo writes the Spanish version: the name follows.
    await savePlaybookItem(ctx, "pablo", playbookEditSchema.parse({ kind: "whatsapp", key: customKeyOf(id), language: "ES", body: "Hola {contact}", expected_version: 0 }));
    const es = (await makeRepo(url).list("Playbook")).rows.find((r) => r.key === customKeyOf(id) && r.language === "ES")!;
    expect(es.template_name).toBe("Relance chantier");
  });

  it("refuses a LinkedIn connection note over 300 characters", async () => {
    await expect(savePlaybookItem(ctx, "theo", playbookEditSchema.parse({ kind: "linkedin", key: "invitation", language: "FR", body: "x".repeat(301) }))).rejects.toThrow(/300/);
  });

  it("sends every client email From the sending address (both founders) and Gmail compose opens on it", async () => {
    const pb = await getPlaybook(ctx, "pablo");
    expect(pb.sender).toBe(SENDER);
    expect(new URL(gmailComposeLink("sam@example.com", "S", "B", pb.sender)).searchParams.get("authuser")).toBe(SENDER);
    for (const founder of ["theo", "pablo"] as const) {
      await sendFollowUp(ctx, founder, `founder-token-${founder}`, sendSchema.parse({ idempotency_key: randomUUID(), channel: "email", via: "gmail", to: "alex@garage-un.example.com", subject: "Suite à notre appel", body: "Bonjour", template_key: "thanks", language: "FR", business_name: "Garage Un (test)" }));
    }
    expect(google.store.sentMail.map((m) => m.from)).toEqual([SENDER, SENDER]);
    expect(google.store.sentMail.map((m) => m.by)).toEqual(["founder-token-theo", "founder-token-pablo"]);
  });

  it("normalises the WhatsApp number, saves a typed number on the contact when asked, and blocks a suppressed one first", async () => {
    await commit(ctx.repo, "theo", { import_id: randomUUID(), csv: "Company,Phone,Country,Niche,Contact,Email\nGarage Un (test),+33100000101,FR,Garages,Alex,\n", brand: "consulting", owner_founder: null, lead_source: "Test", list_name: "Test" });
    const acc = (await ctx.repo.list("Accounts", { fresh: true })).rows.find((a) => a.name === "Garage Un (test)")!;
    const contact = (await ctx.repo.list("Contacts", { fresh: true })).rows.find((c) => c.account_id === acc.id)!;
    const wa = (to: string, save = true) => sendFollowUp(ctx, "theo", null, sendSchema.parse({ idempotency_key: randomUUID(), channel: "whatsapp", via: "whatsapp", account_id: acc.id, to, body: "Bonjour", template_key: "thanks", language: "FR", market: "FR", save_phone: save, check_only: true }));
    await expect(wa("06 12")).rejects.toThrow(/country code/);
    await wa("06 12 34 56 78");
    expect((await ctx.repo.get("Contacts", contact.id, { fresh: true }))!.phone).toBe("+33612345678");
    await addSuppression(ctx.repo, "theo", { kind: "phone", value: "+33698765432", reason: "opt_out" });
    await expect(wa("06 98 76 54 32")).rejects.toBeInstanceOf(BlockedError);
    expect((await ctx.repo.get("Contacts", contact.id, { fresh: true }))!.phone).toBe("+33612345678");
  });
});

describe("templates through the routes (DEMO)", () => {
  const SECRET = "templates14-session-secret-long-enough-0123";
  const ENV: Record<string, string> = { APP_MODE: "demo", DEMO_BACKEND: "memory", SESSION_SECRET: SECRET, APP_BASE_URL: "http://localhost" };
  const saved: Record<string, string | undefined> = {};
  let theo = "";
  let pablo = "";
  const req = (path: string, init: { method?: string; body?: unknown; cookie?: string; extraCookie?: string } = {}) => new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost", origin: "http://localhost", cookie: [init.cookie ? `vos_session=${init.cookie}` : "", init.extraCookie ?? ""].filter(Boolean).join("; "), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    theo = await createSessionToken({ founder: "theo", role: "founder", mode: "demo" }, SECRET);
    pablo = await createSessionToken({ founder: "pablo", role: "founder", mode: "demo" }, SECRET);
  });
  afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  beforeEach(() => resetRateLimits());

  it("edits, conflicts (409 with the saved version) and reverts through /api/playbook", async () => {
    const pb = await (await playbookGET(req("/api/playbook", { cookie: theo }))).json();
    const item = pb.items.find((i: { kind: string; key: string; language: string }) => i.kind === "opener" && i.key === "default" && i.language === "FR");
    const ok = await playbookPOST(req("/api/playbook", { method: "POST", cookie: theo, body: { kind: "opener", key: "default", language: "FR", subject: "", body: "Bonjour {contact}, {founder} de Valemont.", expected_version: item.version } }));
    expect(ok.status).toBe(200);
    const stale = await playbookPOST(req("/api/playbook", { method: "POST", cookie: pablo, body: { kind: "opener", key: "default", language: "FR", subject: "", body: "Autre", expected_version: item.version } }));
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error).toBe("conflict");
    expect(body.current.body).toBe("Bonjour {contact}, {founder} de Valemont.");
    const revert = await playbookPOST(req("/api/playbook", { method: "POST", cookie: pablo, body: { kind: "opener", key: "default", language: "FR", subject: "", body: "", expected_version: body.current.version } }));
    expect(revert.status).toBe(200);
    const after = await (await playbookGET(req("/api/playbook", { cookie: theo }))).json();
    expect(after.items.find((i: { kind: string; key: string; language: string }) => i.kind === "opener" && i.key === "default" && i.language === "FR").edited).toBe(false);
  });

  it("creates an own template, shows it in the playbook and as an inbox reply option, then deletes it", async () => {
    const id = randomUUID();
    const res = await customPOST(req("/api/playbook/custom", { method: "POST", cookie: theo, body: { id, kind: "whatsapp", name: "Merci salon", language: "FR", body: "Merci {contact} pour la visite du stand !" } }));
    expect(res.status).toBe(200);
    const pb = await (await playbookGET(req("/api/playbook", { cookie: theo }))).json();
    expect(pb.items.some((i: { key: string; custom?: boolean; name?: string }) => i.key === customKeyOf(id) && i.custom && i.name === "Merci salon")).toBe(true);
    const inbox = await (await inboxGET(req("/api/inbox?scope=team", { cookie: theo }))).json();
    if (inbox.items.length) expect(inbox.items[0].replies.some((r: { key: string; label?: string }) => r.key === customKeyOf(id) && r.label === "Merci salon")).toBe(true);
    const del = await customDELETE(req("/api/playbook/custom", { method: "DELETE", cookie: theo, body: { kind: "whatsapp", key: customKeyOf(id), expected_versions: { FR: 1 } } }));
    expect(await del.json()).toEqual({ deleted: 1 });
    const gone = await (await playbookGET(req("/api/playbook", { cookie: theo }))).json();
    expect(gone.items.some((i: { key: string }) => i.key === customKeyOf(id))).toBe(false);
  });

  it("validates the sending address and only sends with a Gmail grant of that address", async () => {
    expect((await settingsPOST(req("/api/settings/system", { method: "POST", cookie: theo, body: { key: "email_sender_address", value: "not an address" } }))).status).toBe(400);
    expect((await settingsPOST(req("/api/settings/system", { method: "POST", cookie: theo, body: { key: "email_sender_address", value: "Contact@Valemont-Test.example.com" } }))).status).toBe(200);
    // DEMO grant: simulated, recorded for the sending address.
    const grant = await gmailGrantGET(req("/api/auth/google/gmail?back=/call", { cookie: theo }));
    const cookie = `vos_gmail=${grant.cookies.get("vos_gmail")!.value}`;
    const status = await (await gmailStatusGET(req("/api/email/status", { cookie: theo, extraCookie: cookie }))).json();
    expect(status).toMatchObject({ connected: true, sender: SENDER });
    const sent = await emailSendPOST(req("/api/email/send", { method: "POST", cookie: theo, extraCookie: cookie, body: { idempotency_key: randomUUID(), channel: "email", via: "gmail", to: "alex@example.com", subject: "Suite", body: "Bonjour", template_key: "thanks", language: "FR", business_name: "Garage Test (demo)" } }));
    expect(sent.status).toBe(200);
    // The sending address changes: the old grant (another mailbox) no longer sends.
    await settingsPOST(req("/api/settings/system", { method: "POST", cookie: theo, body: { key: "email_sender_address", value: "other@example.com" } }));
    expect((await (await gmailStatusGET(req("/api/email/status", { cookie: theo, extraCookie: cookie }))).json()).connected).toBe(false);
    const refused = await emailSendPOST(req("/api/email/send", { method: "POST", cookie: theo, extraCookie: cookie, body: { idempotency_key: randomUUID(), channel: "email", via: "gmail", to: "alex@example.com", subject: "Suite", body: "Bonjour", template_key: "thanks", language: "FR" } }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("consent_required");
  });
});
