import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import { FakeGoogleServer } from "@/fake-google/server";
import { GmailSender } from "@/data/google/adapters";
import { GoogleHttp } from "@/data/google/http";
import { ConsentRequiredError } from "@/data/google/ports";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { commit } from "@/server/services/imports";
import { callQueue, logCall, objectionReport, sessionSummary, startSession, callSchema } from "@/server/services/calls";
import { benchmarks, followUpQueue, listSends, markReply, sendBatch, sendFollowUp, sendSchema } from "@/server/services/email";
import { getPlaybook, savePlaybookItem } from "@/server/services/playbook";
import { addSuppression } from "@/server/services/crm";
import { BlockedError, RuleError } from "@/server/errors";
import { dedupeEvents } from "@/domain/activity";
import { freshSheetsRepo, makeRepo } from "../helpers";

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
});
afterEach(async () => {
  await fake.stop();
  await google.stop();
});

const CSV = "Company,Phone,Country,Niche,Contact,Email\nGarage Un (test),+33100000101,FR,Garages,Alex,alex@garage-un.example.com\nTaller Dos (test),+34900000102,ES,Garages,Sam,sam@taller-dos.example.com\n";
async function setup() {
  const listId = randomUUID();
  await commit(ctx.repo, "theo", { import_id: listId, csv: CSV, brand: "local", owner_founder: null, lead_source: "Test", list_name: "Test" });
  const sid = randomUUID();
  await startSession(ctx, "theo", { id: sid, list_id: listId });
  const q = await callQueue(ctx, "theo", listId);
  return { sid, fr: q.queue.find((x) => x.country === "FR")!, es: q.queue.find((x) => x.country === "ES")! };
}
const send = (p: Record<string, unknown>, grant: string | null = "founder-token-theo") => sendFollowUp(ctx, "theo", grant, sendSchema.parse({ idempotency_key: randomUUID(), channel: "email", via: "gmail", subject: "Suite à notre appel", body: "Bonjour,\nvoici le lien : https://calendly.example.com/x", template_key: "calendly", language: "FR", ...p }));

describe("Call mode v2: objections on any outcome", () => {
  it("stores every objection ticked, whatever the outcome, and reports how often each one was won over", async () => {
    const { sid, fr, es } = await setup();
    await logCall(ctx, "theo", callSchema.parse({ idempotency_key: randomUUID(), session_id: sid, outcome: "meeting", account_id: fr.accountId, objections: ["too_expensive", "send_info"], duration_sec: 185 }));
    await logCall(ctx, "theo", callSchema.parse({ idempotency_key: randomUUID(), session_id: sid, outcome: "not_interested", account_id: es.accountId, objections: ["too_expensive"], duration_sec: 40 }));
    // Read back through a fresh repository: the list round-trips through the sheet as JSON.
    const events = dedupeEvents((await makeRepo(url).list("ActivityEvents")).rows);
    const meeting = events.find((e) => e.outcome === "meeting_booked")!;
    expect(meeting.objections).toEqual(["too_expensive", "send_info"]);
    expect(meeting.objection).toBe("too_expensive");
    expect(meeting.duration_sec).toBe(185);
    const s = await sessionSummary(ctx, "theo", sid);
    expect(s.stats.objections).toEqual([
      { key: "too_expensive", count: 2, won: 1, wonRate: 0.5 },
      { key: "send_info", count: 1, won: 1, wonRate: 1 },
    ]);
    expect(s.stats.avgTalkSec).toBe(113);
    expect((await objectionReport(ctx, "theo")).team[0]).toMatchObject({ key: "too_expensive", count: 2 });
  });
});

