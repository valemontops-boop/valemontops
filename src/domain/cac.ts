/**
 * Cost per channel (iteration 9): social networks are not free, they cost time.
 * CAC = (time spent × founder hour cost + money spent) / clients won, and cost per meeting = the same cost / meetings
 * (won counts are small, so the cost per meeting is the number to read first). Pure functions, amounts in EUR cents.
 *
 * Time per channel:
 * - outreach (calls, visits, LinkedIn outreach, email, WhatsApp): logged actions × minutes per action;
 * - social networks: content produced (ContentLog deliverables × minutes per deliverable) + estimated minutes of
 *   done marketing tasks; LinkedIn posts count for LinkedIn, concepts, Reels, stories and VSL for Instagram;
 * - web and AI engines: estimated minutes of done tasks about the site (title mentions site, web, SEO, page, blog…),
 *   shared between web and AI engines in proportion to their visits.
 * Money = ALL our costs of the period from Money (bank movements, debits in EUR; D072): a cost goes straight to a channel
 * when its category or text makes it clear (Sales Navigator → LinkedIn, telecom → calls, ads → web/social, travel → field
 * visits…); every other cost (Workspace, hosting, accounting, contractors…) is shared by each channel's share of time.
 * Not costs: client revenue, founder contributions, transfers between our balances, other income, taxes.
 * With no advertising movement, the monthly ads budget setting is used pro rata (Web).
 *
 * Sources (researched November 2026; benchmarks are guides, not targets):
 * - Fully loaded vs blended vs channel CAC: Cut the SaaS, "How to Calculate CAC" https://cut-the-saas.com/guides/how-to-calculate-cac ;
 *   The Starr Conspiracy, "CAC calculation methods" https://www.thestarrconspiracy.com/insights/comparisons/cac-calculation-methods ;
 *   Logic Based Marketing, "Your real customer acquisition cost" https://logicbasedmarketing.com/blog/fully-loaded-blended-cac.html
 *   (leaving salaries, tools and overhead out understates CAC by 30–60 %).
 * - Founder time valued at an hour cost: Development Corporate, "Understanding CAC" https://developmentcorporate.com/product-management/understanding-cac-why-your-customer-acquisition-cost-is-higher-than-you-think/ ;
 *   Practical Founders, "8 common mistakes founders make about CAC" https://practicalfounders.com/8-common-mistakes-founders-make-about-cac
 * - CAC payback = CAC / monthly gross margin per client: ChartMogul https://chartmogul.com/saas-metrics/cac-payback/ ;
 *   Orb https://www.withorb.com/blog/cac-payback (< 12 months healthy, > 24 months unsustainable).
 * - LTV:CAC ≥ 3 (David Skok's rule of thumb, For Entrepreneurs): Rework https://resources.rework.com/libraries/pipeline-management/ltv-cac-ratio ;
 *   Burkland https://burklandassociates.com/whats-a-good-ltvcac-ratio-for-a-saas-startup/
 * - Cold calling: Belkins, 175,000+ dials (9.9 % connect per dial, 4.6 % of conversations → meeting) https://belkins.io/blog/cold-calling-benchmarks ;
 *   Cognism Cold Calling Report (4.82 % of calls → meeting in 2024) https://www.cognism.com/fr/rapport-cold-calling-2025 ;
 *   JustCall citing Gong (5.4 % average connect, 13.3 % top quartile) https://justcall.io/blog/good-connect-rate-for-sales-teams.html ;
 *   Skipcall (15–25 % pickup in French B2B with average data, 25–35 calls per meeting) https://skipcall.io/blog/taux-decroche-prospection-b2b ;
 *   SalesHive 2025 benchmarks https://saleshive.com/blog/b2b-sales-cold-calling-benchmarks-teams-2025 .
 *   No benchmark specific to French or Spanish trades/SMBs was found: ranges below are general B2B.
 */
import type { Deliverable } from "./content";

export const DEFAULT_HOUR_COST_EUR = 30;
/** Minutes of work per content deliverable (setting `content_minutes_per_deliverable`, JSON). */
export const DELIVERABLE_MINUTES_SEED: Record<Deliverable, number> = { concept: 60, reel: 90, brand_post: 30, personal_post: 20, story: 10, vsl: 180, ig_post: 30 };
export const DELIVERABLE_PLATFORM: Record<Deliverable, "linkedin" | "instagram"> = { concept: "instagram", reel: "instagram", story: "instagram", vsl: "instagram", ig_post: "instagram", brand_post: "linkedin", personal_post: "linkedin" };

