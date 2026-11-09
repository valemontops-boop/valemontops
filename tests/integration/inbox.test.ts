import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { AppContext } from "@/server/context";
import type { DataRepository } from "@/data/repository";
import { seedBaseline } from "@/server/services/baseline";
import { addInboxItem, ingestInboxItems, inboxId, listInbox, setInboxStatus } from "@/server/services/inbox";
import { metaChallenge, verifyHmacSha256 } from "@/server/inbox-webhook";
import { deriveInboxItems, inboxItemInputSchema, metaToItems, suggestReplies } from "@/domain/inbox";
import { POST as webhookPOST } from "@/app/api/inbox/webhook/route";
import { GET as metaGET, POST as metaPOST } from "@/app/api/inbox/meta/route";
import { childId } from "@/lib/ids";
import { freshSheetsRepo } from "../helpers";

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const item = (p: Record<string, unknown> = {}) => inboxItemInputSchema.parse({ source: "instagram_comment", external_id: "ig_comment:1", account_label: "Instagram Valemont", from_name: "@client_demo", excerpt: "Super vidéo !", url: "https://www.instagram.com/", ...p });

describe("inbox webhook signatures", () => {
  const secret = "test-inbox-secret";
  const body = JSON.stringify({ source: "other", external_id: "x1" });
  it("accepts a correct HMAC-SHA256 (with or without the sha256= prefix) and rejects anything else", () => {
    expect(verifyHmacSha256(body, sign(body, secret), secret)).toBe(true);
    expect(verifyHmacSha256(body, sign(body, secret).slice(7), secret)).toBe(true);
    expect(verifyHmacSha256(body + " ", sign(body, secret), secret)).toBe(false);
    expect(verifyHmacSha256(body, sign(body, "other-secret"), secret)).toBe(false);
    expect(verifyHmacSha256(body, null, secret)).toBe(false);
    expect(verifyHmacSha256(body, "sha256=zz", secret)).toBe(false);
    expect(verifyHmacSha256(body, sign(body, secret), "")).toBe(false); // not configured → refused
  });
  it("answers Meta's subscription check only with the right verify token", () => {
    const p = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "1158201444" });
    expect(metaChallenge(p("verify-demo"), "verify-demo")).toBe("1158201444");
    expect(metaChallenge(p("wrong"), "verify-demo")).toBeNull();
    expect(metaChallenge(p("verify-demo"), undefined)).toBeNull();
  });
  it("the webhook routes refuse unsigned or unconfigured calls before touching storage", async () => {
    const req = (url: string, headers: Record<string, string> = {}, b = body) => new NextRequest(url, { method: "POST", body: b, headers });
    delete process.env.INBOX_WEBHOOK_SECRET;
    expect((await webhookPOST(req("https://app.example.com/api/inbox/webhook"))).status).toBe(503);
    process.env.INBOX_WEBHOOK_SECRET = secret;
    expect((await webhookPOST(req("https://app.example.com/api/inbox/webhook"))).status).toBe(401);
    expect((await webhookPOST(req("https://app.example.com/api/inbox/webhook", { "x-valemont-signature": sign(body, "nope") }))).status).toBe(401);
    const bad = JSON.stringify({ source: "carrier_pigeon", external_id: "x" });
    expect((await webhookPOST(req("https://app.example.com/api/inbox/webhook", { "x-valemont-signature": sign(bad, secret) }, bad))).status).toBe(400);
    delete process.env.INBOX_WEBHOOK_SECRET;
    process.env.META_APP_SECRET = "meta-secret-demo";
    expect((await metaPOST(req("https://app.example.com/api/inbox/meta", { "x-hub-signature-256": sign(body, "nope") }))).status).toBe(401);
    delete process.env.META_APP_SECRET;
    process.env.META_VERIFY_TOKEN = "verify-demo";
    const ok = await metaGET(new NextRequest("https://app.example.com/api/inbox/meta?hub.mode=subscribe&hub.verify_token=verify-demo&hub.challenge=42"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    expect((await metaGET(new NextRequest("https://app.example.com/api/inbox/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42"))).status).toBe(403);
    delete process.env.META_VERIFY_TOKEN;
  });
});

