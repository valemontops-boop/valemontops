import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import { ConflictError } from "@/data/repository";
import { seedBaseline } from "@/server/services/baseline";
import { logActivity, logActivitySchema } from "@/server/services/activities";
import { getMyDay, setMode, setTargets, whatsappReport } from "@/server/services/myday";
import { createAccount, createAccountSchema, crmSnapshot, optOutContact, updateOpportunity, updateOpportunitySchema, accountTimeline } from "@/server/services/crm";
import { readConfig } from "@/server/config";
import { BlockedError } from "@/server/errors";
import { TEST_SHEET_ID, freshSheetsRepo, makeRepo } from "../helpers";

let fake: FakeSheetsServer;
let url: string;
let repo: DataRepository;
const TZ = { theo: "Europe/Paris", pablo: "Europe/Madrid" };
// Monday 9 Nov 2026, 10:00 Paris
const NOW = new Date("2026-11-09T09:00:00.000Z");

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  url = env.url;
  repo = env.repo;
  await seedBaseline(repo, TZ);
});
afterEach(async () => fake.stop());

async function newBusiness(founder: "theo" | "pablo" = "theo") {
  const id = randomUUID();
  await createAccount(
    repo,
    founder,
    createAccountSchema.parse({
      id,
      account: { name: "Plomberie Scénario", country: "FR", phone: "+33100000099", website: "https://plomberie-scenario.example.com" },
      contact: { full_name: "Test Owner", phone: "+33100000099", email: "owner@plomberie-scenario.example.com" },
      opportunity: { name: "Plomberie Scénario · Local", brand: "local", stage: "targeted" },
    }),
  );
  const snap = await crmSnapshot(repo);
  return { accountId: id, contact: snap.contacts.find((c) => c.account_id === id)!, opp: snap.opportunities.find((o) => o.account_id === id)! };
}

describe("Scenario 1: mode and exact saved targets from Sheets", () => {
  it("Théo sets Searching mode; a fresh reader sees his exact saved targets", async () => {
    const before = await getMyDay(repo, "theo", NOW);
    expect(before.mode).toBeNull();
    expect(before.nextAction.kind).toBe("onboarding");
    await setMode(repo, "theo", { mode: "JOB_SEARCHING", reason: "" }, NOW);
    await setTargets(repo, "theo", { mode: "JOB_SEARCHING", targets: { calls: { target: 33, weight: 2, minutes: 4 } } }, NOW);
    const reloaded = await getMyDay(makeRepo(url), "theo", NOW); // new instance = reload
    expect(reloaded.mode).toBe("JOB_SEARCHING");
    expect(reloaded.targets?.calls).toEqual({ target: 33, weight: 2, minutes: 4 });
    expect(reloaded.targets?.dms.target).toBe(12);
    expect(reloaded.targets?.cold_emails.target).toBe(8);
    const grid = fake.sheet(TEST_SHEET_ID, "DailyPlans")!.grid;
    expect(grid).toHaveLength(2); // one snapshot row for today
  });

  it("a target lowered after the day started does not change today's plan (scenario 16 part)", async () => {
    await setMode(repo, "theo", { mode: "JOB_SEARCHING", reason: "" }, NOW);
    await getMyDay(repo, "theo", NOW); // day starts: plan snapshot written
    const res = await setTargets(repo, "theo", { mode: "JOB_SEARCHING", targets: { calls: { target: 1, weight: 1, minutes: 4 } } }, NOW);
    expect(res.appliesToday).toBe(false);
    expect((await getMyDay(makeRepo(url), "theo", NOW)).targets?.calls.target).toBe(35);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect((await getMyDay(makeRepo(url), "theo", tomorrow)).targets?.calls.target).toBe(1);
  });
});