describe("Follow-ups: Gmail send, WhatsApp, benchmarks", () => {
  it("sends through the founder's own gmail.send token, once, with a UTF-8 subject, and counts it in the day", async () => {
    const { sid, fr } = await setup();
    const key = randomUUID();
    const r = await send({ idempotency_key: key, account_id: fr.accountId, call_session_id: sid, to: fr.email });
    expect(r.send?.status).toBe("sent");
    expect(google.store.sentMail).toHaveLength(1);
    expect(google.store.sentMail[0]).toMatchObject({ to: "alex@garage-un.example.com", subject: "Suite à notre appel", by: "founder-token-theo" });
    expect(google.store.sentMail[0].body).toContain("voici le lien");
    // Retrying the same key returns the same send: no second email.
    const again = await send({ idempotency_key: key, account_id: fr.accountId, call_session_id: sid, to: fr.email });
    expect(again.duplicate).toBe(true);
    expect(google.store.sentMail).toHaveLength(1);
    const ev = dedupeEvents((await ctx.repo.list("ActivityEvents", { fresh: true })).rows).filter((e) => e.activity_type === "follow_up");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ channel: "email", account_id: fr.accountId, call_session_id: sid });
  });

  it("asks for Gmail consent when the founder has not connected it, and never sends with the service account", async () => {
    const { fr } = await setup();
    await expect(send({ account_id: fr.accountId, to: fr.email }, null)).rejects.toBeInstanceOf(ConsentRequiredError);
    await expect(send({ account_id: fr.accountId, to: fr.email }, "sa-token")).rejects.toThrow(/403/);
    expect(google.store.sentMail).toHaveLength(0);
    // The failed attempt is marked failed, so the founder can retry it after reconnecting.
    expect((await listSends(ctx))).toHaveLength(0);
  });

  it("does not resend an email whose first attempt may have left (pending), and blocks suppressed addresses", async () => {
    const { fr } = await setup();
    const key = randomUUID();
    google.faults.push({ status: 503, times: 1, method: "POST", pathIncludes: "/gmail/" });
    await expect(send({ idempotency_key: key, account_id: fr.accountId, to: fr.email })).rejects.toThrow();
    // A 503 is a clear failure: the row is "failed" and the same key may be retried.
    const ok = await send({ idempotency_key: key, account_id: fr.accountId, to: fr.email });
    expect(ok.send?.status).toBe("sent");
    expect(google.store.sentMail).toHaveLength(1);
    await addSuppression(ctx.repo, "pablo", { kind: "email", value: "blocked@garage-un.example.com", reason: "opt-out" });
    await expect(send({ account_id: fr.accountId, to: "blocked@garage-un.example.com" })).rejects.toBeInstanceOf(BlockedError);
    await expect(sendFollowUp(ctx, "theo", null, sendSchema.parse({ idempotency_key: randomUUID(), channel: "email", via: "mail_app", account_id: fr.accountId, to: "blocked@garage-un.example.com", check_only: true }))).rejects.toBeInstanceOf(BlockedError);
  });

  it("blocks Spanish cold email without consent (LSSI art. 21) but allows a follow-up after a call", async () => {
    const { es } = await setup();
    await expect(send({ account_id: es.accountId, to: es.email, context: "cold", language: "ES" })).rejects.toBeInstanceOf(RuleError);
    const r = await send({ account_id: es.accountId, to: es.email, context: "after_call", language: "ES" });
    expect(r.send?.status).toBe("sent");
  });

  it("refuses to send with a missing Calendly link placeholder", async () => {
    const { fr } = await setup();
    await expect(send({ account_id: fr.accountId, to: fr.email, body: "Lien : [add your Calendly link in Settings › Workspace]" })).rejects.toThrow(/link is missing/);
  });

  it("records a WhatsApp follow-up only once confirmed, marks replies in one tap and computes reply rates", async () => {
    const { fr, es } = await setup();
    await sendFollowUp(ctx, "theo", null, sendSchema.parse({ idempotency_key: randomUUID(), channel: "whatsapp", via: "whatsapp", account_id: fr.accountId, to: "+33100000101", body: "Bonjour" }));
    const a = await send({ account_id: fr.accountId, to: fr.email });
    await send({ account_id: es.accountId, to: es.email, language: "ES" });
    const marked = await markReply(ctx, "theo", { id: a.send!.id, expected_version: a.send!.version, reply_kind: "positive" });
    expect(marked.reply_kind).toBe("positive");
    // Marking again with the same kind does not log a second reply event.
    await markReply(ctx, "theo", { id: a.send!.id, expected_version: marked.version, reply_kind: "positive" });
    const replies = dedupeEvents((await ctx.repo.list("ActivityEvents", { fresh: true })).rows).filter((e) => e.activity_type === "reply");
    expect(replies).toHaveLength(1);
    const b = await benchmarks(ctx, "theo");
    expect(b.overall).toMatchObject({ sent: 2, replied: 1, positive: 1, rate: 0.5, enough: false });
    expect(b.whatsapp.sent).toBe(1);
    expect(b.byLanguage.map((x) => x.key).sort()).toEqual(["ES", "FR"]);
  });
});

