import { z } from "zod";
import { FOUNDERS, type FounderKey } from "./constants";

/**
 * "To reply" inbox (round 8): comments and messages waiting for an answer, wherever they arrived.
 * Signals come from webhooks (Make/Zapier/n8n relay, Meta Instagram webhook), from data we already hold
 * (email/WhatsApp replies marked by a founder, LinkedIn replies logged, new inbound leads) and from manual adds.
 * Nothing is ever sent automatically (spec 4.15): the app suggests a reply, the founder copies it and sends it himself.
 */

export const INBOX_SOURCES = ["instagram_comment", "instagram_dm", "linkedin_comment", "linkedin_message", "email_reply", "whatsapp", "website_form", "other"] as const;
export type InboxSource = (typeof INBOX_SOURCES)[number];
export const INBOX_STATUSES = ["to_reply", "replied", "ignored"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export const INBOX_SOURCE_LABELS: Record<InboxSource, string> = {
  instagram_comment: "Instagram comment", instagram_dm: "Instagram message", linkedin_comment: "LinkedIn comment", linkedin_message: "LinkedIn message",
  email_reply: "Email reply", whatsapp: "WhatsApp", website_form: "Website form", other: "Other",
};
export const EXCERPT_MAX = 500;

/** Only http(s) links are kept: a link is rendered as "Open", never `javascript:` or `data:`. */
export const safeUrl = (v: string | null | undefined): string => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.href.slice(0, 1000) : ""; } catch { return ""; }
};
export const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The normalized item a relay (Make, Zapier, n8n, a Meta relay) posts to /api/inbox/webhook. */
export const inboxItemInputSchema = z.object({
  source: z.enum(INBOX_SOURCES),
  external_id: z.string().trim().min(1).max(200),
  account_label: z.string().trim().max(120).default(""),
  from_name: z.string().trim().max(200).default(""),
  excerpt: z.string().max(20_000).default("").transform((s) => clip(s, EXCERPT_MAX)),
  url: z.string().max(2000).default("").transform(safeUrl),
  received_at: z.string().datetime({ offset: true }).optional(),
  assigned_founder: z.enum(FOUNDERS).nullable().default(null),
});
export type InboxItemInput = z.infer<typeof inboxItemInputSchema>;
export const webhookBodySchema = z.union([inboxItemInputSchema, z.object({ items: z.array(inboxItemInputSchema).min(1).max(50) })]);

/* ---------------- Meta (Instagram) webhook adapter ---------------- */

interface MetaChange { field?: string; value?: { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } } }
interface MetaMessaging { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean } }
interface MetaEntry { id?: string; time?: number; changes?: MetaChange[]; messaging?: MetaMessaging[] }

/**
 * Instagram webhook payload (`object: "instagram"`) → normalized items: `comments` changes become comments,
 * `messaging` events become DMs. Echoes (our own messages) and anything we sent are skipped.
 */
export function metaToItems(body: unknown, labelFor: (igAccountId: string) => string = () => "Instagram"): InboxItemInput[] {
  const b = body as { object?: string; entry?: MetaEntry[] } | null;
  if (!b || b.object !== "instagram" || !Array.isArray(b.entry)) return [];
  const out: InboxItemInput[] = [];
  for (const e of b.entry) {
    const ours = String(e.id ?? "");
    const label = labelFor(ours);
    const when = (ms?: number) => (ms ? new Date(ms < 1e12 ? ms * 1000 : ms).toISOString() : undefined);
    for (const c of e.changes ?? []) {
      if ((c.field !== "comments" && c.field !== "live_comments") || !c.value?.id) continue;
      if (c.value.from?.id && c.value.from.id === ours) continue; // our own reply under the post
      out.push(inboxItemInputSchema.parse({ source: "instagram_comment", external_id: `ig_comment:${c.value.id}`, account_label: label, from_name: c.value.from?.username ? `@${c.value.from.username}` : "", excerpt: c.value.text ?? "", url: "https://www.instagram.com/", received_at: when(e.time) }));
    }
    for (const m of e.messaging ?? []) {
      if (!m.message?.mid || m.message.is_echo || (m.sender?.id && m.sender.id === ours)) continue;
      out.push(inboxItemInputSchema.parse({ source: "instagram_dm", external_id: `ig_dm:${m.message.mid}`, account_label: label, from_name: "", excerpt: m.message.text ?? "", url: "https://www.instagram.com/direct/inbox/", received_at: when(m.timestamp) }));
    }
  }
  return out;
}

