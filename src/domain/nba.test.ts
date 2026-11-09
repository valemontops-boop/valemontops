import { describe, expect, it } from "vitest";
import { nextBestActions } from "./nba";

const acc = (id: string, niche = "Plumbers", owner: string | null = "theo") => ({ id, name: id.toUpperCase(), niche, owner_founder: owner, is_archived: false });
const opp = (id: string, account_id: string, p: Partial<{ stage: string; next_action_due: string | null; next_action_priority: string | null; owner_founder: string | null }> = {}) => ({
  id, account_id, stage: "contacted", owner_founder: "theo", next_action: "Call", next_action_due: null, next_action_priority: "normal", is_archived: false, ...p,
});
const ev = (account_id: string, activity_type: string, local_date: string) => ({ account_id, activity_type, local_date, occurred_at: `${local_date}T10:00:00.000Z`, founder_key: "theo" });

describe("Next Best Action order", () => {
  it("orders tiers deterministically and explains each item; excludes blocked businesses and other founders' deals", () => {
    const items = nextBestActions({
      founder: "theo", today: "2026-11-09", staleDays: 5, sprintNiche: "garage",
      accounts: [acc("a"), acc("b"), acc("c"), acc("d"), acc("e", "Independent garages"), acc("f"), acc("g", "Garages", "pablo"), acc("h", "Garage")],
      opps: [
        opp("o1", "a", { stage: "replied" }),
        opp("o2", "b", { next_action_due: "2026-11-05", next_action_priority: "high" }),
        opp("o3", "c", { next_action_due: "2026-11-09" }),
        opp("o4", "d", { stage: "qualified", next_action_due: "2026-11-20" }),
        opp("o6", "f", { next_action_due: "2026-11-01", owner_founder: "pablo" }),
      ],
      events: [ev("a", "cold_call", "2026-11-01"), ev("a", "reply", "2026-11-08"), ev("d", "connected_call", "2026-10-30")],
      blockedAccountIds: new Set(["h"]),
    });
    expect(items.map((i) => [i.tier, i.accountId])).toEqual([[1, "a"], [2, "b"], [3, "c"], [4, "d"], [5, "e"]]);
    expect(items[0].why).toMatch(/Replied on 2026-11-08/);
    expect(items[3].why).toMatch(/2026-10-30/);
  });
});
