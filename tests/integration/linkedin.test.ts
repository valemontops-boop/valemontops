import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { AppContext } from "@/server/context";
import { childId } from "@/lib/ids";
import { dedupeEvents } from "@/domain/activity";
import { seedBaseline } from "@/server/services/baseline";
import { commit } from "@/server/services/imports";
import { setMode } from "@/server/services/myday";
import { crmSnapshot, optOutContact } from "@/server/services/crm";
import { logCall, sessionSummary, startSession, undoCall } from "@/server/services/calls";
import { linkedinLog, linkedinQueue, linkedinSessions, linkedinSummary, logLinkedIn } from "@/server/services/linkedin";
import { BlockedError, RuleError } from "@/server/errors";
import { freshSheetsRepo } from "../helpers";

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

const CSV = "Company,Contact,LinkedIn,Country,Niche\nMenuiserie Un (test),Alex Test,https://www.linkedin.com/in/test-alex-example,FR,Menuisiers\nMenuiserie Deux (test),Sam Test,linkedin.com/in/test-sam-example,FR,Menuisiers\nMenuiserie Trois (test),Noa Test,https://www.linkedin.com/in/test-noa-example,FR,Menuisiers\n";
async function setting(key: string, value: string) {
  const cur = (await ctx.repo.list("SystemSettings", { fresh: true })).rows.find((r) => r.key === key);
  if (cur) await ctx.repo.update("SystemSettings", cur.id, cur.version, { value }, { founder: "theo" });
  else await ctx.repo.insert("SystemSettings", [{ id: childId("setting", key), key, value, description: "" }], { founder: "system" });
}
const tap = (sid: string, result: string, p: Record<string, unknown> = {}) => logLinkedIn(ctx, "theo", { idempotency_key: randomUUID(), session_id: sid, result, account_id: "", contact_id: "", profile_url: "", full_name: "", company: "", role: "", market: null, note: "", ...p } as never);
async function importList() {
  const listId = randomUUID();
  await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "LinkedIn test", list_name: "LinkedIn test" });
  return listId;
}

