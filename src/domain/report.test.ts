import { describe, expect, it } from "vitest";
import { formatWhatsAppReport, type DailyReportInput } from "./report";
import { emptyTally } from "./activity";
import { translate } from "@/i18n";

const input: DailyReportInput = {
  founderName: "Théo",
  date: "2026-11-09",
  tally: { ...emptyTally(), calls: 42, dms: 6, invitations: 12, inmails: 1, cold_emails: 9, follow_ups: 14, new_businesses: 61 },
  qualifiedConversations: 2,
  meetingsBooked: 1,
  proposalsSent: 1,
  postsPublished: 2,
  cashCollectedMinor: 150000,
  nextDayPriority: "Visit three garages",
  valemont: { newContacts: 97, qualifiedConversations: 3, meetingsHeld: 1, proposalsSent: 1, revenueExVatMinor: null },
  thirty: { videosPublished: 1, siteVisits: 120, checkouts: null, reportsSold: 2 },
  local: { activeSubscriptions: 3, setupFeesMinor: null, aiUsage: null, marginAfterSupportMinor: null },
};

describe("WhatsApp daily report (brief round 8)", () => {
  it("lists the founder's day, then Valemont, 30/30 and Valemont Local separately; missing data prints —", () => {
    const text = formatWhatsAppReport(input);
    expect(text).toContain("- Calls: 42");
    expect(text).toContain("- Connection requests: 12");
    expect(text).toContain("- Qualified conversations: 2");
    expect(text).toContain("- Cash collected (EUR): 1 500 €");
    expect(text).toContain("*Tomorrow's priority:* Visit three garages");
    expect(text.indexOf("*Valemont (team)*")).toBeLessThan(text.indexOf("*30/30*"));
    expect(text.indexOf("*30/30*")).toBeLessThan(text.indexOf("*Valemont Local*"));
    expect(text).toContain("- New contacts: 97");
    expect(text).toContain("- Revenue collected ex VAT: —");
    expect(text).toContain("- Checkouts: —");
    expect(text).toContain("- AI usage: —");
  });
  it("is written in the founder's language", () => {
    const fr = formatWhatsAppReport(input, (s, v) => translate("fr", s, v));
    expect(fr).toContain("- Appels : 42");
    expect(fr).toContain("Priorité de demain :");
    const es = formatWhatsAppReport({ ...input, founderName: "Pablo" }, (s, v) => translate("es", s, v));
    expect(es).toContain("- Llamadas: 42");
    expect(es).toContain("Valemont (equipo)");
  });
});