describe("Meta (Instagram) adapter", () => {
  it("turns comments and DMs into items, skips echoes and our own comments", () => {
    const items = metaToItems({
      object: "instagram",
      entry: [{
        id: "17840000000000001", time: 1_762_600_000,
        changes: [
          { field: "comments", value: { id: "c-1", text: "C'est combien ?", from: { id: "u-1", username: "client_demo" }, media: { id: "m-1" } } },
          { field: "comments", value: { id: "c-2", text: "Merci !", from: { id: "17840000000000001", username: "valemont" } } },
          { field: "mentions", value: { id: "c-3" } },
        ],
        messaging: [
          { sender: { id: "u-2" }, recipient: { id: "17840000000000001" }, timestamp: 1_762_600_000_000, message: { mid: "mid-1", text: "Bonjour, vous faites des sites ?" } },
          { sender: { id: "17840000000000001" }, recipient: { id: "u-2" }, timestamp: 1_762_600_000_000, message: { mid: "mid-2", text: "Oui", is_echo: true } },
        ],
      }],
    }, () => "Instagram Valemont");
    expect(items.map((i) => [i.source, i.external_id, i.from_name])).toEqual([["instagram_comment", "ig_comment:c-1", "@client_demo"], ["instagram_dm", "ig_dm:mid-1", ""]]);
    expect(items[0]).toMatchObject({ account_label: "Instagram Valemont", excerpt: "C'est combien ?" });
    expect(items[1].received_at).toBe(new Date(1_762_600_000_000).toISOString());
    expect(metaToItems({ object: "page", entry: [] })).toEqual([]);
  });
  it("keeps excerpts short and drops unsafe links", () => {
    const i = item({ excerpt: "x".repeat(900), url: "javascript:alert(1)" });
    expect(i.excerpt.length).toBe(500);
    expect(i.url).toBe("");
  });
});

describe("suggested replies", () => {
  it("answers a price question with the price reply, a comment with thanks, in the founder's language", () => {
    const fr = suggestReplies({ source: "instagram_comment", excerpt: "C'est combien ?", from_name: "@client_demo" }, "FR", "https://calendly.example.com/theo-demo/15min");
    expect(fr[0].key).toBe("price");
    expect(fr[0].text).toContain("https://calendly.example.com/theo-demo/15min");
    expect(suggestReplies({ source: "instagram_comment", excerpt: "Top !", from_name: "Julia Demo" }, "FR", null)[0]).toMatchObject({ key: "thanks", text: expect.stringContaining("Julia") });
    const es = suggestReplies({ source: "instagram_dm", excerpt: "Hola, info por favor", from_name: "" }, "ES", null);
    expect(es[0].key).toBe("call");
    expect(es[0].text).toMatch(/^Hola/);
    expect(es.map((r) => r.key).sort()).toEqual(["call", "price", "thanks"]);
  });
});

describe("derived items", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const send = (p: Record<string, unknown>) => ({ id: "s1", founder_key: "theo", channel: "email" as const, status: "sent", account_id: "a1", to_address: "contact@business-demo.example.com", subject: "", sent_at: "2026-11-05T09:00:00.000Z", replied_at: "2026-11-06T09:00:00.000Z", reply_kind: "positive", ...p });
  const acc = (p: Record<string, unknown> = {}) => ({ id: "a1", name: "Garage Demo", linkedin_url: "", lead_type: "outbound", lead_status: "working", lead_source: "", owner_founder: "theo", created_at: "2026-10-01T00:00:00.000Z", ...p });
  it("flags replies with no later touch, WhatsApp replies, LinkedIn replies and untouched website leads", () => {
    const r = deriveInboxItems({
      now,
      sends: [send({}), send({ id: "s2", channel: "whatsapp", to_address: "+33 1 00 00 00 00", account_id: "a2", founder_key: "pablo" }), send({ id: "s3", reply_kind: "negative", account_id: "a3" }), send({ id: "s4", reply_kind: "neutral", replied_at: "2026-10-01T09:00:00.000Z", account_id: "a4" })],
      events: [{ id: "e1", founder_key: "theo", activity_type: "reply", channel: "linkedin", account_id: "a5", occurred_at: "2026-11-08T10:00:00.000Z" }],
      accounts: [acc(), acc({ id: "a6", name: "Lead Web Demo", lead_type: "inbound", lead_status: "new", lead_source: "Formulaire site web", created_at: "2026-11-08T08:00:00.000Z", owner_founder: null })],
    });
    expect(r.map((x) => [x.source, x.external_id, x.assigned_founder])).toEqual([
      ["email_reply", "email:s1", "theo"], ["whatsapp", "whatsapp:s2", "pablo"], ["linkedin_message", "activity:e1", "theo"], ["website_form", "lead:a6", null],
    ]);
    expect(r[1].url).toBe("https://wa.me/33100000000");
  });
  it("drops a reply once we wrote, called or visited after it", () => {
    const r = deriveInboxItems({ now, sends: [send({}), send({ id: "s9", replied_at: null, reply_kind: null, sent_at: "2026-11-07T09:00:00.000Z" })], events: [], accounts: [acc()] });
    expect(r).toEqual([]);
    const r2 = deriveInboxItems({ now, sends: [send({})], events: [{ id: "e2", founder_key: "theo", activity_type: "connected_call", channel: null, account_id: "a1", occurred_at: "2026-11-07T09:00:00.000Z" }], accounts: [acc()] });
    expect(r2).toEqual([]);
  });
});