/** `{"reel": 60}` merged over the seed; anything invalid keeps the seed. */
export function parseDeliverableMinutes(raw: string | null | undefined): Record<Deliverable, number> {
  const out = { ...DELIVERABLE_MINUTES_SEED };
  if (!raw?.trim()) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const k of Object.keys(out) as Deliverable[]) {
      const n = Number(v?.[k]);
      if (v && k in v && Number.isFinite(n) && n >= 0 && n <= 1_000) out[k] = Math.round(n);
    }
  } catch { /* keep the seed */ }
  return out;
}

const SITE_RE = /\b(site|sites|web|website|seo|sitemap|landing|page|pages|blog|article|articles|search console|ga4|analytics|llms|google business|fiche google|ficha de google|p[aá]gina|p[aá]ginas|referencement|référencement|posicionamiento)\b/i;
export const isSiteTask = (title: string) => SITE_RE.test(title);
/** Which network a content task is about, from its title; null = both. */
export function platformOfTask(title: string): "linkedin" | "instagram" | null {
  const li = /linkedin/i.test(title), ig = /instagram|\breel|\bstor(y|ies)\b/i.test(title);
  return li && !ig ? "linkedin" : ig && !li ? "instagram" : null;
}

interface ContentRow { deliverable: Deliverable; local_date: string; founder_key: string; is_archived?: boolean }
interface TaskRow { title: string; area: string; status: string; estimated_minutes: number | null; completed_at: string | null; owner: string | null; is_archived?: boolean }

/** Minutes of content work (per network) and of site work in the period. */
export function marketingTime(i: { content: ContentRow[]; tasks: TaskRow[]; from: string; to: string; deliverableMinutes?: Record<Deliverable, number>; founder?: string | null }) {
  const per = i.deliverableMinutes ?? DELIVERABLE_MINUTES_SEED;
  const inP = (d: string | null | undefined) => Boolean(d && d >= i.from && d <= i.to);
  const content = { linkedin: 0, instagram: 0, logMinutes: 0, taskMinutes: 0, pieces: 0 };
  for (const c of i.content) {
    if (c.is_archived || !inP(c.local_date) || (i.founder && c.founder_key !== i.founder)) continue;
    const m = per[c.deliverable] ?? 0;
    content[DELIVERABLE_PLATFORM[c.deliverable] ?? "instagram"] += m;
    content.logMinutes += m;
    content.pieces += 1;
  }
  let site = 0;
  for (const t of i.tasks) {
    if (t.is_archived || t.status !== "done" || !t.estimated_minutes || !inP(t.completed_at?.slice(0, 10)) || (i.founder && t.owner !== i.founder)) continue;
    if (t.area !== "sales" && isSiteTask(t.title)) { site += t.estimated_minutes; continue; }
    if (t.area !== "marketing") continue;
    content.taskMinutes += t.estimated_minutes;
    const p = platformOfTask(t.title);
    if (p) content[p] += t.estimated_minutes;
    else { content.linkedin += t.estimated_minutes / 2; content.instagram += t.estimated_minutes / 2; }
  }
  return { content: { ...content, total: content.logMinutes + content.taskMinutes }, site };
}
export type MarketingTime = ReturnType<typeof marketingTime>;

export interface Cost {
  minutes: number;
  timeMinor: number;
  moneyMinor: number;
  totalMinor: number;
  meetings: number;
  won: number;
  /** null = no meeting yet. */
  perMeetingMinor: number | null;
  /** null = no client won yet. */
  cacMinor: number | null;
  /** Fewer than 2 meetings or 2 clients behind the numbers: shown as an estimate. */
  lowSample: boolean;
}

/** One channel: time × hour cost + money, divided by meetings and by clients won. */
export function costOf(i: { minutes: number; moneyMinor?: number; meetings: number; won: number; hourCostEur: number }): Cost {
  const minutes = Math.max(0, Math.round(i.minutes));
  const timeMinor = Math.round((minutes / 60) * i.hourCostEur * 100);
  const moneyMinor = Math.max(0, Math.round(i.moneyMinor ?? 0));
  const totalMinor = timeMinor + moneyMinor;
  return {
    minutes, timeMinor, moneyMinor, totalMinor, meetings: i.meetings, won: i.won,
    perMeetingMinor: i.meetings > 0 ? Math.round(totalMinor / i.meetings) : null, cacMinor: i.won > 0 ? Math.round(totalMinor / i.won) : null,
    lowSample: i.meetings < 2 || i.won < 2,
  };
}

/* ---------------- costs from Money ---------------- */

export interface Expense { amount_minor: number; category: string; description?: string; counterparty?: string; note?: string; currency?: string; direction?: string }
/** Bank categories that are not costs (money in, our own transfers) or not acquisition costs (taxes). */
export const NOT_COSTS = ["revenue", "founder_contribution", "internal_transfer", "other_income", "taxes"];
export type CostChannel = "phone" | "field" | "linkedin" | "email" | "whatsapp" | "web" | "ai" | "social";

