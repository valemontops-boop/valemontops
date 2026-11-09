import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { MARKETS, type FounderKey } from "@/domain/constants";
import { emailBenchmarks } from "@/domain/email";
import { COLD_TEMPLATES, TEMPLATES } from "@/domain/playbook";
import { normalizeEmail, normalizePhone } from "@/domain/normalize";
import { outreachBlock } from "@/domain/suppression";
import { addDays, localDate } from "@/domain/time";
import { dedupeEvents } from "@/domain/activity";
import { objectionsOf } from "@/domain/calls";
import { hasMissingLink, suggestedFollowUp } from "@/domain/playbook";
import { ConsentRequiredError } from "@/data/google/ports";
import { GMAIL_SCOPE } from "../gmail-grant";
import { BlockedError, RuleError } from "../errors";
import type { AppContext } from "../context";
import { logActivity, logActivitySchema } from "./activities";
import { findByName } from "./calls";
import { settingValue, userRow } from "./common";

const optUuid = z.union([z.literal(""), z.string().uuid()]).default("");
export const sendSchema = z.object({
  idempotency_key: z.string().uuid(),
  channel: z.enum(["email", "whatsapp"]),
  via: z.enum(["gmail", "mail_app", "whatsapp"]),
  context: z.enum(["after_call", "cold"]).default("after_call"),
  account_id: optUuid,
  call_session_id: optUuid,
  to: z.string().trim().min(3).max(200),
  subject: z.string().trim().max(300).default(""),
  body: z.string().max(10_000).default(""),
  template_key: z.string().trim().max(60).default(""),
  language: z.enum(["FR", "ES"]).nullable().default(null),
  market: z.enum(MARKETS).nullable().default(null),
  /** Free dialling: a follow-up to someone not yet in the CRM creates the business. */
  business_name: z.string().trim().max(200).default(""),
  contact_name: z.string().trim().max(200).default(""),
  /** Only run the checks (suppression, consent), e.g. before opening the mail app or WhatsApp. */
  check_only: z.boolean().default(false),
  /** Instant mail during a call (D071): the address the prospect spelled out is kept on the contact / business. */
  save_address: z.boolean().optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Sends (Gmail) or records (mail app, WhatsApp, confirmed by the founder) one follow-up.
 * Idempotent per key. A Gmail send that may have left but was not confirmed is never re-sent blindly.
 */
export async function sendFollowUp(ctx: AppContext, founder: FounderKey, grant: string | null, raw: SendInput) {
  // A "tried to reach you" message is cold whatever the caller says: no conversation happened.
  const input = { ...raw, context: raw.context === "cold" || (COLD_TEMPLATES as readonly string[]).includes(raw.template_key) ? ("cold" as const) : raw.context };
  if (input.channel === "email" && !EMAIL_RE.test(input.to)) throw new RuleError("Enter a valid email address.");
  if (input.channel === "whatsapp" && normalizePhone(input.to, input.market).replace(/\D/g, "").length < 8) throw new RuleError("Enter the WhatsApp number with its country code.");
  if (input.via === "gmail" && input.channel !== "email") throw new RuleError("Gmail only sends emails.");
  if (input.via === "gmail" && (!input.subject || !input.body.trim())) throw new RuleError("Write a subject and a message.");
  if (hasMissingLink(input.body)) throw new RuleError("A link is missing: add it in Settings › Workspace first.");

  const sendId = childId(input.idempotency_key, "send");
  const existing = await ctx.repo.get("EmailSends", sendId, { fresh: true });
  if (existing?.status === "sent") return { send: existing, duplicate: true, warnings: [] as string[] };
  if (existing?.status === "pending" && existing.via === "gmail") throw new RuleError("We could not confirm whether this email left. Check Gmail › Sent before sending it again.");

  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList"]);
  // Free dialling: the business named here may already exist (a "yes" logged first): reuse it.
  const byName = !input.account_id && input.business_name ? await findByName(ctx, founder, input.business_name) : null;
  const account = input.account_id || byName ? t.Accounts.rows.find((a) => a.id === (input.account_id || byName)) ?? null : null;
  if (input.account_id && !account) throw new RuleError("The selected business no longer exists.");
  const contacts = account ? t.Contacts.rows.filter((c) => c.account_id === account.id) : [];
  const contact = contacts.find((c) => (input.channel === "email" ? normalizeEmail(c.email) === normalizeEmail(input.to) : normalizePhone(c.phone, account?.country) === normalizePhone(input.to, account?.country))) ?? contacts[0] ?? null;
  // Hard block on fresh suppression data, also for the typed address itself (spec 5.5).
  const supp = (await ctx.repo.list("SuppressionList", { fresh: true })).rows;
  const typed = { id: "", consent_status: contact?.consent_status ?? "unknown", email: input.channel === "email" ? input.to : "", phone: input.channel === "whatsapp" ? input.to : "" };
  for (const b of [outreachBlock(contact as never, account as never, supp), outreachBlock(typed as never, account as never, supp)]) if (b.blocked) throw new BlockedError(b.reason ?? "Outreach is blocked.");
  const market = account?.country ?? input.market;
  if (input.context === "cold" && market === "ES" && contact?.consent_status !== "consented") {
    throw new RuleError(`Spain: a ${input.channel === "email" ? "cold email" : "cold WhatsApp message"} needs prior consent (LSSI art. 21). Wait until you have talked, or record the consent on the contact.`);
  }
  if (input.save_address && input.channel === "email" && account) await saveAddress(ctx, founder, account, contacts, input.to);
  if (input.check_only) return { send: null, duplicate: false, warnings: [] as string[] };

  const mailer = input.via === "gmail" ? ctx.mailerFor(founder, grant) : null;
  if (input.via === "gmail" && !mailer) throw new ConsentRequiredError(GMAIL_SCOPE, "/api/auth/google/gmail?back=/call");

  const u = await userRow(ctx.repo, founder);
  const now = new Date();
  const base = {
    idempotency_key: input.idempotency_key, founder_key: founder, account_id: account?.id ?? "", contact_id: contact?.id ?? "", activity_event_id: "",
    call_session_id: input.call_session_id, channel: input.channel, via: input.via, context: input.context, template_key: input.template_key,
    language: input.language, brand: account?.brand ?? null, market: market ?? null, niche: account?.niche ?? "", to_address: input.to, subject: input.subject,
    sent_at: null, local_date: null, gmail_message_id: "", gmail_thread_id: "", replied_at: null, reply_kind: null,
  } as const;
  let row: Row<"EmailSends">;
  if (input.via === "gmail") {
    row = existing ? await ctx.repo.update("EmailSends", sendId, existing.version, { status: "pending" }, { founder }) : (await ctx.repo.insert("EmailSends", [{ id: sendId, ...base, status: "pending" }], { founder }))[0];
    let res: { id: string; threadId: string };
    try {
      res = await mailer!.send({ to: input.to, subject: input.subject, body: input.body });
    } catch (e) {
      await ctx.repo.update("EmailSends", sendId, row.version, { status: "failed" }, { founder }).catch(() => undefined);
      throw e;
    }
    row = await ctx.repo.update("EmailSends", sendId, row.version, { status: "sent", sent_at: now.toISOString(), local_date: localDate(now, u.timezone), gmail_message_id: res.id, gmail_thread_id: res.threadId }, { founder });
  } else {
    const done = { status: "sent" as const, sent_at: now.toISOString(), local_date: localDate(now, u.timezone) };
    row = existing ? await ctx.repo.update("EmailSends", sendId, existing.version, done, { founder }) : (await ctx.repo.insert("EmailSends", [{ id: sendId, ...base, ...done }], { founder }))[0];
  }

  // The follow-up counts in the founder's day as one event (retry-safe child key).
  const ev = await logActivity(ctx.repo, founder, logActivitySchema.parse({
    idempotency_key: childId(input.idempotency_key, "event"),
    activity_type: input.context === "cold" && input.channel === "email" ? "cold_email" : "follow_up",
    channel: input.channel,
    account_id: account?.id ?? "",
    notes: `${input.channel === "email" ? "Email" : "WhatsApp"}${input.template_key ? ` · ${input.template_key}` : ""}${input.language ? ` · ${input.language}` : ""}`,
    call_session_id: input.call_session_id,
    market: market ?? null,
    fast_contact: !account && input.business_name ? { company_name: input.business_name, contact_name: input.contact_name, phone: input.channel === "whatsapp" ? input.to : "", email: input.channel === "email" ? input.to : "", country: market ?? "FR", contact_type: "professional_named", niche: "" } : null,
  }));
  if (!row.activity_event_id || (!row.account_id && ev.event.account_id)) {
    row = await ctx.repo.update("EmailSends", sendId, row.version, { activity_event_id: ev.event.id, account_id: row.account_id || ev.event.account_id, contact_id: row.contact_id || ev.event.contact_id }, { founder });
  }
  return { send: row, duplicate: false, warnings: ev.warnings };
}

/** Keeps a typed email on the business's contact (or the business itself) when none is known yet; never overwrites. */
async function saveAddress(ctx: AppContext, founder: FounderKey, account: Row<"Accounts">, contacts: Row<"Contacts">[], to: string) {
  if (contacts.some((c) => normalizeEmail(c.email) === normalizeEmail(to)) || normalizeEmail(account.email) === normalizeEmail(to)) return;
  const c = contacts.find((x) => !x.is_archived && !x.email);
  if (c) {
    const fresh = await ctx.repo.get("Contacts", c.id, { fresh: true });
    if (fresh && !fresh.email) await ctx.repo.update("Contacts", c.id, fresh.version, { email: to }, { founder });
  } else if (!account.email) {
    const fresh = await ctx.repo.get("Accounts", account.id, { fresh: true });
    if (fresh && !fresh.email) await ctx.repo.update("Accounts", account.id, fresh.version, { email: to }, { founder });
  }
}

export const replySchema = z.object({ id: z.string().uuid(), expected_version: z.number().int().min(1), reply_kind: z.enum(["positive", "neutral", "negative", "bounce"]).nullable() });

/** One tap when a prospect answers. The first real reply is also logged as a "reply" activity. */
export async function markReply(ctx: AppContext, founder: FounderKey, input: z.infer<typeof replySchema>) {
  const cur = await ctx.repo.get("EmailSends", input.id, { fresh: true });
  if (!cur) throw new RuleError("Send not found");
  const row = await ctx.repo.update("EmailSends", input.id, input.expected_version, { reply_kind: input.reply_kind, replied_at: input.reply_kind ? cur.replied_at ?? new Date().toISOString() : null }, { founder });
  if (input.reply_kind && input.reply_kind !== "bounce" && cur.account_id) {
    await logActivity(ctx.repo, founder, logActivitySchema.parse({ idempotency_key: childId(input.id, "reply"), activity_type: "reply", channel: cur.channel, account_id: cur.account_id, outcome: input.reply_kind === "positive" ? "interested" : input.reply_kind === "negative" ? "not_interested" : null, notes: `Reply to ${cur.channel === "email" ? "email" : "WhatsApp"}` }));
  }
  return row;
}

export async function listSends(ctx: AppContext) {
  const t = await ctx.repo.listMany(["EmailSends", "Accounts"]);
  const name = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));
  return t.EmailSends.rows.filter((r) => !r.is_archived && r.status === "sent").sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? "")).slice(0, 100)
    .map((r) => ({ ...r, account_name: name.get(r.account_id) ?? "" }));
}

