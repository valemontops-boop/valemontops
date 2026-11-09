/**
 * Prospect email benchmarks. Reply rate = replies / emails sent (the denominator matters: some public
 * figures divide by delivered or opened). No open tracking: pixels are unreliable and intrusive.
 */

export interface SendRow {
  channel: "email" | "whatsapp";
  context: "after_call" | "cold";
  status: "pending" | "sent" | "failed";
  template_key: string;
  language: "FR" | "ES" | null;
  niche: string;
  sent_at: string | null;
  replied_at: string | null;
  reply_kind: "positive" | "neutral" | "negative" | "bounce" | null;
  is_archived?: boolean;
}

/** Public cold-email reply-rate ranges (replies ÷ sent). Only comparable with our COLD emails. */
export const EXTERNAL_BENCHMARKS = {
  coldTypical: { low: 0.01, high: 0.05, label: "Typical B2B cold email" },
  coldStrong: { low: 0.05, high: 0.1, label: "Strong: small, well-targeted lists" },
  sources: [
    { name: "Instantly, Cold Email Benchmark 2026 (3.43% average reply rate)", url: "https://instantly.ai/blog/cold-email-reply-rate-benchmarks" },
    { name: "Leadsforge, B2B cold email benchmarks (1–3% typical, 3–5% strong, 5–8%+ top)", url: "https://www.leadsforge.ai/blog/cold-email-benchmarks-b2b-success" },
    { name: "Saleshandy, cold email statistics (5.8% for sends under 50 recipients vs 2.1% above)", url: "https://www.saleshandy.com/blog/?p=39797" },
    { name: "Belkins, cold email response rates by industry", url: "https://belkins.io/blog/cold-email-response-rates" },
    { name: "Apollo, reply-rate benchmarks for cold outreach (3–6% healthy)", url: "https://www.apollo.io/insights/what-is-a-good-benchmark-for-reply-rates-in-cold-outreach" },
  ],
} as const;

export interface Rate { sent: number; replied: number; positive: number; rate: number | null; positiveRate: number | null; enough: boolean }
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function rate(rows: SendRow[], minSample: number): Rate {
  const sent = rows.length;
  const replied = rows.filter((r) => r.replied_at && r.reply_kind !== "bounce").length;
  const positive = rows.filter((r) => r.reply_kind === "positive").length;
  return { sent, replied, positive, rate: sent ? replied / sent : null, positiveRate: sent ? positive / sent : null, enough: sent >= minSample };
}

function groupBy(rows: SendRow[], key: (r: SendRow) => string, minSample: number) {
  const m = new Map<string, SendRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].map(([k, v]) => ({ key: k, ...rate(v, minSample) })).sort((a, b) => b.sent - a.sent);
}

export function emailBenchmarks(all: SendRow[], tz: string, minSample = 20) {
  const emails = all.filter((r) => !r.is_archived && r.channel === "email" && r.status === "sent");
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz });
  const bounces = emails.filter((r) => r.reply_kind === "bounce").length;
  const overall = rate(emails, minSample);
  const cold = rate(emails.filter((r) => r.context === "cold"), minSample);
  const warm = rate(emails.filter((r) => r.context === "after_call"), minSample);
  const verdict = (r: Rate) => {
    if (!r.enough || r.rate === null) return "not_enough_data" as const;
    if (r.rate < EXTERNAL_BENCHMARKS.coldTypical.low) return "below" as const;
    if (r.rate < EXTERNAL_BENCHMARKS.coldStrong.low) return "typical" as const;
    return "strong" as const;
  };
  return {
    overall,
    cold: { ...cold, verdict: verdict(cold) },
    afterCall: warm,
    bounceRate: emails.length ? bounces / emails.length : null,
    byTemplate: groupBy(emails, (r) => r.template_key || "custom", minSample),
    byLanguage: groupBy(emails, (r) => r.language ?? "—", minSample),
    byWeekday: WEEKDAYS.map((d) => ({ key: d, ...rate(emails.filter((r) => r.sent_at && wd.format(new Date(r.sent_at)) === d), minSample) })).filter((x) => x.sent > 0),
    byNiche: groupBy(emails, (r) => r.niche || "—", minSample).slice(0, 8),
    whatsapp: rate(all.filter((r) => !r.is_archived && r.channel === "whatsapp" && r.status === "sent"), minSample),
    minSample,
    external: EXTERNAL_BENCHMARKS,
  };
}
export type EmailBenchmarks = ReturnType<typeof emailBenchmarks>;
