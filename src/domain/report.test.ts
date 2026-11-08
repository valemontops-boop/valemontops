import { describe, expect, it } from "vitest";
import { formatWhatsAppReport } from "./report";
import { emptyTally } from "./activity";

describe("WhatsApp daily report", () => {
  it("lists exactly the logged actions including field visits", () => {
    const text = formatWhatsAppReport({
      founderName: "Théo",
      date: "2026-11-09",
      tally: { ...emptyTally(), calls: 2, field_visits: 1, new_businesses: 2 },
      targets: { calls: 35, dms: 0 },
      byType: { cold_call: 1, connected_call: 1, field_visit: 1 },
      openOpportunities: [{ name: "Plomberie Martin · Local", stage: "Contacted", nextAction: "Call back" }],
      openOpportunityCount: 1,
      nextDayPriority: "Visit three garages",
    });
    expect(text).toContain("- Field visit: 1");
    expect(text).toContain("- Call, connected: 1");
    expect(text).toContain("- New businesses contacted: 2");
    expect(text).toContain("- Calls: 2/35");
    expect(text).not.toContain("LinkedIn DMs");
    expect(text).toContain("*Tomorrow's priority:* Visit three garages");
  });
});
