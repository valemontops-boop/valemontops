import { describe, expect, it } from "vitest";
import { dedupeEvents, funnelCounts, newBusinessesContacted, tallyDay, type EventLike } from "./activity";

let n = 0;
function ev(p: Partial<EventLike>): EventLike {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    idempotency_key: `k${n}`,
    created_at: `2026-11-09T10:00:${String(n % 60).padStart(2, "0")}.000Z`,
    founder_key: "theo",
    activity_type: "cold_call",
    account_id: "acc1",
    local_date: "2026-11-09",
    occurred_at: "2026-11-09T10:00:00.000Z",
    ...p,
  };
}

describe("exactly-once by derivation", () => {
  it("counts two rows with the same idempotency_key once; earliest wins", () => {
    const a = ev({ idempotency_key: "same", created_at: "2026-11-09T10:00:01.000Z", notes: "first" } as never);
    const b = ev({ idempotency_key: "same", created_at: "2026-11-09T10:00:00.500Z" });
    expect(dedupeEvents([a, b])).toEqual([b]);
    expect(tallyDay([a, b], "theo", "2026-11-09").calls).toBe(1);
  });
  it("breaks created_at ties by lowest id", () => {
    const a = ev({ idempotency_key: "t", created_at: "2026-11-09T10:00:00.000Z", id: "b0000000-0000-4000-8000-000000000000" });
    const b = ev({ idempotency_key: "t", created_at: "2026-11-09T10:00:00.000Z", id: "a0000000-0000-4000-8000-000000000000" });
    expect(dedupeEvents([a, b])[0].id).toBe(b.id);
  });
});

describe("tally", () => {
  it("maps activity types to counters and keeps states separate", () => {
    const events = [
      ev({ activity_type: "cold_call" }),
      ev({ activity_type: "connected_call" }),
      ev({ activity_type: "voicemail" }),
      ev({ activity_type: "field_visit", account_id: "acc2", outcome: "met_owner" }),
      ev({ activity_type: "demo_shown" }),
      ev({ activity_type: "linkedin_dm", founder_key: "pablo" }),
    ];
    const t = tallyDay(events, "theo", "2026-11-09");
    expect(t.calls).toBe(3);
    expect(t.field_visits).toBe(1);
    expect(t.dms).toBe(0);
    const f = funnelCounts(events, "theo", "2026-11-09", "2026-11-09");
    expect(f).toMatchObject({ attempted: 4, conversations: 2, demos: 1 });
  });
  it("counts a new business only on its first-ever outreach", () => {
    const events = [
      ev({ account_id: "old", local_date: "2026-11-01", occurred_at: "2026-11-01T09:00:00.000Z" }),
      ev({ account_id: "old" }),
      ev({ account_id: "new1", activity_type: "field_visit" }),
      ev({ account_id: "new2", founder_key: "pablo" }),
      ev({ account_id: "new3", activity_type: "demo_shown" }), // not outreach
    ];
    expect(newBusinessesContacted(events, "theo", "2026-11-09", "2026-11-09")).toEqual(["new1"]);
    expect(tallyDay(events, "theo", "2026-11-09").new_businesses).toBe(1);
    expect(newBusinessesContacted(events, null, "2026-11-09", "2026-11-09").sort()).toEqual(["new1", "new2"]);
  });
});