/** Which channel a cost belongs to when it is obvious from its category or text, else "shared". */
export function costChannel(e: Expense): CostChannel | "shared" {
  const txt = `${e.description ?? ""} ${e.counterparty ?? ""} ${e.note ?? ""}`.toLowerCase();
  if (/sales navigator|linkedin|waalaxy|lemlist linkedin|kaspr|lusha/.test(txt)) return "linkedin";
  if (/meta ads|facebook|instagram|canva|capcut|metricool|later\.com|buffer|hootsuite|tiktok/.test(txt)) return "social";
  if (/google ads|adwords|semrush|ahrefs|ubersuggest|webflow|wix|framer|wordpress|hostinger|o2switch|ovh|vercel|netlify|namecheap|gandi|domain|nom de domaine|dominio/.test(txt)) return "web";
  if (/lemlist|instantly|brevo|sendinblue|mailchimp|mailjet|hunter\.io|dropcontact/.test(txt)) return "email";
  if (/whatsapp/.test(txt)) return "whatsapp";
  if (e.category === "telecom" || /aircall|ringover|onoff|twilio|sim |forfait|movil|móvil/.test(txt)) return "phone";
  if (e.category === "travel" || /sncf|renfe|uber|blablacar|essence|gasolina|parking|peaje|péage/.test(txt)) return "field";
  if (e.category === "ads") return "web";
  return "shared";
}

const CHANNELS: CostChannel[] = ["phone", "field", "linkedin", "email", "whatsapp", "web", "ai", "social"];
interface ChannelLite { key: string; minutes?: number | null; hours: number | null; meetings: number; won: number }

/**
 * Cost of every channel and the blended, fully loaded cost. `channels` holds outbound (minutes from actions) and the three
 * inbound sources (web, ai, social); `webSessions` / `aiSessions` share the site time between web and AI engines.
 * `expenses` are the period's debits (any category; non-costs are skipped). `adsBudgetMinor` applies only with no ads movement.
 */
export function channelCosts(i: { channels: ChannelLite[]; time: MarketingTime; webSessions: number; aiSessions: number; expenses: Expense[]; adsBudgetMinor?: number; hourCostEur: number }) {
  const visits = i.webSessions + i.aiSessions;
  const aiShare = visits ? i.aiSessions / visits : 0;
  const minutes: Record<string, number> = {};
  for (const c of i.channels) {
    if (!CHANNELS.includes(c.key as CostChannel)) continue;
    minutes[c.key] = c.key === "social" ? i.time.content.total : c.key === "web" ? i.time.site * (1 - aiShare) : c.key === "ai" ? i.time.site * aiShare : c.minutes ?? (c.hours ?? 0) * 60;
  }
  const direct: Record<string, number> = {};
  let shared = 0, excluded = 0;
  const byCategory = new Map<string, { category: string; minor: number; direct: number; shared: number }>();
  const costs = i.expenses.filter((e) => (e.direction ?? "debit") === "debit" && (!e.currency || e.currency === "EUR"));
  for (const e of costs) {
    const amt = Math.abs(e.amount_minor);
    if (NOT_COSTS.includes(e.category)) { excluded += amt; continue; }
    const ch = costChannel(e);
    const g = byCategory.get(e.category) ?? { category: e.category, minor: 0, direct: 0, shared: 0 };
    g.minor += amt;
    if (ch === "shared") { shared += amt; g.shared += amt; } else { direct[ch] = (direct[ch] ?? 0) + amt; g.direct += amt; }
    byCategory.set(e.category, g);
  }
  const adsBudget = costs.some((e) => e.category === "ads") ? 0 : Math.max(0, Math.round(i.adsBudgetMinor ?? 0));
  if (adsBudget) direct.web = (direct.web ?? 0) + adsBudget;
  const totalMinutes = Object.values(minutes).reduce((a, b) => a + b, 0);
  const out: Record<string, Cost & { directMinor: number; sharedMinor: number }> = {};
  for (const c of i.channels) {
    if (!(c.key in minutes)) continue;
    const sharedPart = totalMinutes ? Math.round(shared * (minutes[c.key] / totalMinutes)) : 0;
    const d = direct[c.key] ?? 0;
    out[c.key] = { ...costOf({ minutes: minutes[c.key], moneyMinor: d + sharedPart, meetings: c.meetings, won: c.won, hourCostEur: i.hourCostEur }), directMinor: d, sharedMinor: sharedPart };
  }
  const sum = (k: "meetings" | "won") => i.channels.filter((c) => c.key in minutes).reduce((a, c) => a + c[k], 0);
  const moneyAll = Object.values(direct).reduce((a, b) => a + b, 0) + shared;
  const blended = costOf({ minutes: totalMinutes, moneyMinor: moneyAll, meetings: sum("meetings"), won: sum("won"), hourCostEur: i.hourCostEur });
  return {
    channels: out, blended,
    money: { totalMinor: moneyAll, directMinor: moneyAll - shared, sharedMinor: shared, excludedMinor: excluded, adsBudgetMinor: adsBudget, byCategory: [...byCategory.values()].sort((a, b) => b.minor - a.minor) },
  };
}
export type ChannelCosts = ReturnType<typeof channelCosts>;