describe("Scenario 2: one cold call appears exactly once", () => {
  it("in founder stats and the company CRM, and persists after reload; a retry adds nothing", async () => {
    await setMode(repo, "theo", { mode: "JOB_SEARCHING", reason: "" }, NOW);
    const { accountId, contact, opp } = await newBusiness();
    const input = logActivitySchema.parse({
      idempotency_key: randomUUID(), activity_type: "cold_call", account_id: accountId, contact_id: contact.id,
      opportunity_id: opp.id, outcome: "no_answer", next_action: "Call back tomorrow", next_action_due: "2026-11-10",
    });
    const first = await logActivity(repo, "theo", input, NOW);
    expect(first.duplicate).toBe(false);
    const retry = await logActivity(makeRepo(url), "theo", input, NOW);
    expect(retry.duplicate).toBe(true);
    expect(retry.event.id).toBe(first.event.id);

    const fresh = makeRepo(url);
    const day = await getMyDay(fresh, "theo", NOW);
    expect(day.tally.calls).toBe(1);
    expect(day.tally.new_businesses).toBe(1);
    expect(day.todayEvents).toHaveLength(1);
    const timeline = await accountTimeline(fresh, accountId);
    expect(timeline.events).toHaveLength(1);
    expect(fake.sheet(TEST_SHEET_ID, "ActivityEvents")!.grid).toHaveLength(2);
    const o = (await crmSnapshot(fresh)).opportunities.find((x) => x.id === opp.id)!;
    expect(o.stage).toBe("contacted"); // first outreach advances Targeted
    expect(o.next_action_due).toBe("2026-11-10");
  });

  it("two rows with the same idempotency_key (a race) count once (scenario 16 part)", async () => {
    const { accountId } = await newBusiness();
    const input = logActivitySchema.parse({ idempotency_key: randomUUID(), activity_type: "linkedin_dm", account_id: accountId });
    await logActivity(repo, "theo", input, NOW);
    const grid = fake.sheet(TEST_SHEET_ID, "ActivityEvents")!.grid;
    const h = grid[0] as string[];
    const dup = [...grid[1]];
    dup[h.indexOf("id")] = randomUUID();
    dup[h.indexOf("created_at")] = "2026-11-09T09:00:05.000Z";
    grid.push(dup);
    const day = await getMyDay(makeRepo(url), "theo", NOW);
    expect(day.tally.dms).toBe(1);
  });
});

describe("Scenario 3: cross-founder visibility and conflicts", () => {
  it("Pablo's update is visible to Théo after refresh; concurrent edits produce a conflict", async () => {
    const { opp } = await newBusiness();
    const theo = makeRepo(url);
    const pablo = makeRepo(url);
    const seenByTheo = (await crmSnapshot(theo)).opportunities.find((o) => o.id === opp.id)!;
    await updateOpportunity(pablo, "pablo", updateOpportunitySchema.parse({ id: opp.id, expected_version: seenByTheo.version, patch: { next_action: "Pablo: send video" } }));
    const after = (await crmSnapshot(theo)).opportunities.find((o) => o.id === opp.id)!;
    expect(after.next_action).toBe("Pablo: send video");
    const err = await updateOpportunity(theo, "theo", updateOpportunitySchema.parse({ id: opp.id, expected_version: seenByTheo.version, patch: { next_action: "Théo: call" } })).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).current?.next_action).toBe("Pablo: send video");
    expect((await crmSnapshot(makeRepo(url))).opportunities.find((o) => o.id === opp.id)!.next_action).toBe("Pablo: send video");
  });

  it("rejects moving to Qualified without ANUM notes", async () => {
    const { opp } = await newBusiness();
    await expect(updateOpportunity(repo, "theo", updateOpportunitySchema.parse({ id: opp.id, expected_version: opp.version, patch: { stage: "qualified" } }))).rejects.toThrow(/ANUM/);
  });
});

describe("Scenario 14: opted-out contact is blocked for both founders", () => {
  it("refuses outreach logging by the server, by contact and by matching phone", async () => {
    const { accountId, contact } = await newBusiness();
    await optOutContact(repo, "pablo", { contact_id: contact.id, reason: "Asked to stop" });
    for (const founder of ["theo", "pablo"] as const) {
      const viaContact = logActivity(makeRepo(url), founder, logActivitySchema.parse({ idempotency_key: randomUUID(), activity_type: "cold_call", account_id: accountId, contact_id: contact.id }), NOW);
      await expect(viaContact).rejects.toBeInstanceOf(BlockedError);
      const viaAccountPhone = logActivity(makeRepo(url), founder, logActivitySchema.parse({ idempotency_key: randomUUID(), activity_type: "cold_email", account_id: accountId }), NOW);
      await expect(viaAccountPhone).rejects.toBeInstanceOf(BlockedError);
    }
    expect(fake.sheet(TEST_SHEET_ID, "ActivityEvents")!.grid.length).toBeLessThanOrEqual(1);
  });
});