describe("LinkedIn session", () => {
  it("imports profiles from a CSV, logs one event per tap and walks the sequence with dated follow-ups", async () => {
    const listId = await importList();
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: listId, kind: "linkedin" });
    let q = await linkedinQueue(ctx, "theo", listId);
    expect(q.fresh.map((p) => p.firstName)).toEqual(["Alex", "Sam", "Noa"]);
    expect(q.fresh[1].linkedinUrl).toBe("linkedin.com/in/test-sam-example");
    expect(q.limits.invitations).toMatchObject({ today: 0, daily: 20, weekly: 100 });
    const [alex, sam] = q.fresh;
    const who = (p: typeof alex) => ({ account_id: p.accountId, contact_id: p.contactId });
    const inv = await tap(sid, "invited", who(alex));
    expect(inv.event).toMatchObject({ activity_type: "linkedin_invitation", channel: "linkedin", next_action: "LinkedIn: check if the invitation was accepted" });
    expect(inv.limits?.invitations.today).toBe(1);
    q = await linkedinQueue(ctx, "theo", listId);
    expect(q.fresh.map((p) => p.firstName)).toEqual(["Sam", "Noa"]); // invited: back in 7 days, not now
    // Accepted → the first message is due today, at the top of the queue.
    await tap(sid, "accepted", who(alex));
    q = await linkedinQueue(ctx, "theo", listId);
    expect(q.due[0]).toMatchObject({ firstName: "Alex", stage: "accepted", next: { template: "first_dm" } });
    const dm = await tap(sid, "messaged", who(alex));
    expect(dm.event.next_action_due! > q.today).toBe(true); // J+3
    expect(dm.event.next_action).toBe("LinkedIn: follow up");
    // A reply, a qualified conversation (deal created), then the meeting moves the same deal forward.
    await tap(sid, "replied", who(alex));
    const qual = await tap(sid, "qualified", who(alex));
    expect(qual.opportunityId).toBeTruthy();
    const meet = await tap(sid, "meeting", who(alex));
    expect(meet.opportunityId).toBe(qual.opportunityId);
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.opportunities).toHaveLength(1);
    expect(crm.opportunities[0]).toMatchObject({ stage: "discovery_scheduled", next_action: "Meeting" });
    await tap(sid, "not_interested", who(sam));
    const s = await linkedinSummary(ctx, "theo", sid);
    expect(s.stats).toMatchObject({ invitations: 1, accepted: 1, messages: 1, replies: 1, qualified: 1, meetings: 1, notInterested: 1, acceptanceRate: 1 });
    const log = await linkedinLog(ctx, "theo", { session_id: sid, days: 14 });
    expect(log.map((r) => r.result)).toEqual(["not_interested", "meeting", "qualified", "replied", "messaged", "accepted", "invited"]);
    expect((await linkedinSessions(ctx, "theo"))[0].stats.invitations).toBe(1);
    // My Day counts LinkedIn invitations and DMs against targets.
    const { getMyDay } = await import("@/server/services/myday");
    const day = await getMyDay(ctx.repo, "theo");
    expect(day.tally).toMatchObject({ invitations: 1, dms: 1 });
  });

  it("never exceeds the invitation limit or the InMail budget, and a retry still returns the original tap", async () => {
    const listId = await importList();
    await setting("linkedin_daily_invitation_limit", "2");
    await setting("inmail_monthly_budget", "1");
    const sid = randomUUID();
    const q = await linkedinQueue(ctx, "theo", listId);
    const key = randomUUID();
    const first = await tap(sid, "invited", { idempotency_key: key, account_id: q.fresh[0].accountId, contact_id: q.fresh[0].contactId });
    await tap(sid, "invited", { account_id: q.fresh[1].accountId, contact_id: q.fresh[1].contactId });
    await expect(tap(sid, "invited", { account_id: q.fresh[2].accountId, contact_id: q.fresh[2].contactId })).rejects.toThrow(/Daily invitation limit reached \(2\/2\)/);
    const again = await tap(sid, "invited", { idempotency_key: key, account_id: q.fresh[0].accountId, contact_id: q.fresh[0].contactId });
    expect(again).toMatchObject({ duplicate: true });
    expect(again.event.id).toBe(first.event.id);
    await tap(sid, "inmail", { account_id: q.fresh[2].accountId, contact_id: q.fresh[2].contactId });
    await expect(tap(sid, "inmail", { account_id: q.fresh[2].accountId, contact_id: q.fresh[2].contactId })).rejects.toBeInstanceOf(RuleError);
    const events = dedupeEvents((await ctx.repo.list("ActivityEvents", { fresh: true })).rows);
    expect(events.filter((e) => e.activity_type === "linkedin_invitation")).toHaveLength(2);
    expect(events.filter((e) => e.activity_type === "inmail")).toHaveLength(1);
    expect((await linkedinQueue(ctx, "theo", listId)).limits.invitations).toMatchObject({ blocked: true, left: 0 });
  });

  it("free mode creates the prospect from a pasted profile once, and opted-out people are never offered nor logged", async () => {
    const sid = randomUUID();
    const url = "https://fr.linkedin.com/in/test-free-example/";
    const a = await tap(sid, "invited", { profile_url: url, full_name: "Camille Libre", company: "Atelier Libre (test)" });
    const b = await tap(sid, "accepted", { profile_url: "linkedin.com/in/test-free-example" });
    expect(b.event.account_id).toBe(a.event.account_id);
    expect(b.event.contact_id).toBe(a.event.contact_id);
    await expect(tap(sid, "invited", { profile_url: "https://example.com/x", full_name: "X" })).rejects.toThrow(/LinkedIn profile link/);
    const crm = await crmSnapshot(ctx.repo);
    expect(crm.contacts.filter((c) => c.linkedin_url === "https://www.linkedin.com/in/test-free-example")).toHaveLength(1);

    const listId = await importList();
    const q = await linkedinQueue(ctx, "theo", listId);
    await optOutContact(ctx.repo, "pablo", { contact_id: q.fresh[0].contactId, reason: "test" });
    expect((await linkedinQueue(ctx, "theo", listId)).fresh.map((p) => p.firstName)).toEqual(["Sam", "Noa"]);
    await expect(tap(sid, "invited", { account_id: q.fresh[0].accountId, contact_id: q.fresh[0].contactId })).rejects.toBeInstanceOf(BlockedError);
  });
});

describe("Call mode undo", () => {
  it("undoes the last tap: the call no longer counts and the deal it created is archived", async () => {
    const sid = randomUUID();
    await startSession(ctx, "theo", { id: sid, list_id: "" });
    const key = randomUUID();
    const r = await logCall(ctx, "theo", { idempotency_key: key, session_id: sid, outcome: "meeting", account_id: "", phone: "", market: "FR", objection: null, objections: [], replies: [], list_id: "", duration_sec: null, follow_up_date: "", note: "", business_name: "Undo Garage (test)", contact_name: "", contact_type: "professional_named" });
    expect(r.opportunityId).toBeTruthy();
    expect((await sessionSummary(ctx, "theo", sid)).stats.meetings).toBe(1);
    await undoCall(ctx, "theo", { idempotency_key: key });
    expect((await sessionSummary(ctx, "theo", sid)).stats).toMatchObject({ dials: 0, meetings: 0 });
    const opp = await ctx.repo.get("Opportunities", r.opportunityId!, { fresh: true });
    expect(opp?.is_archived).toBe(true);
    await expect(undoCall(ctx, "pablo", { idempotency_key: key })).rejects.toThrow(/Nothing to undo/);
  });
});