/* ---------------- items derived from data we already hold ---------------- */

export interface DerivedItem extends Omit<InboxItemInput, "received_at"> { received_at: string; summary: string; summaryVars: Record<string, string> }
interface SendLite { id: string; founder_key: string; channel: "email" | "whatsapp"; status: string; account_id: string; to_address: string; subject: string; sent_at: string | null; replied_at: string | null; reply_kind: string | null; is_archived?: boolean }
interface EvLite { id: string; founder_key: string; activity_type: string; channel: string | null; account_id: string; occurred_at: string; notes?: string; is_archived?: boolean }
interface AccLite { id: string; name: string; linkedin_url: string; lead_type: string | null; lead_status: string; lead_source: string; owner_founder: string | null; created_at: string; is_archived?: boolean }

const OUTREACH = new Set(["cold_call", "connected_call", "voicemail", "field_visit", "linkedin_dm", "linkedin_invitation", "inmail", "comment", "cold_email", "follow_up", "meeting_booked"]);
const WEB_LEAD = /web|site|form|formulaire|formulario|landing|inbound|ga4|chatgpt|perplexity|ia\b|ai\b/i;

/**
 * Replies we know about but have not answered yet: email/WhatsApp replies marked "interested" or "replied"
 * with no later message, call or visit to that business; LinkedIn replies logged with no later touch;
 * new inbound website leads nobody contacted yet. Only the last `days` days.
 */
export function deriveInboxItems(i: { sends: SendLite[]; events: EvLite[]; accounts: AccLite[]; now: Date; days?: number }): DerivedItem[] {
  const since = new Date(i.now.getTime() - (i.days ?? 14) * 86_400_000).toISOString();
  const acc = new Map(i.accounts.map((a) => [a.id, a]));
  // Latest touch from us per business: sends and outreach events.
  const lastOut = new Map<string, string>();
  const bump = (id: string, at: string | null) => { if (id && at && at > (lastOut.get(id) ?? "")) lastOut.set(id, at); };
  for (const s of i.sends) if (!s.is_archived && s.status === "sent") bump(s.account_id, s.sent_at);
  for (const e of i.events) if (!e.is_archived && OUTREACH.has(e.activity_type)) bump(e.account_id, e.occurred_at);
  const answered = (accountId: string, at: string) => Boolean(accountId) && (lastOut.get(accountId) ?? "") > at;
  const founderOf = (f: string | null | undefined): FounderKey | null => (f === "theo" || f === "pablo" ? f : null);
  const out: DerivedItem[] = [];

  for (const s of i.sends) {
    if (s.is_archived || !s.replied_at || s.replied_at < since || (s.reply_kind !== "positive" && s.reply_kind !== "neutral")) continue;
    if (answered(s.account_id, s.replied_at)) continue;
    const a = acc.get(s.account_id);
    const wa = s.channel === "whatsapp";
    const phone = s.to_address.replace(/[^\d]/g, "");
    out.push({
      source: wa ? "whatsapp" : "email_reply", external_id: `${wa ? "whatsapp" : "email"}:${s.id}`, account_label: wa ? "WhatsApp" : "Gmail",
      from_name: a?.name ?? s.to_address, excerpt: "", url: wa ? (phone ? `https://wa.me/${phone}` : "") : `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(s.to_address)}`,
      received_at: s.replied_at, assigned_founder: founderOf(s.founder_key),
      summary: s.reply_kind === "positive" ? "Interested reply to your message, not answered yet" : "Reply to your message, not answered yet", summaryVars: {},
    });
  }
  for (const e of i.events) {
    if (e.is_archived || e.activity_type !== "reply" || e.channel !== "linkedin" || e.occurred_at < since || answered(e.account_id, e.occurred_at)) continue;
    const a = acc.get(e.account_id);
    out.push({
      source: "linkedin_message", external_id: `activity:${e.id}`, account_label: "LinkedIn", from_name: a?.name ?? "", excerpt: "",
      url: safeUrl(a?.linkedin_url) || "https://www.linkedin.com/messaging/", received_at: e.occurred_at, assigned_founder: founderOf(e.founder_key),
      summary: "LinkedIn reply logged, not answered yet", summaryVars: {},
    });
  }
  for (const a of i.accounts) {
    if (a.is_archived || a.lead_type !== "inbound" || a.lead_status !== "new" || a.created_at < since || !WEB_LEAD.test(a.lead_source) || lastOut.has(a.id)) continue;
    out.push({
      source: "website_form", external_id: `lead:${a.id}`, account_label: "Website", from_name: a.name, excerpt: "", url: "",
      received_at: a.created_at, assigned_founder: founderOf(a.owner_founder), summary: "New website lead, nobody contacted them yet", summaryVars: {},
    });
  }
  return out;
}

