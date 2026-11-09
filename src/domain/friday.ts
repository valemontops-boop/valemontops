/**
 * Friday review rules (iteration 8), shown on the weekly review. Each rule says whether this week's numbers
 * point to it (`applies`), with the evidence; null = the rule always holds or there is not enough data to tell.
 * Minimum samples follow the verdicts (D057): no conclusion from a handful of actions.
 */
import type { ConversionRow } from "./conversion";

export interface FridayRule { key: string; text: string; applies: boolean | null; evidence?: { key: string; vars?: Record<string, number> }; detail?: string }

export const FRIDAY_RULES: { key: string; text: string }[] = [
  { key: "calls", text: "Calls give more meetings per hour than LinkedIn: increase calls." },
  { key: "linkedin", text: "LinkedIn gives more qualified conversations: increase personalized approaches within account limits." },
  { key: "local", text: "Valemont Local gets serious requests: offer demos and ask for paid commitments." },
  { key: "thirty", text: "30/30 gets views but no purchases: review CTAs and product demo." },
  { key: "niche", text: "A niche does not respond after significant qualified volume: review targeting, message and channel." },
  { key: "offer", text: "An offer starts converting: focus on it instead of creating another." },
  { key: "freeze", text: "For 10 working days: no new offer and no visual redesign, only fixes that block prospects or clients." },
];

export interface FridayInput {
  /** This week's conversion by channel. */
  conversion: ConversionRow[];
  /** Hours of work per channel this week (logged outreach × minutes per action). */
  hours: { phone: number; linkedin: number };
  /** Open Local deals at discovery or later. */
  seriousLocalRequests: number;
  thirty: { visits: number; purchases: number };
  /** Contacts and conversations per niche this week. */
  niches: { niche: string; contacts: number; conversations: number }[];
  /** Deals won in the last 30 days per offer ("Consulting", "Local, entry offer (budget too small)"). */
  wonByOffer: { offer: string; won: number }[];
  minSample: number;
}

export function fridayRules(i: FridayInput): FridayRule[] {
  const row = (ch: string) => i.conversion.find((r) => r.channel === ch);
  const phone = row("phone"), li = row("linkedin");
  const mph = (meetings: number, hours: number) => (hours > 0 ? meetings / hours : null);
  const phoneMph = mph(phone?.meetingsBooked ?? 0, i.hours.phone), liMph = mph(li?.meetingsBooked ?? 0, i.hours.linkedin);
  const enough = (r?: ConversionRow) => (r?.contacts ?? 0) >= i.minSample;
  const out: FridayRule[] = [];
  for (const r of FRIDAY_RULES) {
    switch (r.key) {
      case "calls": {
        const ok = enough(phone) && enough(li) && phoneMph !== null && liMph !== null;
        out.push({ ...r, applies: ok ? phoneMph! > liMph! : null, evidence: ok ? { key: "Calls {n} meetings/hour · LinkedIn {total} meetings/hour", vars: { n: round(phoneMph!), total: round(liMph!) } } : undefined });
        break;
      }
      case "linkedin": {
        const ok = enough(phone) && enough(li);
        const pr = ok ? phone!.conversations / phone!.contacts : 0, lr = ok ? li!.conversations / li!.contacts : 0;
        out.push({ ...r, applies: ok ? lr > pr : null, evidence: ok ? { key: "Conversations per contact: LinkedIn {n}% · calls {total}%", vars: { n: Math.round(lr * 100), total: Math.round(pr * 100) } } : undefined });
        break;
      }
      case "local":
        out.push({ ...r, applies: i.seriousLocalRequests > 0, evidence: i.seriousLocalRequests ? { key: "{n} Local deals at discovery or later", vars: { n: i.seriousLocalRequests } } : undefined });
        break;
      case "thirty": {
        const ok = i.thirty.visits >= 200;
        out.push({ ...r, applies: ok ? i.thirty.purchases === 0 : null, evidence: ok ? { key: "30/30: {n} visits, {total} purchases", vars: { n: i.thirty.visits, total: i.thirty.purchases } } : undefined });
        break;
      }
      case "niche": {
        const silent = i.niches.filter((n) => n.contacts >= i.minSample && n.conversations === 0).sort((a, b) => b.contacts - a.contacts)[0];
        out.push({ ...r, applies: silent ? true : i.niches.some((n) => n.contacts >= i.minSample) ? false : null, evidence: silent ? { key: "{n} contacts, no conversation", vars: { n: silent.contacts } } : undefined, detail: silent?.niche });
        break;
      }
      case "offer": {
        const best = [...i.wonByOffer].filter((w) => w.won > 0).sort((a, b) => b.won - a.won)[0];
        out.push({ ...r, applies: best ? true : null, evidence: best ? { key: "{n} deals won in 30 days", vars: { n: best.won } } : undefined, detail: best?.offer });
        break;
      }
      default:
        out.push({ ...r, applies: null });
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;
