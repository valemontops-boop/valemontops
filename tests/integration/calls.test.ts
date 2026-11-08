import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { commit } from "@/server/services/imports";
import { callLists, callQueue, endSession, logCall, sessionSummary, startSession } from "@/server/services/calls";
import { getMyDay, setMode } from "@/server/services/myday";
import { optOutContact, crmSnapshot } from "@/server/services/crm";
import { TEST_SHEET_ID, freshSheetsRepo } from "../helpers";

let fake: FakeSheetsServer;
let ctx: AppContext;
beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  ctx = { repo: env.repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" };
  await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  await setMode(env.repo, "theo", { mode: "JOB_SEARCHING", reason: "" });
});
afterEach(async () => fake.stop());

const CSV = "Company,Phone,Country,Niche,Contact\nGarage Un (test),+33100000101,FR,Garages,Alex\nGarage Deux (test),+33100000102,FR,Garages,\nGarage Trois (test),+33100000103,FR,Garages,Sam\n";
const call = (session_id: string, p: Record<string, unknown>) => logCall(ctx, "theo", { idempotency_key: randomUUID(), session_id, account_id: "", phone: "", market: null, objection: null, follow_up_date: "", note: "", business_name: "", contact_name: "", contact_type: "professional_named", outcome: "no_answer", ...p } as never);

describe("Call mode", () => {
  it("imports a list, calls through the queue, and turns only the yes into pipeline deals", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "Garages Lyon", list_name: "Garages Lyon" });
    const lists = await callLists(ctx);
    expect(lists[0]).toMatchObject({ total: 3, called: 0, remaining: 3 });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    let q = await callQueue(ctx, "theo", listId);
    expect(q.queue.map((x) => x.name)).toEqual(["Garage Un (test)", "Garage Deux (test)", "Garage Trois (test)"]);
    await call(sid, { account_id: q.queue[0].accountId, outcome: "not_interested", objection: "too_expensive" });
    await call(sid, { account_id: q.queue[1].accountId, outcome: "no_answer" });
    const yes = await call(sid, { account_id: q.queue[2].accountId, outcome: "meeting", follow_up_date: "2026-11-20" });
    expect(yes.opportunityId).toBeTruthy();
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.opportunities).toHaveLength(1); // the refusal created no deal
    expect(crm.opportunities[0]).toMatchObject({ stage: "discovery_scheduled", next_action_due: "2026-11-20" });
    q = await callQueue(ctx, "theo", listId);
    expect(q.queue).toHaveLength(0); // no-answer comes back tomorrow, not today
    const s = await sessionSummary(ctx, "theo", sid);
    expect(s.stats).toMatchObject({ dials: 3, pickedUp: 2, refusals: 1, meetings: 1 });
    expect(s.stats.objections).toMatchObject([{ key: "too_expensive", count: 1, won: 0 }]);
    expect((await callLists(ctx))[0]).toMatchObject({ called: 3, reached: 2, meetings: 1, remaining: 0 });
    await endSession(ctx, "theo", sid);
  });

  it("free dialling: a refusal is counted without storing the number; a yes needs a name and lands in the pipeline", async () => {
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: "" });
    await call(sid, { phone: "06 11 22 33 44", market: "FR", outcome: "not_interested", objection: "no_need" });
    await call(sid, { phone: "06 11 22 33 45", market: "FR", outcome: "voicemail" });
    await call(sid, { outcome: "no_answer" });
    await expect(call(sid, { phone: "06 11 22 33 46", outcome: "interested" })).rejects.toThrow(/Name the business/);
    await call(sid, { phone: "06 11 22 33 46", market: "FR", outcome: "interested", business_name: "Plombier Libre (test)" });
    const sheet = JSON.stringify(fake.sheet(TEST_SHEET_ID, "ActivityEvents")!.grid);
    expect(sheet).not.toContain("0611223344");
    expect(sheet).not.toContain("+33611223344");
    expect(sheet).not.toContain("+33611223345");
    const day = await getMyDay(ctx.repo, "theo");
    expect(day.tally.calls).toBe(4);
    expect(day.tally.new_businesses).toBe(3); // two hashed numbers + one new business; the anonymous no-answer has no key
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.accounts.map((a) => a.name)).toEqual(["Plombier Libre (test)"]);
    expect(crm.opportunities[0].stage).toBe("replied");
  });

  it("a retried tap is counted once, and an opted-out business never appears in the queue", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "x", list_name: "" });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    const q = await callQueue(ctx, "theo", listId);
    const key = randomUUID();
    await call(sid, { idempotency_key: key, account_id: q.queue[1].accountId, outcome: "no_answer" });
    await call(sid, { idempotency_key: key, account_id: q.queue[1].accountId, outcome: "no_answer" });
    expect((await sessionSummary(ctx, "theo", sid)).stats.dials).toBe(1);
    const crm = await crmSnapshot(ctx.repo);
    const alex = crm.contacts.find((c) => c.full_name === "Alex")!;
    await optOutContact(ctx.repo, "pablo", { contact_id: alex.id, reason: "test" });
    expect((await callQueue(ctx, "theo", listId)).queue.map((x) => x.name)).not.toContain("Garage Un (test)");
  });
});
