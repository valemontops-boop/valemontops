import { describe, expect, it } from "vitest";
import { fridayRules } from "./friday";

const row = (channel: "phone" | "linkedin", contacts: number, conversations: number, meetingsBooked: number) => ({ channel, contacts, conversations, meetingsBooked, meetingsHeld: 0, proposals: 0, cashMinor: 0 });

describe("Friday review rules", () => {
  it("highlights the rules the week's numbers point to, and stays silent on small samples", () => {
    const rules = fridayRules({
      conversion: [row("phone", 120, 10, 4), row("linkedin", 60, 9, 1)],
      hours: { phone: 8, linkedin: 4 },
      seriousLocalRequests: 0,
      thirty: { visits: 350, purchases: 0 },
      niches: [{ niche: "Plombiers", contacts: 40, conversations: 0 }, { niche: "Garages", contacts: 5, conversations: 0 }],
      wonByOffer: [{ offer: "Consulting", won: 1 }],
      minSample: 20,
    });
    const by = Object.fromEntries(rules.map((r) => [r.key, r]));
    expect(rules).toHaveLength(7);
    expect(by.calls.applies).toBe(true); // 0.5 vs 0.25 meetings per hour
    expect(by.linkedin.applies).toBe(true); // 15% vs 8% conversations per contact
    expect(by.local.applies).toBe(false);
    expect(by.thirty.applies).toBe(true);
    expect(by.niche).toMatchObject({ applies: true, detail: "Plombiers" });
    expect(by.offer).toMatchObject({ applies: true, detail: "Consulting" });
    expect(by.freeze.applies).toBeNull();
    const small = fridayRules({ conversion: [row("phone", 5, 1, 1)], hours: { phone: 1, linkedin: 0 }, seriousLocalRequests: 0, thirty: { visits: 10, purchases: 0 }, niches: [], wonByOffer: [], minSample: 20 });
    expect(small.find((r) => r.key === "calls")?.applies).toBeNull();
    expect(small.find((r) => r.key === "thirty")?.applies).toBeNull();
  });
});
