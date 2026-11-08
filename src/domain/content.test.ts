import { describe, expect, it } from "vitest";
import { contentProgress } from "./content";

describe("weekly marketing deliverables", () => {
  it("counts this week's deliverables against the mode's weekly targets; VSL over 14 days", () => {
    const logs = [
      { deliverable: "reel" as const, local_date: "2026-11-09", founder_key: "theo" },
      { deliverable: "reel" as const, local_date: "2026-11-10", founder_key: "pablo" },
      { deliverable: "reel" as const, local_date: "2026-11-01", founder_key: "pablo" }, // last week
      { deliverable: "vsl" as const, local_date: "2026-11-02", founder_key: "theo" },
    ];
    const p = contentProgress(logs, "JOB_SEARCHING", "2026-11-09", "2026-11-15", "2026-11-02");
    expect(p.find((x) => x.deliverable === "reel")).toMatchObject({ done: 2, target: 6, byFounder: { theo: 1, pablo: 1 } });
    expect(p.find((x) => x.deliverable === "vsl")).toMatchObject({ done: 1, target: 1 });
    expect(contentProgress([], "EMPLOYED_35H", "2026-11-09", "2026-11-15", "2026-11-02").some((x) => x.deliverable === "vsl")).toBe(false);
  });
});
