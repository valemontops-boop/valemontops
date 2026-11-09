import type { Tally } from "./activity";

/** Numbers with no data source yet are null and print as "—" (never invented). Money is in minor units (EUR cents). */
export interface DailyReportInput {
  founderName: string;
  date: string;
  tally: Tally;
  qualifiedConversations: number;
  meetingsBooked: number;
  proposalsSent: number;
  postsPublished: number;
  /** Client revenue credited to the bank today (Wise / Stripe, category "revenue"), in EUR cents. */
  cashCollectedMinor: number | null;
  nextDayPriority: string;
  /** Team totals for the day. */
  valemont: { newContacts: number; qualifiedConversations: number; meetingsHeld: number; proposalsSent: number; revenueExVatMinor: number | null };
  thirty: { videosPublished: number; siteVisits: number | null; checkouts: number | null; reportsSold: number | null };
  local: { activeSubscriptions: number | null; setupFeesMinor: number | null; aiUsage: string | null; marginAfterSupportMinor: number | null };
}

type T = (s: string, v?: Record<string, string | number>) => string;
const plain: T = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? "")) : s);
const eur = (minor: number | null) => (minor === null ? "—" : `${(minor / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/ | /g, " ")} €`);
const num = (n: number | null) => (n === null ? "—" : String(n));

/**
 * "Copy WhatsApp" daily report, format of the founder brief (round 8), in the founder's language:
 * the founder's own day, then a Valemont team summary, 30/30 and Valemont Local separately.
 */
export function formatWhatsAppReport(i: DailyReportInput, t: T = plain): string {
  // French puts a space before the colon: the separator itself is a dictionary entry (": " → " : " / ": ").
  const sep = t(": ");
  const line = (label: string, value: string) => `- ${t(label)}${sep}${value}`;
  const out: string[] = [`*${i.founderName} · ${i.date}*`, ""];
  out.push(
    line("Calls", num(i.tally.calls)),
    // Field visits are not in the brief's list; shown only on days with visits so they are never lost.
    ...(i.tally.field_visits ? [line("Field visits", num(i.tally.field_visits))] : []),
    line("LinkedIn DMs", num(i.tally.dms)),
    line("Connection requests", num(i.tally.invitations)),
    line("InMails", num(i.tally.inmails)),
    line("Cold emails", num(i.tally.cold_emails)),
    line("Follow-ups", num(i.tally.follow_ups)),
    line("Qualified conversations", num(i.qualifiedConversations)),
    line("Meetings booked", num(i.meetingsBooked)),
    line("Proposals sent", num(i.proposalsSent)),
    line("Posts published", num(i.postsPublished)),
    line("Cash collected (EUR)", eur(i.cashCollectedMinor)),
  );
  out.push("", `*${t("Tomorrow's priority:")}* ${i.nextDayPriority.trim() || t("not set")}`);
  const v = i.valemont;
  out.push("", `*${t("Valemont (team)")}*`,
    line("New contacts", num(v.newContacts)),
    line("Qualified conversations", num(v.qualifiedConversations)),
    line("Meetings held", num(v.meetingsHeld)),
    line("Proposals sent", num(v.proposalsSent)),
    line("Revenue collected ex VAT", eur(v.revenueExVatMinor)));
  out.push("", "*30/30*",
    line("Videos published", num(i.thirty.videosPublished)),
    line("Site visits", num(i.thirty.siteVisits)),
    line("Checkouts", num(i.thirty.checkouts)),
    line("Reports sold", num(i.thirty.reportsSold)));
  const l = i.local;
  out.push("", "*Valemont Local*",
    line("Active subscriptions", num(l.activeSubscriptions)),
    line("Setup fees collected", eur(l.setupFeesMinor)),
    line("AI usage", l.aiUsage ?? "—"),
    line("Margin after support", eur(l.marginAfterSupportMinor)));
  return out.join("\n");
}