/** Cheapest channel per meeting (at least `minMeetings` meetings and a non-zero cost), else null. */
export function cheapestPerMeeting(costs: Record<string, Cost>, minMeetings = 2): { key: string; cost: Cost } | null {
  const ranked = Object.entries(costs).filter(([, c]) => c.meetings >= minMeetings && c.totalMinor > 0 && c.perMeetingMinor !== null).sort((a, b) => a[1].perMeetingMinor! - b[1].perMeetingMinor!);
  return ranked[0] ? { key: ranked[0][0], cost: ranked[0][1] } : null;
}

/* ---------------- payback and LTV:CAC ---------------- */

/**
 * Consulting is a one-off deal: its value is its lifetime value (no delivery cost is recorded, so margin = price),
 * LTV:CAC = value / CAC and the CAC is paid back on the first invoice when the ratio is ≥ 1.
 * Local is 100 €/month: payback in months = CAC / monthly price; its LTV is unknown until we see how long clients stay.
 */
export function unitEconomics(cacMinor: number | null, offer: { consultingMinor: number; localMonthlyMinor: number }) {
  if (cacMinor === null || cacMinor <= 0) return { consultingLtvToCac: null, localPaybackMonths: null };
  return {
    consultingLtvToCac: Math.round((offer.consultingMinor / cacMinor) * 10) / 10,
    localPaybackMonths: offer.localMonthlyMinor > 0 ? Math.round((cacMinor / offer.localMonthlyMinor) * 10) / 10 : null,
  };
}

/* ---------------- calls economics ---------------- */

/** General B2B cold-calling ranges from the sources above (not specific to trades in France/Spain). */
export const CALL_BENCHMARKS = {
  /** Calls picked up per dial: Gong 5.4 % average, Belkins 9.9 %, Skipcall 15–25 % in French B2B. */
  connectRate: { low: 0.05, high: 0.25 },
  /** Meetings per conversation (picked up): Belkins 4.6 %, SalesHive/ScaleList 10–20 %. */
  meetingPerConversation: { low: 0.05, high: 0.2 },
  /** Dials per meeting: Skipcall 25–35 with good data, Cognism ≈ 21 (4.82 %), Belkins ≈ 370. Lower is better. */
  dialsPerMeeting: { low: 20, high: 100 },
} as const;
export type BenchStatus = "better" | "within" | "worse" | "too_few";

export function callEconomics(i: { dials: number; picked: number; yes: number; meetings: number; won: number; cost: Cost; phoneMoneyMinor?: number }) {
  const rate = (n: number, d: number) => (d ? n / d : null);
  const connect = rate(i.picked, i.dials), meetConv = rate(i.meetings, i.picked);
  const dialsPerMeeting = i.meetings ? Math.round(i.dials / i.meetings) : null;
  const cmp = (v: number | null, r: { low: number; high: number }, higherIsBetter: boolean, enough: boolean): BenchStatus =>
    v === null || !enough ? "too_few" : v > r.high ? (higherIsBetter ? "better" : "worse") : v < r.low ? (higherIsBetter ? "worse" : "better") : "within";
  return {
    dials: i.dials, picked: i.picked, yes: i.yes, meetings: i.meetings, won: i.won,
    connectRate: connect, meetingPerConversation: meetConv, dialsPerMeeting, dialsPerClient: i.won ? Math.round(i.dials / i.won) : null,
    costPerDialMinor: i.dials ? Math.round(i.cost.totalMinor / i.dials) : null,
    costPerMeetingMinor: i.cost.perMeetingMinor, costPerClientMinor: i.cost.cacMinor, lowSample: i.dials < 50 || i.meetings < 2,
    bench: {
      connectRate: cmp(connect, CALL_BENCHMARKS.connectRate, true, i.dials >= 20),
      meetingPerConversation: cmp(meetConv, CALL_BENCHMARKS.meetingPerConversation, true, i.picked >= 10),
      dialsPerMeeting: cmp(dialsPerMeeting, CALL_BENCHMARKS.dialsPerMeeting, false, i.dials >= 20 && i.meetings > 0),
    },
  };
}
