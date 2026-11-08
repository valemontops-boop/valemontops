import { describe, expect, it } from "vitest";
import { filterTasks, nextDue, todaysTasks } from "./tasks";

const t = (p: object) => ({ owner: "pablo", status: "todo", due_at: "2026-11-09", snoozed_until: null, visibility: "team", created_by_founder: "theo", priority: "P2", ...p });

describe("tasks", () => {
  it("computes recurrence", () => {
    expect(nextDue("2026-11-06", "weekdays")).toBe("2026-11-09");
    expect(nextDue("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDue("2026-11-09", "weekly")).toBe("2026-11-16");
    expect(nextDue("2026-11-09", "none")).toBeNull();
  });
  it("scenario 4: a P0 task assigned to Pablo appears in Pablo's day and his view", () => {
    const task = t({ priority: "P0" });
    expect(todaysTasks([task], "pablo", "2026-11-09")).toHaveLength(1);
    expect(todaysTasks([task], "theo", "2026-11-09")).toHaveLength(0);
    expect(filterTasks([task], "pablo", "theo", "2026-11-09")).toHaveLength(1);
    expect(todaysTasks([{ ...task, status: "done" }], "pablo", "2026-11-09")).toHaveLength(0);
    expect(todaysTasks([{ ...task, snoozed_until: "2026-11-10" }], "pablo", "2026-11-09")).toHaveLength(0);
  });
  it("hides private tasks from the other founder", () => {
    const priv = t({ visibility: "private", owner: "theo", created_by_founder: "theo" });
    expect(filterTasks([priv], "all", "pablo", "2026-11-09")).toHaveLength(0);
    expect(filterTasks([priv], "all", "theo", "2026-11-09")).toHaveLength(1);
  });
});
