import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { commit } from "@/server/services/imports";
import { callLists, callLog, callQueue, callbackSchema, endSession, listCallbacks, logCall, scheduleCallback, sessionSummary, startSession, undoCall } from "@/server/services/calls";
import { notifications } from "@/server/services/insights";
import { sendFollowUp, sendSchema } from "@/server/services/email";
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
  await setMode(env.repo, "theo", { mode: "FULL_TIME", reason: "" });
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

  it("keeps a log of every call: newest first, per session, with outcome, objection and account", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "Garages Lyon", list_name: "Garages Lyon" });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    const q = await callQueue(ctx, "theo", listId);
    await call(sid, { account_id: q.queue[0].accountId, outcome: "not_interested", objection: "too_expensive" });
    await call(sid, { account_id: q.queue[1].accountId, outcome: "voicemail" });
    const other = randomUUID();
    await startSession(ctx, "theo", { id: other, list_id: listId });
    await call(other, { account_id: q.queue[2].accountId, outcome: "meeting", follow_up_date: "2026-11-20" });
    const session = await callLog(ctx, "theo", { session_id: sid, days: 14 });
    expect(session.map((r) => r.name)).toEqual(["Garage Deux (test)", "Garage Un (test)"]);
    expect(session[1]).toMatchObject({ outcome: "not_interested", objections: ["too_expensive"], niche: "Garages", message: null });
    const all = await callLog(ctx, "theo", { session_id: "", days: 14 });
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ name: "Garage Trois (test)", outcome: "meeting" });
    expect(await callLog(ctx, "pablo", { session_id: "", days: 14 })).toHaveLength(0);
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

describe("Call mode: session unknown to the server", () => {
  it("recreates the session instead of losing the tap (after a reload or a server restart)", async () => {
    const sid = randomUUID();
    const r = await call(sid, { outcome: "no_answer", phone: "+33100000999", market: "FR" });
    expect(r.duplicate).toBe(false);
    const s = await sessionSummary(ctx, "theo", sid);
    expect(s.stats.dials).toBe(1);
  });
});