/* ---------------- suggested replies (template-based, no AI) ---------------- */

export type ReplyKey = "thanks" | "price" | "call";
const PRICE = /\b(prix|tarifs?|combien|co[uû]te?s?|devis|price|pricing|cost|precios?|cu[aá]nto|cuesta|coste|tarifas?|presupuesto)\b/i;
const TEMPLATES: Record<"FR" | "ES", Record<ReplyKey, (name: string, link: string) => string>> = {
  FR: {
    thanks: (n) => `Merci beaucoup pour votre commentaire${n ? `, ${n}` : ""} ! Ça nous fait plaisir. Si vous voulez en parler, écrivez-nous en message privé.`,
    price: (n, l) => `Bonjour${n ? ` ${n}` : ""}, merci pour votre question ! Le tarif dépend de votre activité et de ce que vous voulez automatiser. Le plus simple : 15 minutes ensemble pour vous donner un chiffre précis. ${l ? `Choisissez un créneau ici : ${l}` : "Dites-moi quand vous êtes disponible."}`,
    call: (n, l) => `Bonjour${n ? ` ${n}` : ""}, merci pour votre message ! Le plus simple est d'en parler 15 minutes. ${l ? `Choisissez le créneau qui vous arrange ici : ${l}` : "Dites-moi quand vous êtes disponible."}`,
  },
  ES: {
    thanks: (n) => `¡Muchas gracias por su comentario${n ? `, ${n}` : ""}! Nos alegra mucho. Si quiere hablarlo, escríbanos por mensaje privado.`,
    price: (n, l) => `Hola${n ? ` ${n}` : ""}, ¡gracias por su pregunta! El precio depende de su actividad y de lo que quiera automatizar. Lo más sencillo: 15 minutos juntos para darle una cifra concreta. ${l ? `Elija un hueco aquí: ${l}` : "Dígame cuándo le viene bien."}`,
    call: (n, l) => `Hola${n ? ` ${n}` : ""}, ¡gracias por su mensaje! Lo más sencillo es hablarlo 15 minutos. ${l ? `Elija el hueco que mejor le venga aquí: ${l}` : "Dígame cuándo le viene bien."}`,
  },
};

/** The reply that fits best: a price question gets the price answer, a public comment a thank-you, anything else the call invitation. */
export function bestReplyKey(item: { source: InboxSource; excerpt: string }): ReplyKey {
  if (PRICE.test(item.excerpt)) return "price";
  return item.source === "instagram_comment" || item.source === "linkedin_comment" ? "thanks" : "call";
}
/** Three ready-to-send replies in the founder's language (D053: Théo French, Pablo Spanish), the best one first. */
export function suggestReplies(item: { source: InboxSource; excerpt: string; from_name: string }, language: "FR" | "ES", calendly: string | null): { key: ReplyKey; text: string }[] {
  const first = item.from_name.startsWith("@") ? "" : item.from_name.trim().split(/\s+/)[0] ?? "";
  // Business names ("Garage Bernard (demo)") are not greeted by name.
  const name = first && item.source !== "website_form" && item.source !== "email_reply" && item.source !== "whatsapp" ? first : "";
  const best = bestReplyKey(item);
  const link = safeUrl(calendly);
  return ([best, ...(["call", "price", "thanks"] as const).filter((k) => k !== best)] as ReplyKey[]).map((key) => ({ key, text: TEMPLATES[language][key](name, link) }));
}

/** Hours since an item arrived; > 24 h is shown in red. */
export const ageHours = (receivedAt: string, now: Date) => Math.max(0, (now.getTime() - Date.parse(receivedAt)) / 3_600_000);