export async function benchmarks(ctx: AppContext, founder: FounderKey) {
  const { rows } = await ctx.repo.list("EmailSends");
  const u = await userRow(ctx.repo, founder);
  const min = Number(await settingValue(ctx.repo, "conversion_min_sample")) || 20;
  return emailBenchmarks(rows, u.timezone, min);
}

/* ---------------- follow-up queue: as many messages as possible, one click each ---------------- */

type QueueReason = "talked" | "no_answer" | "no_reply";
export interface QueueItem {
  key: string; accountId: string; name: string; contact: string; email: string; phone: string; market: "FR" | "ES";
  template: (typeof TEMPLATES)[number]; reason: QueueReason; outcome: string; at: string; context: "after_call" | "cold";
}

/**
 * Everyone who should get a message and has not: people reached on the phone in the last 2 days (thank-you,
 * Calendly, deck, confirmation), people who did not pick up today (France only: Spain needs consent), and
 * emails with no reply after 3 days (one nudge). Blocked contacts never appear.
 */
export async function followUpQueue(ctx: AppContext, founder: FounderKey) {
  const t = await ctx.repo.listMany(["ActivityEvents", "Accounts", "Contacts", "SuppressionList", "EmailSends"]);
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const events = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.founder_key === founder && e.account_id);
  const sends = t.EmailSends.rows.filter((r) => !r.is_archived && r.status === "sent");
  const lastSend = new Map<string, string>();
  for (const r of sends) if ((r.sent_at ?? "") > (lastSend.get(r.account_id) ?? "")) lastSend.set(r.account_id, r.sent_at ?? "");
  const out = new Map<string, QueueItem>();
  const acc = new Map(t.Accounts.rows.map((a) => [a.id, a]));
  const add = (accountId: string, item: Omit<QueueItem, "key" | "accountId" | "name" | "contact" | "email" | "phone" | "market">) => {
    const a = acc.get(accountId);
    if (!a || a.is_archived || out.has(accountId)) return;
    const cs = t.Contacts.rows.filter((c) => c.account_id === a.id && !c.is_archived);
    if (outreachBlock(null, a, t.SuppressionList.rows).blocked || (cs.length > 0 && cs.every((c) => outreachBlock(c, a, t.SuppressionList.rows).blocked))) return;
    const c = cs.find((x) => x.email) ?? cs[0];
    const email = c?.email || a.email;
    const phone = c?.phone || a.phone;
    if (!email && !phone) return;
    const market = (a.country ?? "FR") as "FR" | "ES";
    if (item.context === "cold" && market === "ES" && c?.consent_status !== "consented") return;
    out.set(accountId, { key: `${accountId}:${item.template}:${item.at.slice(0, 10)}`, accountId, name: a.name, contact: c?.full_name ?? "", email, phone, market, ...item });
  };
  const since = addDays(today, -1);
  // Latest call per business in the window; skip if a message already went out after it.
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of events) if (["connected_call", "cold_call", "voicemail"].includes(e.activity_type) && e.local_date >= since && e.occurred_at > (latest.get(e.account_id)?.occurred_at ?? "")) latest.set(e.account_id, e);
  for (const e of [...latest.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))) {
    if ((lastSend.get(e.account_id) ?? "") > e.occurred_at) continue;
    const outcome = e.outcome === "meeting_booked" ? "meeting" : e.outcome === "interested" ? "interested" : e.outcome === "callback_requested" ? "call_back" : e.outcome === "not_interested" ? "not_interested" : e.outcome === "gatekeeper" ? "gatekeeper" : e.activity_type === "voicemail" ? "voicemail" : "no_answer";
    const tpl = suggestedFollowUp(outcome, objectionsOf(e));
    if (!tpl) continue;
    const cold = tpl === "missed";
    if (cold && e.local_date !== today) continue;
    add(e.account_id, { template: tpl, reason: cold ? "no_answer" : "talked", outcome, at: e.occurred_at, context: cold ? "cold" : "after_call" });
  }
  // One nudge per email left without a reply for 3 days (never a nudge of a nudge).
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  for (const r of sends.filter((x) => x.founder_key === founder && x.channel === "email" && !x.replied_at && x.template_key !== "nudge" && x.template_key !== "thanks_soft" && (x.sent_at ?? "") < cutoff && (x.sent_at ?? "") > addDays(today, -21))) {
    if ((lastSend.get(r.account_id) ?? "") > (r.sent_at ?? "")) continue;
    add(r.account_id, { template: "nudge", reason: "no_reply", outcome: "", at: r.sent_at ?? "", context: r.context });
  }
  const items = [...out.values()];
  const sentToday = sends.filter((r) => r.founder_key === founder && r.local_date === today).length;
  return { items, sentToday };
}

export const batchSchema = z.object({ items: z.array(sendSchema).min(1).max(40) });
/** Sends a reviewed batch one by one; each item keeps its own idempotency key, so a retry never double-sends. */
export async function sendBatch(ctx: AppContext, founder: FounderKey, grant: string | null, input: z.infer<typeof batchSchema>) {
  const results: { idempotency_key: string; ok: boolean; message?: string }[] = [];
  for (const it of input.items) {
    try {
      await sendFollowUp(ctx, founder, grant, it);
      results.push({ idempotency_key: it.idempotency_key, ok: true });
    } catch (e) {
      if (e instanceof ConsentRequiredError) throw e;
      results.push({ idempotency_key: it.idempotency_key, ok: false, message: (e as Error).message });
    }
  }
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
