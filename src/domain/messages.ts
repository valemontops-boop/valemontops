import {
  COLD_TEMPLATES, TEMPLATES, fill, findItem, hasMissingLink, suggestedFollowUp,
  type Lang, type PlaybookItem, type TemplateKey,
} from "./playbook";

/**
 * Instant messages (D059, iteration 8): the pure part of the one-click flow, shared by the call screen
 * and the messages session. Who gets what, in which language, through which channel, what is still
 * missing, which documents travel with it, and whether it was already sent. No I/O here.
 */
export type Channel = "email" | "whatsapp";
export interface SendTarget { accountId: string; name: string; contact: string; email: string; phone: string; market: Lang }
export interface PlaybookData { items: PlaybookItem[]; links: { calendly: string; deckFR: string; deckES: string; thirty?: string }; founderName: string; signature: string; /** Valemont Local monthly price, e.g. "100 €" (setting offer_local_monthly_eur). */ localPrice?: string }
export interface SentRow { account_id: string; channel: Channel; template_key: string; sent_at: string | null; status?: string; is_archived?: boolean }

/** Subject and body of a template, in the founder's language, signed by them, for this person. */
export function messageFor(pb: PlaybookData, lang: Lang, channel: Channel, template: TemplateKey, target: Pick<SendTarget, "name" | "contact">) {
  const it = findItem(pb.items, channel === "whatsapp" ? "whatsapp" : "email", template, lang);
  const v = { business: target.name, contact: target.contact, founder: pb.founderName, signature: pb.signature, calendly: pb.links.calendly, deck: lang === "ES" ? pb.links.deckES : pb.links.deckFR, thirty: pb.links.thirty, local_price: pb.localPrice };
  return { subject: channel === "email" ? fill(it?.subject ?? "", v) : "", body: fill(it?.body ?? "", v) };
}

/** A message to someone you have not talked to is cold (stricter rules: Spain needs prior consent, LSSI art. 21). */
export const contextOf = (template: TemplateKey): "cold" | "after_call" => ((COLD_TEMPLATES as readonly string[]).includes(template) ? "cold" : "after_call");

/**
 * Template chips for a call outcome: the suggested one first, then the others that make sense.
 * Cold templates are hidden for Spain (no consent recorded on the client side; the server checks again).
 */
export function templateChips(outcome: string | null, objections: readonly string[], market: Lang, offer: "local" | "thirty" | null = null): { suggested: TemplateKey | null; chips: TemplateKey[] } {
  let suggested = outcome ? suggestedFollowUp(outcome, objections, offer) : null;
  if (suggested && market === "ES" && contextOf(suggested) === "cold") suggested = null;
  const talked = outcome !== null && !["no_answer", "voicemail"].includes(outcome);
  const order: TemplateKey[] = talked ? ["thanks", "calendly", "deck", "confirm", "thanks_soft", "local", "thirty", "nudge"] : outcome ? ["missed", "calendly", "deck", "nudge"] : [...TEMPLATES];
  const allowed = order.filter((k) => !(market === "ES" && contextOf(k) === "cold"));
  return { suggested, chips: suggested ? [suggested, ...allowed.filter((k) => k !== suggested)] : allowed };
}

