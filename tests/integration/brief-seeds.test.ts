import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/data/memory";
import { seedBaseline, SPRINT_SEED } from "@/server/services/baseline";
import { DAILY_CHECKLIST, ONE_OFF_TASKS } from "@/domain/task-seeds";
import { resolveTargets } from "@/domain/targets";
import { childId } from "@/lib/ids";

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
      expect([full.calls.target, full.invitations.target + full.dms.target, full.cold_emails.target, full.follow_ups.target, full.new_businesses.target]).toEqual([50, 25, 0, 20, 90]);
      const reduced = resolveTargets(targets, f, "REDUCED", "2026-11-09");
      expect([reduced.calls.target, reduced.invitations.target + reduced.dms.target, reduced.cold_emails.target, reduced.follow_ups.target, reduced.new_businesses.target]).toEqual([20, 10, 0, 10, 35]);
    }
  });

  it("round 9 (D073): renames open seed rows still carrying the old email title, never a founder's edit or a done row", async () => {
    const repo = new InMemoryRepository();
    await seedBaseline(repo, TZ);
    const rows = () => repo.list("Tasks").then((r) => r.rows.filter((x) => x.source_id === "daily-emails"));
    const theo = (await rows()).find((x) => x.owner === "theo")!;
    const pablo = (await rows()).find((x) => x.owner === "pablo")!;
    expect(theo.title).toMatch(/^Emails ciblés, surtout/);
    // Simulate a spreadsheet seeded in round 8: Théo's row still has the old seed title, Pablo renamed his.
    await repo.update("Tasks", theo.id, theo.version, { title: "Emails ciblés" }, { founder: "system" });
    await repo.update("Tasks", pablo.id, pablo.version, { title: "Mis emails" }, { founder: "pablo" });
    const done = { ...theo, id: childId("t", "done-old"), title: "Emails ciblés", status: "done" as const, completed_at: "2026-11-06T10:00:00.000Z" };
    await repo.insert("Tasks", [done], { founder: "theo" });
    const res = await seedBaseline(repo, TZ);
    expect(res.TasksRenamed).toBe(1);
    const after = await rows();
    expect(after.find((x) => x.id === theo.id)!.title).toMatch(/^Emails ciblés, surtout/);
    expect(after.find((x) => x.id === pablo.id)!.title).toBe("Mis emails");
    expect(after.find((x) => x.id === done.id)!.title).toBe("Emails ciblés");
    const s = (await repo.list("SystemSettings")).rows;
    const v = (k: string) => s.find((x) => x.key === k)?.value;
    expect([v("offer_priority"), v("effort_consulting_pct"), v("effort_local_pct"), v("effort_thirty"), v("ads_monthly_spend_eur"), v("founder_hour_cost_eur")]).toEqual(["consulting", "100", "0", "marketing", "0", "30"]);
    expect(JSON.parse(v("prospecting_channels")!)).toEqual(["phone", "linkedin"]);
  });

  it("round 9 (D073): an old email seed target is superseded by the 0 seed, a founder's own edit is kept", async () => {
    const repo = new InMemoryRepository();
    const old = (f: string, mode: string, target: number) => ({ id: childId("target-seed", f, mode, "cold_emails"), founder_key: f, mode, metric: "cold_emails", target, weight: 1, minutes_per_action: 4, effective_from: "2000-01-01" });
    await repo.insert("DailyTargets", [old("theo", "FULL_TIME", 15), old("theo", "REDUCED", 5), old("pablo", "FULL_TIME", 15)] as never, { founder: "system" });
    await repo.insert("DailyTargets", [{ ...old("pablo", "FULL_TIME", 12), id: childId("t", "edit"), effective_from: "2026-11-02" }] as never, { founder: "pablo" });
    await seedBaseline(repo, TZ);
    const rows = (await repo.list("DailyTargets")).rows;
    expect(resolveTargets(rows, "theo", "FULL_TIME", "2026-11-09").cold_emails.target).toBe(0);
    expect(resolveTargets(rows, "theo", "REDUCED", "2026-11-09").cold_emails.target).toBe(0);
    expect(resolveTargets(rows, "theo", "FULL_TIME", "2026-11-09").new_businesses.target).toBe(90);
    expect(resolveTargets(rows, "pablo", "FULL_TIME", "2026-11-09").cold_emails.target).toBe(12); // founder edit wins
    expect((await seedBaseline(repo, TZ)).DailyTargets).toBeUndefined(); // idempotent
  });
});