describe("Playbook", () => {
  it("serves FR/ES defaults, lets a founder override one, and resets it with an empty body", async () => {
    let p = await getPlaybook(ctx, "theo");
    expect(p.items.find((i) => i.kind === "objection" && i.key === "too_expensive#1" && i.language === "ES")?.body).toMatch(/amortizar la inversión/);
    await savePlaybookItem(ctx, "pablo", { kind: "objection", key: "too_expensive#1", language: "ES", subject: "", body: "Nuestra respuesta" });
    p = await getPlaybook(ctx, "theo");
    expect(p.items.find((i) => i.kind === "objection" && i.key === "too_expensive#1" && i.language === "ES")?.body).toBe("Nuestra respuesta");
    await savePlaybookItem(ctx, "pablo", { kind: "objection", key: "too_expensive#1", language: "ES", subject: "", body: "" });
    p = await getPlaybook(ctx, "theo");
    expect(p.items.find((i) => i.kind === "objection" && i.key === "too_expensive#1" && i.language === "ES")?.body).toMatch(/amortizar la inversión/);
  });
});

describe("Round 4: reply variants and the message queue", () => {
  it("records which reply variant was used and reports the best one per objection", async () => {
    const { sid, fr, es } = await setup();
    await logCall(ctx, "theo", callSchema.parse({ idempotency_key: randomUUID(), session_id: sid, outcome: "meeting", account_id: fr.accountId, objections: ["too_expensive"], replies: ["too_expensive#2"] }));
    await logCall(ctx, "theo", callSchema.parse({ idempotency_key: randomUUID(), session_id: sid, outcome: "not_interested", account_id: es.accountId, objections: ["too_expensive"], replies: ["too_expensive#1"] }));
    const ev = dedupeEvents((await makeRepo(url).list("ActivityEvents")).rows).find((e) => e.outcome === "meeting_booked")!;
    expect(ev.replies).toEqual(["too_expensive#2"]);
    const r = await objectionReport(ctx, "theo");
    expect(r.variants).toEqual([{ reply: "too_expensive#1", uses: 1, won: 0 }, { reply: "too_expensive#2", uses: 1, won: 1 }]);
    expect(r.picks.too_expensive).toBe(1); // both under 5 uses: the least used, ties go to the first
    expect(r.brushOffShare).toBe(0);
  });

  it("queues a message for everyone reached, sends the batch by Gmail once, and skips Spain for cold messages", async () => {
    const { sid, fr, es } = await setup();
    await logCall(ctx, "theo", callSchema.parse({ idempotency_key: randomUUID(), session_id: sid, outcome: "not_interested", account_id: fr.accountId, objections: ["enough_work"] }));
    await logCall(ctx, "theo", callSchema.parse({ idempotency_key: randomUUID(), session_id: sid, outcome: "no_answer", account_id: es.accountId }));
    const q = await followUpQueue(ctx, "theo");
    expect(q.items.map((i) => [i.name, i.template, i.reason])).toEqual([["Garage Un (test)", "thanks_soft", "talked"]]); // ES no-answer: cold, no consent → not queued
    const it = q.items[0];
    const items = q.items.map((x) => ({ idempotency_key: randomUUID(), channel: "email" as const, via: "gmail" as const, context: x.context, account_id: x.accountId, call_session_id: "", to: x.email, subject: "Merci pour votre accueil", body: "Merci d'avoir pris mon appel.", template_key: x.template, language: x.market, market: x.market, business_name: "", contact_name: "", check_only: false }));
    const r1 = await sendBatch(ctx, "theo", "founder-token-theo", { items });
    expect(r1).toMatchObject({ sent: 1, failed: 0 });
    await sendBatch(ctx, "theo", "founder-token-theo", { items }); // retry: same keys, nothing re-sent
    expect(google.store.sentMail).toHaveLength(1);
    expect(google.store.sentMail[0].to).toBe(it.email);
    const after = await followUpQueue(ctx, "theo");
    expect(after.items).toHaveLength(0);
    expect(after.sentToday).toBe(1);
    const s = await sessionSummary(ctx, "theo", sid);
    expect(s.messages).toBe(0); // the batch was not sent from the session itself
  });

  it("blocks a cold WhatsApp to Spain without consent, like email", async () => {
    const { es } = await setup();
    await expect(sendFollowUp(ctx, "theo", null, sendSchema.parse({ idempotency_key: randomUUID(), channel: "whatsapp", via: "whatsapp", account_id: es.accountId, to: "+34900000102", body: "Hola", template_key: "missed" }))).rejects.toBeInstanceOf(RuleError);
  });
});