/** Email when there is an address, else WhatsApp when there is a number, else email (the address is asked inline). */
export function defaultChannel(t: Pick<SendTarget, "email" | "phone">): Channel {
  if (t.email.trim()) return "email";
  if (t.phone.trim()) return "whatsapp";
  return "email";
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** What must be filled in before the message can go: the address or number, and the business for a free-dial yes. */
export function missingInfo(channel: Channel, to: string, opts: { needsBusiness?: boolean; business?: string; body?: string } = {}): ("email" | "phone" | "business" | "link")[] {
  const out: ("email" | "phone" | "business" | "link")[] = [];
  if (channel === "email" && !EMAIL_RE.test(to.trim())) out.push("email");
  if (channel === "whatsapp" && to.replace(/\D/g, "").length < 8) out.push("phone");
  if (opts.needsBusiness && !opts.business?.trim()) out.push("business");
  if (opts.body && hasMissingLink(opts.body)) out.push("link");
  return out;
}

/** Documents that travel with the message, as links (Gmail compose cannot attach files): shown as chips. */
export function docsIn(body: string, links: PlaybookData["links"]): { kind: "deck" | "calendly"; url: string }[] {
  const out: { kind: "deck" | "calendly"; url: string }[] = [];
  for (const url of [links.deckFR, links.deckES]) if (url && body.includes(url) && !out.some((d) => d.kind === "deck")) out.push({ kind: "deck", url });
  if (links.calendly && body.includes(links.calendly)) out.push({ kind: "calendly", url: links.calendly });
  return out;
}

/** Phones and tablets open wa.me (the app); computers open WhatsApp Web in a tab. */
export const isMobileUA = (ua: string) => /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

/** What already went to this business (newest first), to avoid sending the same thing twice. */
export function sentTo(rows: readonly SentRow[], accountId: string): { channel: Channel; template: string; at: string }[] {
  if (!accountId) return [];
  return rows
    .filter((r) => r.account_id === accountId && !r.is_archived && (r.status ?? "sent") === "sent" && r.sent_at)
    .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
    .map((r) => ({ channel: r.channel, template: r.template_key, at: r.sent_at! }));
}

/** True when the same template already went to this business in the last `days` days (any channel). */
export function alreadySent(rows: readonly SentRow[], accountId: string, template: string, now = new Date(), days = 7): boolean {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  return sentTo(rows, accountId).some((s) => s.template === template && s.at >= since);
}

/** A message session: the next person still owed a message, skipping those done or skipped. */
export function nextInSession<T extends { key: string }>(items: readonly T[], done: ReadonlySet<string>, skipped: ReadonlySet<string>): T | null {
  return items.find((i) => !done.has(i.key) && !skipped.has(i.key)) ?? null;
}

/* ---------------- Iteration 9 (D071): instant mail while still on the phone ---------------- */

export const isEmail = (v: string) => EMAIL_RE.test(v.trim());

/**
 * Mail chips shown during a call, one click = sent: confirm the meeting / Calendly, deck, Local offer, 30/30 link,
 * thanks. Nobody picked up: "tried to reach you" (cold: never to Spain without consent) and the deck.
 * The suggested chip comes first: 30/30 after a yes to 30/30, Local after a yes to Local, the deck for "send me
 * info" / "no time", then nothing (the founder picks).
 */
export function inCallChips(p: { picked: boolean; market: Lang; objections: readonly string[]; accepted: "local" | "thirty" | null; sent: readonly TemplateKey[] }): { chips: TemplateKey[]; suggested: TemplateKey | null } {
  if (!p.picked) {
    const chips: TemplateKey[] = p.market === "ES" ? ["deck"] : ["missed", "deck"];
    const suggested = chips.find((k) => !p.sent.includes(k)) ?? null;
    return { chips, suggested };
  }
  const chips: TemplateKey[] = ["calendly", "confirm", "deck", "local", "thirty", "thanks"];
  const want: TemplateKey | null = p.accepted === "thirty" ? "thirty" : p.accepted === "local" ? "local" : p.objections.includes("send_info") || p.objections.includes("no_time") ? "deck" : null;
  return { chips, suggested: want && !p.sent.includes(want) ? want : null };
}

/** After the outcome: the message card is suggested only when nothing already went out during the call. */
export function afterCallSuggestion(outcome: string, objections: readonly string[], market: Lang, offer: "local" | "thirty" | null, sentDuringCall: readonly TemplateKey[]) {
  if (sentDuringCall.length) return null;
  const c = templateChips(outcome, objections, market, offer);
  return c.suggested ? c : null;
}
