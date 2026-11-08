import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { MARKETS, type FounderKey } from "@/domain/constants";
import { emailBenchmarks } from "@/domain/email";
import { normalizeEmail, normalizePhone } from "@/domain/normalize";
import { outreachBlock } from "@/domain/suppression";
import { localDate } from "@/domain/time";
import { ConsentRequiredError } from "@/data/google/ports";
import { GMAIL_SCOPE } from "../gmail-grant";
import { BlockedError, RuleError } from "../errors";
import type { AppContext } from "../context";
import { logActivity, logActivitySchema } from "./activities";
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
});
export type SendInput = z.infer<typeof sendSchema>;

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Sends (Gmail) or records (mail app, WhatsApp, confirmed by the founder) one follow-up.
 * Idempotent per key. A Gmail send that may have left but was not confirmed is never re-sent blindly.
 */
export async function sendFollowUp(ctx: AppContext, founder: FounderKey, grant: string | null, input: SendInput) {
  if (input.channel === "email" && !EMAIL_RE.test(input.to)) throw new RuleError("Enter a valid email address.");
  if (input.channel === "whatsapp" && normalizePhone(input.to, input.market).replace(/\D/g, "").length < 8) throw new RuleError("Enter the WhatsApp number with its country code.");
  if (input.via === "gmail" && input.channel !== "email") throw new RuleError("Gmail only sends emails.");
  if (input.via === "gmail" && (!input.subject || !input.body.trim())) throw new RuleError("Write a subject and a message.");
  if (/\[add (your Calendly|the deck) link/.test(input.body)) throw new RuleError("A link is missing: add it in Settings › Workspace first.");

  const sendId = childId(input.idempotency_key, "send");
  const existing = await ctx.repo.get("EmailSends", sendId, { fresh: true });
  if (existing?.status === "sent") return { send: existing, duplicate: true, warnings: [] as string[] };
  if (existing?.status === "pending" && existing.via === "gmail") throw new RuleError("We could not confirm whether this email left. Check Gmail › Sent before sending it again.");

  const t = await ctx.repo.listMany(["Accounts", "Contacts", "SuppressionList"]);
  const account = input.account_id ? t.Accounts.rows.find((a) => a.id === input.account_id) ?? null : null;
  if (input.account_id && !account) throw new RuleError("The selected business no longer exists.");
  const contacts = account ? t.Contacts.rows.filter((c) => c.account_id === account.id) : [];
  const contact = contacts.find((c) => (input.channel === "email" ? normalizeEmail(c.email) === normalizeEmail(input.to) : normalizePhone(c.phone, account?.country) === normalizePhone(input.to, account?.country))) ?? contacts[0] ?? null;
  // Hard block on fresh suppression data, also for the typed address itself (spec 5.5).
  const supp = (await ctx.repo.list("SuppressionList", { fresh: true })).rows;
  const typed = { id: "", consent_status: contact?.consent_status ?? "unknown", email: input.channel === "email" ? input.to : "", phone: input.channel === "whatsapp" ? input.to : "" };
  for (const b of [outreachBlock(contact as never, account as never, supp), outreachBlock(typed as never, account as never, supp)]) if (b.blocked) throw new BlockedError(b.reason ?? "Outreach is blocked.");
  const market = account?.country ?? input.market;
  if (input.context === "cold" && input.channel === "email" && market === "ES" && contact?.consent_status !== "consented") {
    throw new RuleError("Spanish cold email needs prior consent (LSSI art. 21). Call first, or record the consent on the contact.");
  }
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
