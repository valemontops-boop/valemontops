import { describe, expect, it } from "vitest";
import { callEconomics, channelCosts, cheapestPerMeeting, costChannel, costOf, isSiteTask, marketingTime, parseDeliverableMinutes, platformOfTask, unitEconomics } from "./cac";
import { costVerdicts } from "./verdicts";

const F = "2026-11-01", T = "2026-11-30";

describe("costOf", () => {
  it("values time at the hour cost and adds money", () => {
    const c = costOf({ minutes: 120, moneyMinor: 1000, meetings: 4, won: 2, hourCostEur: 30 });
    expect(c.timeMinor).toBe(6000);
    expect(c.totalMinor).toBe(7000);
    expect(c.perMeetingMinor).toBe(1750);
    expect(c.cacMinor).toBe(3500);
    expect(c.lowSample).toBe(false);
  });
  it("has no CAC without a client and flags small samples", () => {
    const c = costOf({ minutes: 60, meetings: 1, won: 0, hourCostEur: 30 });
    expect(c.cacMinor).toBeNull();
    expect(c.perMeetingMinor).toBe(3000);
    expect(c.lowSample).toBe(true);
  });
});

describe("marketingTime", () => {
  const content = [
    { deliverable: "reel" as const, local_date: "2026-11-03", founder_key: "theo" },
    { deliverable: "brand_post" as const, local_date: "2026-11-04", founder_key: "pablo" },
    { deliverable: "story" as const, local_date: "2026-10-01", founder_key: "theo" }, // outside the period
  ];
  const task = (title: string, area: string, min: number, owner = "theo", status = "done") => ({ title, area, status, estimated_minutes: min, completed_at: "2026-11-05T10:00:00.000Z", owner });
  it("counts deliverables and done marketing tasks per network, site tasks apart", () => {
    const r = marketingTime({ content, tasks: [task("Tourner le reel Instagram", "marketing", 60), task("Plan de contenu", "marketing", 40), task("Optimiser le SEO de la page plombier", "ops", 90), task("Nettoyage pipeline", "ops", 30), task("Brouillon", "marketing", 20, "theo", "todo")], from: F, to: T });
    expect(r.content.logMinutes).toBe(90 + 30);
    expect(r.content.taskMinutes).toBe(100);
    expect(r.content.instagram).toBe(90 + 60 + 20);
    expect(r.content.linkedin).toBe(30 + 20);
    expect(r.site).toBe(90);
  });
  it("keeps only one founder's work in scope me", () => {
    expect(marketingTime({ content, tasks: [], from: F, to: T, founder: "pablo" }).content.total).toBe(30);
  });
  it("reads the minutes per deliverable setting with the seed as fallback", () => {
    expect(parseDeliverableMinutes('{"reel": 45, "story": "x"}').reel).toBe(45);
    expect(parseDeliverableMinutes('{"reel": 45, "story": "x"}').story).toBe(10);
    expect(parseDeliverableMinutes("not json").reel).toBe(90);
  });
  it("detects site tasks and the network of a task", () => {
    expect(isSiteTask("Mettre à jour la página de servicios")).toBe(true);
    expect(isSiteTask("Appeler le comptable")).toBe(false);
    expect(platformOfTask("Post LinkedIn Valemont")).toBe("linkedin");
    expect(platformOfTask("Stories Instagram")).toBe("instagram");
    expect(platformOfTask("Planning éditorial")).toBeNull();
  });
});

