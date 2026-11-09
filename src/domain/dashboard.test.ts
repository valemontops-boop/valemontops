import { describe, expect, it } from "vitest";
import { dashboard } from "./dashboard";

let n = 0;
const ev = (local_date: string, activity_type: string, outcome: string | null, account_id = "", extra: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, idempotency_key: `k${n}`, created_at: `${local_date}T08:00:00.000Z`, founder_key: "theo",
  activity_type: activity_type as never, account_id, local_date, occurred_at: `${local_date}T08:00:00.000Z`, outcome, objection: null, ...extra,
});

describe("reports dashboard", () => {
  it("computes KPIs with deltas vs the previous period, daily series, funnel, market and trade breakdowns", () => {
    const d = dashboard({
      events: [
        ev("2026-11-02", "cold_call", "no_answer", "a"),
        ev("2026-11-08", "connected_call", "not_interested", "a", { objection: "no_need" }),
        ev("2026-11-09", "connected_call", "meeting_booked", "b"),
        ev("2026-11-09", "cold_call", "no_answer", "c"),
        ev("2026-11-09", "linkedin_dm", null, "d"),
      ],
      accounts: [{ id: "a", niche: "Plumbers", country: "FR" }, { id: "b", niche: "Garages", country: "ES" }, { id: "c", niche: "Garages", country: "ES" }, { id: "d", niche: "", country: "FR" }],
      wonDates: ["2026-11-09"], contentDates: [], founder: null, tz: "UTC", today: "2026-11-09", days: 7,
    });
    expect(d.from).toBe("2026-11-03");
    expect(d.kpis.dials).toEqual({ value: 3, delta: 200 });
    expect(d.kpis.meetings.value).toBe(1);
    expect(d.kpis.newBusinesses.value).toBe(3); // b, c, d are new this week; a was first touched last week
    expect(d.daily).toHaveLength(7);
    expect(d.daily.at(-1)).toEqual({ date: "2026-11-09", dials: 2, yes: 1, outreach: 3 });
    expect(d.funnel.map((f) => f.value)).toEqual([3, 2, 1, 1, 1]);
    expect(d.byMarket.find((m) => m.key === "ES")).toMatchObject({ dials: 2, picked: 1, yes: 1, yesRate: 1 });
    expect(d.byNiche[0]).toMatchObject({ key: "Garages", dials: 2 });
    expect(d.objections).toMatchObject([{ key: "no_need", count: 1 }]);
  });
});