describe("inbox storage (fake Sheets)", () => {
  let fake: FakeSheetsServer;
  let ctx: AppContext;
  let repo: DataRepository;
  beforeEach(async () => {
    const env = await freshSheetsRepo();
    fake = env.fake;
    repo = env.repo;
    ctx = { repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" };
    await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  });
  afterEach(async () => fake.stop());

  it("stores a webhook item once, whatever the number of deliveries", async () => {
    expect(await ingestInboxItems(ctx, [item(), item()])).toEqual({ added: 1, duplicates: 1 });
    expect(await ingestInboxItems(ctx, [item()])).toEqual({ added: 0, duplicates: 1 });
    const rows = (await repo.list("InboxItems", { fresh: true })).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: inboxId("ig_comment:1"), status: "to_reply", source: "instagram_comment" });
  });

  it("lists items with suggested replies, marks them replied (version checked) and derives from replied emails", async () => {
    await ingestInboxItems(ctx, [item({ assigned_founder: "pablo", external_id: "ig_comment:p" }), item({ external_id: "ig_comment:t", excerpt: "Quel est le prix ?" })]);
    await repo.insert("EmailSends", [{ id: childId("t-send", "1"), idempotency_key: "k1", founder_key: "theo", account_id: "", contact_id: "", activity_event_id: "", call_session_id: "", channel: "email", via: "gmail", context: "after_call", template_key: "calendly", language: "FR", brand: null, market: "FR", niche: "", to_address: "contact@business-demo.example.com", subject: "Relance", status: "sent", sent_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), local_date: null, gmail_message_id: "", gmail_thread_id: "", replied_at: new Date(Date.now() - 86_400_000).toISOString(), reply_kind: "positive" }], { founder: "theo" });
    const theo = await listInbox(ctx, "theo", { scope: "me" });
    expect(theo.items.map((i) => i.source).sort()).toEqual(["email_reply", "instagram_comment"]);
    const comment = theo.items.find((i) => i.source === "instagram_comment")!;
    expect(comment.replies[0]).toMatchObject({ key: "price" });
    expect((await listInbox(ctx, "theo", { scope: "team" })).count).toBe(3);
    expect((await listInbox(ctx, "pablo", { scope: "me" })).items[0].replies[0].text).toMatch(/Hola|¡/);

    await setInboxStatus(ctx, "theo", { id: comment.id, status: "replied", expected_version: comment.version });
    await expect(setInboxStatus(ctx, "theo", { id: comment.id, status: "ignored", expected_version: comment.version })).rejects.toThrow(); // stale version → conflict
    const derived = theo.items.find((i) => i.derived)!;
    await setInboxStatus(ctx, "theo", { id: derived.id, status: "ignored", expected_version: 0 });
    expect((await listInbox(ctx, "theo", { scope: "me" })).count).toBe(0);
    const stored = (await repo.list("InboxItems", { fresh: true })).rows;
    expect(stored.find((r) => r.id === comment.id)).toMatchObject({ status: "replied" });
    expect(stored.find((r) => r.id === derived.id)).toMatchObject({ status: "ignored", source: "email_reply" });
  });

  it("adds an item by hand and refuses an empty one", async () => {
    await addInboxItem(ctx, "theo", { source: "linkedin_message", account_label: "LinkedIn Théo", from_name: "Marie Demo", excerpt: "Bonjour", url: "https://www.linkedin.com/messaging/", assigned_founder: "theo" });
    expect((await listInbox(ctx, "theo", { scope: "me" })).items[0]).toMatchObject({ from_name: "Marie Demo", source: "linkedin_message" });
    await expect(addInboxItem(ctx, "theo", { source: "other", account_label: "", from_name: "", excerpt: "", url: "", assigned_founder: null })).rejects.toThrow();
  });
});