describe("costs from Money", () => {
  it("assigns obvious costs to a channel and leaves the rest shared", () => {
    expect(costChannel({ amount_minor: -9900, category: "software", description: "LinkedIn Sales Navigator" })).toBe("linkedin");
    expect(costChannel({ amount_minor: -2000, category: "telecom", description: "Forfait mobile" })).toBe("phone");
    expect(costChannel({ amount_minor: -1200, category: "software", description: "Canva Pro" })).toBe("social");
    expect(costChannel({ amount_minor: -800, category: "software", description: "Hostinger" })).toBe("web");
    expect(costChannel({ amount_minor: -5000, category: "travel", description: "Train Lyon" })).toBe("field");
    expect(costChannel({ amount_minor: -1400, category: "software", description: "Google Workspace" })).toBe("shared");
  });
  const channels = [
    { key: "phone", minutes: 600, hours: 10, meetings: 4, won: 1 },
    { key: "linkedin", minutes: 300, hours: 5, meetings: 1, won: 0 },
    { key: "web", minutes: 0, hours: null, meetings: 0, won: 0 },
    { key: "ai", minutes: 0, hours: null, meetings: 0, won: 0 },
    { key: "social", minutes: 0, hours: null, meetings: 0, won: 3 },
    { key: "inbound", minutes: 0, hours: null, meetings: 0, won: 3 },
  ];
  const time = { content: { linkedin: 0, instagram: 60, logMinutes: 60, taskMinutes: 0, pieces: 1, total: 60 }, site: 60 };
  const expenses = [
    { amount_minor: -9000, category: "software", description: "LinkedIn Sales Navigator", direction: "debit", currency: "EUR" },
    { amount_minor: -2000, category: "telecom", description: "Forfait", direction: "debit", currency: "EUR" },
    { amount_minor: -10200, category: "software", description: "Google Workspace", direction: "debit", currency: "EUR" },
    { amount_minor: -50000, category: "founder_contribution", description: "Apport", direction: "debit", currency: "EUR" },
    { amount_minor: -30000, category: "taxes", description: "TVA", direction: "debit", currency: "EUR" },
    { amount_minor: -9999, category: "software", description: "Tool in USD", direction: "debit", currency: "USD" },
  ];
  const r = channelCosts({ channels, time, webSessions: 300, aiSessions: 100, expenses, adsBudgetMinor: 0, hourCostEur: 30 });
  it("never treats contributions, transfers or taxes as costs", () => {
    expect(r.money.excludedMinor).toBe(80000);
    expect(r.money.totalMinor).toBe(9000 + 2000 + 10200);
  });
  it("shares common costs by time share", () => {
    // 600 + 300 + 45 + 15 + 60 = 1020 minutes; shared 10,200 cents.
    expect(r.channels.phone.sharedMinor).toBe(Math.round(10200 * 600 / 1020));
    expect(r.channels.phone.directMinor).toBe(2000);
    expect(r.channels.linkedin.directMinor).toBe(9000);
    expect(r.channels.web.minutes).toBe(45);
    expect(r.channels.ai.minutes).toBe(15);
    expect(r.channels.social.minutes).toBe(60);
    expect(r.channels.inbound).toBeUndefined();
  });
  it("social is never free: content time has a cost", () => {
    expect(r.channels.social.timeMinor).toBe(3000);
    expect(r.channels.social.cacMinor).toBeGreaterThan(0);
  });
  it("blended = all time and all costs over all clients", () => {
    expect(r.blended.minutes).toBe(1020);
    expect(r.blended.totalMinor).toBe(1020 / 60 * 3000 + 21200);
    expect(r.blended.won).toBe(4);
    expect(r.blended.cacMinor).toBe(Math.round(r.blended.totalMinor / 4));
  });
  it("uses the ads budget only with no ads movement", () => {
    expect(channelCosts({ channels, time, webSessions: 1, aiSessions: 0, expenses: [], adsBudgetMinor: 5000, hourCostEur: 30 }).channels.web.directMinor).toBe(5000);
    expect(channelCosts({ channels, time, webSessions: 1, aiSessions: 0, expenses: [{ amount_minor: -100, category: "ads", direction: "debit" }], adsBudgetMinor: 5000, hourCostEur: 30 }).channels.web.directMinor).toBe(100);
  });
  it("finds the cheapest channel per meeting with at least two meetings", () => {
    expect(cheapestPerMeeting(r.channels)?.key).toBe("phone");
    const v = costVerdicts(r.channels, (k) => k, (m) => `${m / 100} €`);
    expect(v[0]).toMatchObject({ kind: "good", vars: { channel: "phone" } });
  });
});

describe("payback and calls", () => {
  it("computes Consulting LTV:CAC and Local payback months", () => {
    expect(unitEconomics(50000, { consultingMinor: 150000, localMonthlyMinor: 10000 })).toEqual({ consultingLtvToCac: 3, localPaybackMonths: 5 });
    expect(unitEconomics(null, { consultingMinor: 150000, localMonthlyMinor: 10000 }).localPaybackMonths).toBeNull();
  });
  it("compares the calls funnel with the benchmarks", () => {
    const cost = costOf({ minutes: 400, meetings: 4, won: 1, hourCostEur: 30 });
    const c = callEconomics({ dials: 100, picked: 30, yes: 8, meetings: 4, won: 1, cost });
    expect(c.connectRate).toBe(0.3);
    expect(c.dialsPerMeeting).toBe(25);
    expect(c.costPerDialMinor).toBe(200);
    expect(c.bench.connectRate).toBe("better");
    expect(c.bench.dialsPerMeeting).toBe("within");
    expect(c.bench.meetingPerConversation).toBe("within");
    expect(callEconomics({ dials: 5, picked: 1, yes: 0, meetings: 0, won: 0, cost }).bench.connectRate).toBe("too_few");
  });
});