describe("Call mode round 9: downsell ladder and instant mail during the call (D071)", () => {
  it("logs ladder outcomes: Local yes = Local deal at the monthly price, 30/30 yes = 30/30 lead and no deal, refusals keep what was offered", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "consulting", owner_founder: null, lead_source: "x", list_name: "Ladder" });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    const [a1, a2, a3] = (await callQueue(ctx, "theo", listId)).queue;
    await call(sid, { account_id: a1.accountId, outcome: "interested", offer: "local", offers_pitched: ["local"] });
    const k2 = randomUUID();
    await logCall(ctx, "theo", { idempotency_key: k2, session_id: sid, account_id: a2.accountId, phone: "", market: null, objection: null, follow_up_date: "", note: "", business_name: "", contact_name: "", contact_type: "professional_named", outcome: "interested", offer: "thirty", offers_pitched: ["local", "thirty"] } as never);
    await call(sid, { account_id: a3.accountId, outcome: "not_interested", offers_pitched: ["local", "thirty"] });
    await expect(call(sid, { account_id: a3.accountId, outcome: "not_interested", offer: "local" })).rejects.toThrow(/positive outcome/);

    const crm = await crmSnapshot(ctx.repo);
    const deals = crm.opportunities.filter((o) => !o.is_archived);
    expect(deals).toHaveLength(1); // only the yes to Local: 30/30 is not a Consulting deal
    expect(deals[0]).toMatchObject({ account_id: a1.accountId, brand: "local", value_minor: 10_000, stage: "replied" });
    expect(crm.accounts.find((a) => a.id === a2.accountId)?.brand).toBe("thirty");
    const events = (await ctx.repo.list("ActivityEvents", { fresh: true })).rows.filter((e) => e.call_session_id === sid);
    expect(events.find((e) => e.account_id === a1.accountId)?.offers_pitched).toEqual(["local_yes"]);
    expect(events.find((e) => e.account_id === a2.accountId)?.offers_pitched).toEqual(["local", "thirty_yes"]);
    expect(events.find((e) => e.account_id === a3.accountId)?.offers_pitched).toEqual(["local", "thirty"]);
    const sum = await sessionSummary(ctx, "theo", sid);
    expect(sum.ladder).toEqual({ localOffered: 3, localYes: 1, thirtyOffered: 2, thirtyYes: 1 });
    const log = await callLog(ctx, "theo", { session_id: sid, days: 14 });
    expect(log.find((r) => r.accountId === a2.accountId)).toMatchObject({ offer: "thirty", offered: ["local", "thirty"] });

    // Undo the 30/30 yes: the event no longer counts and the business gets its brand back.
    await undoCall(ctx, "theo", { idempotency_key: k2 });
    expect((await ctx.repo.get("Accounts", a2.accountId, { fresh: true }))?.brand).toBe("consulting");
  });

  it("a call with no offer creates a Consulting deal (Local only through the ladder)", async () => {
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: "" });
    await call(sid, { phone: "06 11 22 33 47", market: "FR", outcome: "meeting", business_name: "Menuiserie Conseil (test)" });
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.opportunities.find((o) => o.name === "Menuiserie Conseil (test)")).toMatchObject({ brand: "consulting", value_minor: null });
  });

  it("instant mail during the call: the spelled-out address is kept on the contact, the send is linked to the call session and the business, once", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "consulting", owner_founder: null, lead_source: "x", list_name: "Mail" });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    const [a1] = (await callQueue(ctx, "theo", listId)).queue;
    expect(a1.email).toBe("");
    const send = sendSchema.parse({ idempotency_key: randomUUID(), channel: "email", via: "mail_app", account_id: a1.accountId, call_session_id: sid, to: "alex@garage-un.example.com", subject: "Présentation", body: "Bonjour", template_key: "deck", language: "FR", market: "FR", save_address: true });
    // Gmail compose path: the server checks first (and keeps the address), then records after "Sent?".
    await sendFollowUp(ctx, "theo", null, { ...send, check_only: true });
    const contact = (await ctx.repo.list("Contacts", { fresh: true })).rows.find((c) => c.account_id === a1.accountId);
    expect(contact?.email).toBe("alex@garage-un.example.com");
    const r1 = await sendFollowUp(ctx, "theo", null, send);
    const r2 = await sendFollowUp(ctx, "theo", null, send);
    expect(r2.duplicate).toBe(true);
    expect(r1.send).toMatchObject({ call_session_id: sid, account_id: a1.accountId, template_key: "deck", status: "sent" });
    // Then the call is logged (hung up after the mail): the session counts one message.
    await call(sid, { account_id: a1.accountId, outcome: "call_back", objections: ["send_info"] });
    expect((await sessionSummary(ctx, "theo", sid)).messages).toBe(1);
    expect((await callQueue(ctx, "theo", listId)).queue.find((q) => q.accountId === a1.accountId)).toBeUndefined();
  });

  it("free dialling: a business named in an instant mail is the one the later yes lands on (never twice)", async () => {
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: "" });
    await sendFollowUp(ctx, "theo", null, sendSchema.parse({ idempotency_key: randomUUID(), channel: "email", via: "mail_app", call_session_id: sid, to: "info@toiture-libre.example.com", subject: "Présentation", body: "Bonjour", template_key: "deck", language: "FR", market: "FR", business_name: "Toiture Libre (test)" }));
    await call(sid, { phone: "06 11 22 33 48", market: "FR", outcome: "meeting", business_name: "toiture libre (test)" });
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.accounts.filter((a) => a.name.toLowerCase() === "toiture libre (test)")).toHaveLength(1);
    expect(crm.opportunities.filter((o) => o.account_id === crm.accounts.find((a) => a.name === "Toiture Libre (test)")!.id)).toHaveLength(1);
  });
});