describe("Scenario 13 (service part): a field visit counts as one new business and appears in the WhatsApp report", () => {
  it("counts and reports", async () => {
    await setMode(repo, "theo", { mode: "LAUNCH_SPRINT", reason: "" }, NOW);
    await logActivity(repo, "theo", logActivitySchema.parse({
      idempotency_key: randomUUID(), activity_type: "field_visit", outcome: "met_owner", met_person: "Owner",
      fast_contact: { company_name: "Garage Visite (test)", country: "FR", phone: "+33100000077" },
    }), NOW);
    const day = await getMyDay(makeRepo(url), "theo", NOW);
    expect(day.tally.field_visits).toBe(1);
    expect(day.tally.new_businesses).toBe(1);
    const text = await whatsappReport(makeRepo(url), "theo", "Visit 5 garages", NOW);
    // Théo's report is in French (D048).
    expect(text).toContain("- Visite terrain: 1");
    expect(text).toContain("- Nouvelles entreprises contactées : 1");
    expect(text).toContain("- Nouvelles entreprises contactées: 1/5");
  });
});

describe("Scenario 11: LIVE without credentials never falls back", () => {
  it("reports setup errors for missing Google credentials", () => {
    const cfg = readConfig({ APP_MODE: "live", SESSION_SECRET: "x".repeat(40), NODE_ENV: "production" });
    expect(cfg.ok).toBe(false);
    expect(cfg.mode).toBe("live");
    expect(cfg.errors.join(" ")).toMatch(/GOOGLE_SERVICE_ACCOUNT_KEY_BASE64/);
    expect(cfg.errors.join(" ")).toMatch(/SHEETS_SPREADSHEET_ID/);
    expect(cfg.errors.join(" ")).toMatch(/FOUNDER_THEO_EMAIL/);
  });
  it("requires an explicit mode and rejects a fake Sheets URL in production", () => {
    expect(readConfig({ SESSION_SECRET: "x".repeat(40) }).errors[0]).toMatch(/APP_MODE/);
    const key = Buffer.from(JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: "k" })).toString("base64");
    const cfg = readConfig({
      APP_MODE: "live", NODE_ENV: "production", SESSION_SECRET: "x".repeat(40), APP_BASE_URL: "https://os.example.com",
      FOUNDER_THEO_EMAIL: "theo@example.com", FOUNDER_PABLO_EMAIL: "pablo@example.com", GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "s", SHEETS_SPREADSHEET_ID: "sheet", GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: key,
      SHEETS_API_BASE_URL: "http://127.0.0.1:4010",
    });
    expect(cfg.errors).toEqual(["SHEETS_API_BASE_URL must not point to a fake server in production."]);
  });
  it("DEMO is valid without Google credentials, but a production DEMO needs an access code", () => {
    expect(readConfig({ APP_MODE: "demo", SESSION_SECRET: "x".repeat(40) }).ok).toBe(true);
    expect(readConfig({ APP_MODE: "demo", SESSION_SECRET: "x".repeat(40), NODE_ENV: "production" }).ok).toBe(false);
  });
});

describe("Partial updates never reset fields that were not sent (zod v4 defaults regression)", () => {
  it("saving only the next step keeps stage, owner, brand and value", async () => {
    const { opp } = await newBusiness();
    const moved = await updateOpportunity(repo, "theo", updateOpportunitySchema.parse({ id: opp.id, expected_version: opp.version, patch: { stage: "contacted", owner_founder: "pablo", value_eur: 490 } }));
    const after = await updateOpportunity(repo, "theo", updateOpportunitySchema.parse({ id: opp.id, expected_version: moved.version, patch: { next_action: "Call back", next_action_due: "2026-11-12" } }));
    expect(after).toMatchObject({ stage: "contacted", owner_founder: "pablo", brand: "local", value_minor: 49000, next_action: "Call back", next_action_due: "2026-11-12" });
  });
});
