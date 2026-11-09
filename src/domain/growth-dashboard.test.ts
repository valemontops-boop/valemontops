import { describe, expect, it } from "vitest";
import { growthHref, keyNumbers, orderVerdicts, panelOf, readGrowthState, rowValue } from "./growth-dashboard";

describe("growth dashboard state (D077)", () => {
  it("maps every channel row to its drawer", () => {
    expect(["phone", "field", "email", "whatsapp", "linkedin", "web", "ai", "social", "inbound"].map(panelOf)).toEqual(["calls", "calls", "messages", "messages", "linkedin", "web", "web", "social", "web"]);
  });

  it("reads the URL and falls back on unknown values", () => {
    expect(readGrowthState(new URLSearchParams("channel=web&view=cost"))).toEqual({ panel: "web", view: "cost", tab: "visits" });
    expect(readGrowthState(new URLSearchParams("channel=web&tab=seo"))).toEqual({ panel: "web", view: "volume", tab: "seo" });
    expect(readGrowthState(new URLSearchParams("channel=nope&view=pie&tab=x"))).toEqual({ panel: null, view: "volume", tab: null });
    expect(readGrowthState(new URLSearchParams("channel=calls&tab=seo"))).toEqual({ panel: "calls", view: "volume", tab: null });
    expect(readGrowthState(new URLSearchParams("channel=messages&tab=bogus")).tab).toBe("results");
  });

  it("writes the URL without defaults and round-trips", () => {
    expect(growthHref({ panel: null, view: "volume", tab: null })).toBe("/marketing");
    expect(growthHref({ panel: "web", view: "cost", tab: "visits" })).toBe("/marketing?channel=web&view=cost");
    const href = growthHref({ panel: "web", view: "results", tab: "seo" });
    expect(href).toBe("/marketing?channel=web&view=results&tab=seo");
    expect(readGrowthState(new URLSearchParams(href.split("?")[1]))).toEqual({ panel: "web", view: "results", tab: "seo" });
    expect(growthHref({ panel: "inbox", view: "volume", tab: "seo" })).toBe("/marketing?channel=inbox");
  });

  it("gives the value of a row in each view", () => {
    const c = { touches: 23, meetings: 2, won: 0 };
    expect(rowValue("volume", c, undefined)).toBe(23);
    expect(rowValue("results", c, undefined)).toBe(2);
    expect(rowValue("cost", c, { minutes: 90, perMeetingMinor: 2300, cacMinor: null })).toBe(2300);
    expect(rowValue("cost", c, undefined)).toBeNull();
  });

  it("computes the key numbers once: clients = deals won + 30/30 purchases", () => {
    const k = keyNumbers({
      all: [{ touches: 23, meetings: 2, won: 1, hours: 1.5 }, { touches: 57, meetings: 0, won: 0, hours: 3.5 }],
      sources: [{ touches: 518, meetings: 0, won: 17 }], inbound: { touches: 0, meetings: 0, won: 0 }, totalMeetings: 3,
    });
    expect(k).toEqual({ touches: 80, meetings: 3, clients: 18, deals: 1, purchases: 17, hours: 5, perHour: 0.4 });
    expect(keyNumbers({ all: [{ touches: 0, meetings: 0, won: 0, hours: null }], inbound: { touches: 0, meetings: 0, won: 2 }, totalMeetings: 0 }).perHour).toBeNull();
  });

  it("orders verdicts to improve → to watch → what works", () => {
    const v = orderVerdicts([{ kind: "good", key: "a" }, { kind: "fix", key: "b" }, { kind: "watch", key: "c" }, { kind: "fix", key: "d" }]);
    expect(v.map((x) => x.key)).toEqual(["b", "d", "c", "a"]);
  });
});
