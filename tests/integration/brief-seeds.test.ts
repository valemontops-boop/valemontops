import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/data/memory";
import { seedBaseline, SPRINT_SEED } from "@/server/services/baseline";
import { DAILY_CHECKLIST, ONE_OFF_TASKS } from "@/domain/task-seeds";
import { resolveTargets } from "@/domain/targets";

const TZ = { theo: "Europe/Paris", pablo: "Europe/Madrid" };

describe("founder brief seeds (round 8)", () => {
  it("seeds checklist and one-off tasks once, per founder in their language, plus the sprint and the targets", async () => {
    const repo = new InMemoryRepository();
    await seedBaseline(repo, TZ);
    const again = await seedBaseline(repo, TZ);
    expect(again.Tasks).toBeUndefined(); // idempotent
    const tasks = (await repo.list("Tasks")).rows.filter((t) => t.source === "system");
    const perFounder = (f: string) => tasks.filter((t) => t.owner === f);
    const oneOffFor = (f: "theo" | "pablo") => ONE_OFF_TASKS.filter((s) => s.title[f]).length;
    expect(perFounder("theo")).toHaveLength(DAILY_CHECKLIST.length + oneOffFor("theo"));
    expect(perFounder("pablo")).toHaveLength(DAILY_CHECKLIST.length + oneOffFor("pablo"));
    expect(perFounder("theo").find((t) => t.source_id === "daily-calls")).toMatchObject({ title: "Appels à froid", recurrence: "weekdays", area: "sales" });
    expect(perFounder("pablo").find((t) => t.source_id === "daily-calls")).toMatchObject({ title: "Llamadas en frío" });
    const friday = perFounder("pablo").find((t) => t.source_id === "friday-review")!;
    expect(friday).toMatchObject({ recurrence: "weekly", recurrence_days: [5], estimated_minutes: 30 });
    expect(new Date(`${friday.due_at}T12:00:00Z`).getUTCDay()).toBe(5);
    expect(perFounder("pablo").some((t) => t.source_id === "site-fr-es")).toBe(false); // Théo's only
    const sprint = (await repo.list("Sprints")).rows[0];
    expect(sprint).toMatchObject({ start_date: SPRINT_SEED.start_date, end_date: "2026-12-04", status: "active" });
    const targets = (await repo.list("DailyTargets")).rows;
    for (const f of ["theo", "pablo"]) {
      const full = resolveTargets(targets, f, "FULL_TIME", "2026-11-09");
      expect([full.calls.target, full.invitations.target + full.dms.target, full.cold_emails.target, full.follow_ups.target, full.new_businesses.target]).toEqual([50, 25, 15, 20, 90]);
      const reduced = resolveTargets(targets, f, "REDUCED", "2026-11-09");
      expect([reduced.calls.target, reduced.invitations.target + reduced.dms.target, reduced.cold_emails.target, reduced.follow_ups.target, reduced.new_businesses.target]).toEqual([20, 10, 5, 10, 35]);
    }
  });
});