describe("Call mode: call-backs after a missed call (D080)", () => {
  const cb = (p: Record<string, unknown>, now?: Date) => scheduleCallback(ctx, "theo", callbackSchema.parse(p), now);
  it("stores the call-back on the call (idempotent), brings it first in the queue once due, lists it and reminds once due", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "x", list_name: "" });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    const q = await callQueue(ctx, "theo", listId);
    const deux = q.queue[1];
    const key = randomUUID();
    await call(sid, { idempotency_key: key, account_id: deux.accountId, outcome: "no_answer" });
    const at = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const r1 = await cb({ idempotency_key: key, at });
    const r2 = await cb({ idempotency_key: key, at }); // a retried tap
    expect(r1).toMatchObject({ duplicate: false, accountId: deux.accountId });
    expect(r2.duplicate).toBe(true);
    const ev = (await ctx.repo.list("ActivityEvents", { fresh: true })).rows.filter((e) => e.idempotency_key === key);
    expect(ev).toHaveLength(1); // still one call, counted once
    expect(ev[0]).toMatchObject({ next_action: "Call back", next_action_at: at, version: 2 });
    expect((await sessionSummary(ctx, "theo", sid)).stats.dials).toBe(1);
    // Not due yet: out of the queue until its time; listed for My Day / Agenda; no reminder yet.
    let queue = await callQueue(ctx, "theo", listId);
    expect(queue.queue.map((x) => x.accountId)).not.toContain(deux.accountId);
    expect(await listCallbacks(ctx, "theo")).toMatchObject([{ accountId: deux.accountId, at, isDue: false }]);
    expect((await notifications(ctx, "theo")).some((n) => n.key.startsWith("callback:"))).toBe(false);
    // Once due: first in the queue (even before businesses never called), from any list, and in the bell.
    const later = new Date(Date.parse(at) + 60_000);
    queue = await callQueue(ctx, "theo", listId, 25, later);
    expect(queue.queue[0]).toMatchObject({ accountId: deux.accountId, why: "Call back due", callbackAt: at });
    expect((await callQueue(ctx, "theo", "", 25, later)).queue[0].accountId).toBe(deux.accountId);
    expect((await listCallbacks(ctx, "theo", later))[0].isDue).toBe(true);
    expect((await notifications(ctx, "theo", later)).find((n) => n.key === `callback:${key}:${at}`)).toMatchObject({ title: "Call back now", href: "/call" });
    // Moved: the new time replaces the old one (same event, no new row).
    const at2 = new Date(Date.now() + 26 * 3_600_000).toISOString();
    expect((await cb({ idempotency_key: key, at: at2 })).duplicate).toBe(false);
    expect((await listCallbacks(ctx, "theo")).map((c) => c.at)).toEqual([at2]);
    // Called again: the call-back is done.
    await call(sid, { account_id: deux.accountId, outcome: "not_interested" });
    expect(await listCallbacks(ctx, "theo")).toEqual([]);
  });

  it("a picked-up \"call back\" moves the deal's next step to the chosen day; past times, unknown calls and opted-out businesses are refused", async () => {
    const listId = randomUUID();
    await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "x", list_name: "" });
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId });
    const q = await callQueue(ctx, "theo", listId);
    const key = randomUUID();
    const yes = await call(sid, { idempotency_key: key, account_id: q.queue[0].accountId, outcome: "call_back" });
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const r = await cb({ idempotency_key: key, at });
    const opp = (await ctx.repo.list("Opportunities", { fresh: true })).rows.find((o) => o.id === yes.opportunityId)!;
    expect(opp).toMatchObject({ next_action: "Call back", next_action_due: r.due });
    await expect(cb({ idempotency_key: key, at: new Date(Date.now() - 3_600_000).toISOString() })).rejects.toThrow(/future/);
    await expect(cb({ idempotency_key: randomUUID(), at })).rejects.toThrow(/log it first/);
    // Garage Trois (contact Sam) did not pick up; Sam then opts out (asked through Pablo): no call-back for them.
    const trois = q.queue.find((x) => x.name === "Garage Trois (test)")!;
    const missedKey = randomUUID();
    await call(sid, { idempotency_key: missedKey, account_id: trois.accountId, outcome: "voicemail" });
    const sam = (await crmSnapshot(ctx.repo)).contacts.find((x) => x.full_name === "Sam")!;
    await optOutContact(ctx.repo, "pablo", { contact_id: sam.id, reason: "test" });
    await expect(cb({ idempotency_key: missedKey, at })).rejects.toThrow(/opted out|blocked|suppression/i);
    expect((await listCallbacks(ctx, "theo")).map((x) => x.accountId)).not.toContain(trois.accountId);
  });

  it("free dialling: a missed number gets its business (named once) so the call-back can be made", async () => {
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: "" });
    const key = randomUUID();
    await call(sid, { idempotency_key: key, phone: "06 11 22 33 77", market: "FR", outcome: "no_answer" });
    const at = new Date(Date.now() + 3_600_000).toISOString();
    await expect(cb({ idempotency_key: key, at })).rejects.toThrow(/Name the business/);
    const r = await cb({ idempotency_key: key, at, business_name: "Menuiserie Rappel (test)", phone: "06 11 22 33 77", market: "FR" });
    await cb({ idempotency_key: key, at, business_name: "Menuiserie Rappel (test)", phone: "06 11 22 33 77", market: "FR" });
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.accounts.filter((a) => a.name === "Menuiserie Rappel (test)")).toHaveLength(1);
    expect(crm.accounts.find((a) => a.id === r.accountId)).toMatchObject({ phone: "06 11 22 33 77", owner_founder: "theo" });
    expect(await listCallbacks(ctx, "theo")).toMatchObject([{ accountId: r.accountId, name: "Menuiserie Rappel (test)" }]);
  });
});
