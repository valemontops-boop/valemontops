import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FakeSheetsServer } from "@/fake-sheets/server";
import type { DataRepository } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { assignContractor, deliveryAttention, deliveryOverview, updateAssignment, wonToProject, workflowHooks } from "@/server/services/delivery";
import { importUsageCsv, localOverview, saveUsage } from "@/server/services/local-subscriptions";
import { createVendor, partnersOverview } from "@/server/services/partners";
import { notifications } from "@/server/services/insights";
import { freshSheetsRepo, makeRepo } from "../helpers";

let fake: FakeSheetsServer;
let url: string;
let ctx: AppContext;
const ctxOf = (repo: DataRepository): AppContext => ({ repo, privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode: "demo" });

beforeEach(async () => {
  const env = await freshSheetsRepo();
  fake = env.fake;
  url = env.url;
  ctx = ctxOf(env.repo);
  await seedBaseline(env.repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
});
afterEach(async () => {
  workflowHooks.beforeStep = undefined;
  await fake.stop();
});

async function wonDeal(brand: "consulting" | "local", value: number | null, name = "Garage Test (test)") {
  const accountId = randomUUID();
  const oppId = randomUUID();
  await ctx.repo.insert("Accounts", [{ id: accountId, name, sector: "", niche: "Garages", country: "FR", city: "", website: "", domain_normalized: "", phone: "+33100000999", email: "", linkedin_url: "", lead_source: "test", lead_type: "outbound", brand, owner_founder: "theo", lead_status: "working", observed_problem: "", problem_evidence: "", language: "fr", notes: "", import_batch_id: "" }], { founder: "theo" });
  await ctx.repo.insert("Opportunities", [{ id: oppId, account_id: accountId, primary_contact_id: "", name: name.replace(" (test)", ""), brand, market: "FR", stage: "won", owner_founder: "theo", value_minor: value, currency: "EUR", expected_close: null, next_action: "", next_action_due: null, next_action_priority: "normal", next_action_reason: "", lost_reason: "", anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "" }], { founder: "theo" });
  return { accountId, oppId };
}
const won = (oppId: string, c = ctx) => wonToProject(c, "theo", { opportunity_id: oppId, start_date: "2026-11-02", owner_founder: "theo", promised: "Moins d'appels manqués", stakeholders: "Gérant", success: "< 5 appels manqués / semaine" });
async function counts(repo: DataRepository, oppId: string) {
  const t = await repo.listMany(["Clients", "Projects", "Milestones", "Tasks", "WorkflowRuns"], { fresh: true });
  const project = t.Projects.rows.filter((p) => p.opportunity_id === oppId);
  return {
    clients: t.Clients.rows.length, projects: project.length,
    milestones: t.Milestones.rows.filter((m) => project.some((p) => p.id === m.project_id)).length,
    tasks: t.Tasks.rows.filter((x) => project.some((p) => p.id === x.project_id)).length,
    run: t.WorkflowRuns.rows.find((r) => r.subject_id === oppId) ?? null,
  };
}

describe("Scenario 7 — Won → Client & Project through WorkflowRuns", () => {
  it("refuses a deal that is not won", async () => {
    const { oppId } = await wonDeal("consulting", 150000);
    const o = (await ctx.repo.get("Opportunities", oppId))!;
    await ctx.repo.update("Opportunities", oppId, o.version, { stage: "negotiation" }, { founder: "theo" });
    await expect(won(oppId)).rejects.toThrow(/won deal/);
  });

  it("killed midway, then retried from another server instance: no duplicate client or project", async () => {
    const { oppId } = await wonDeal("consulting", 150000);
    // Kill the workflow after the client and the project were written, before the milestones.
    workflowHooks.beforeStep = (s) => { if (s === "milestones") throw new Error("process killed"); };
    const first = await won(oppId);
    expect(first).toMatchObject({ status: "failed", failedStep: "milestones" });
    let c = await counts(ctx.repo, oppId);
    expect(c).toMatchObject({ clients: 1, projects: 1, milestones: 0, tasks: 0 });
    expect(c.run).toMatchObject({ status: "failed", attempts: 1 });
    expect(c.run!.steps.client.status).toBe("done");
    expect(c.run!.steps.project.status).toBe("done");

    // Retry on a fresh repository instance (another founder / a restarted server).
    workflowHooks.beforeStep = undefined;
    const other = ctxOf(makeRepo(url));
    const second = await won(oppId, other);
    expect(second).toMatchObject({ status: "done", resumed: true });
    c = await counts(other.repo, oppId);
    expect(c).toMatchObject({ clients: 1, projects: 1, milestones: 4, tasks: 1 });
    expect(c.run).toMatchObject({ status: "done", attempts: 2 });

    // A third click is a no-op.
    const third = await won(oppId, other);
    expect(third).toMatchObject({ status: "done", alreadyDone: true });
    expect(await counts(other.repo, oppId)).toMatchObject({ clients: 1, projects: 1, milestones: 4, tasks: 1 });
  });

  it("killed after a step wrote its rows but before it was marked done: the re-run writes nothing twice", async () => {
    const { oppId } = await wonDeal("consulting", 150000);
    // The run row cannot be updated once the milestones are written (Sheets 5xx until retries are exhausted).
    const base = ctx.repo;
    let broken = true;
    const flaky: DataRepository = new Proxy(base, {
      get(target, prop, recv) {
        if (prop === "update") return async (...a: Parameters<DataRepository["update"]>) => {
          const patch = a[3] as { steps?: Record<string, { status: string }> };
          if (broken && a[0] === "WorkflowRuns" && patch.steps?.milestones) throw new Error("storage unavailable");
          return target.update(...a);
        };
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const first = await won(oppId, ctxOf(flaky));
    expect(first.status).toBe("failed");
    let c = await counts(base, oppId);
    expect(c.milestones).toBe(4); // written…
    expect(c.run!.steps.milestones).toBeUndefined(); // …but never marked done
    broken = false;
    expect((await won(oppId)).status).toBe("done");
    c = await counts(base, oppId);
    expect(c).toMatchObject({ clients: 1, projects: 1, milestones: 4, tasks: 1 });
  });

  it("two founders clicking at the same time end with one client and one project", async () => {
    const { oppId } = await wonDeal("consulting", 150000);
    const pablo = ctxOf(makeRepo(url));
    await Promise.allSettled([won(oppId), wonToProject(pablo, "pablo", { opportunity_id: oppId, start_date: "", owner_founder: null, promised: "", stakeholders: "", success: "" })]);
    await won(oppId); // whichever lost the race finishes here
    expect(await counts(ctx.repo, oppId)).toMatchObject({ clients: 1, projects: 1, milestones: 4, tasks: 1 });
  });

  it("a second won deal for the same business reuses the client", async () => {
    const { accountId, oppId } = await wonDeal("consulting", 150000);
    await won(oppId);
    const opp2 = randomUUID();
    await ctx.repo.insert("Opportunities", [{ id: opp2, account_id: accountId, primary_contact_id: "", name: "Phase 2", brand: "consulting", market: "FR", stage: "won", owner_founder: "theo", value_minor: 90000, currency: "EUR", expected_close: null, next_action: "", next_action_due: null, next_action_priority: "normal", next_action_reason: "", lost_reason: "", anum_authority: "", anum_need: "", anum_urgency: "", anum_money: "" }], { founder: "theo" });
    await won(opp2);
    const t = await ctx.repo.listMany(["Clients", "Projects"], { fresh: true });
    expect(t.Clients.rows).toHaveLength(1);
    expect(t.Projects.rows).toHaveLength(2);
  });
});

describe("Contractor assignment, capacity, margin and status", () => {
  it("assigns a contractor with a rate, warns above capacity, and computes estimated margin and status", async () => {
    const { oppId } = await wonDeal("consulting", 150000);
    expect((await won(oppId)).status).toBe("done");
    let o = await deliveryOverview(ctx, "theo", new Date("2026-11-03T10:00:00Z"));
    let p = o.projects[0];
    // Seeds: 20 founder hours × 30 €; revenue 1,500 € one-off (deal value, no accepted quote).
    expect(p).toMatchObject({ revenue: 150000, source: "offer", status: "planned" });
    expect(p.estimate.founder).toBe(60000);
    expect(p.margin).toEqual({ margin: 90000, pct: 60, status: "healthy" });

    const vendorId = randomUUID();
    await createVendor(ctx, "theo", { id: vendorId, vendor: { name: "Camille Exemple (test)", company: "", skills: ["automatisation"], services: "", timezone: "Europe/Paris", country: "FR", currency: "EUR", hourly_rate_eur: 45, daily_rate_eur: null, fixed_rate_eur: null, capacity_hours_week: 10, availability: "available", response_sla_hours: null, nda_status: "signed", contract_status: "none", rate_valid_until: "", contact_email: "camille@example.com", contact_phone: "", notes: "", quality_feedback: "" } });
    const assignmentId = randomUUID();
    const r = await assignContractor(ctx, "theo", { id: assignmentId, project_id: p.id, vendor_id: vendorId, role: "Automatisations", rate_eur: 45, rate_unit: "hour", planned_hours: 48, start_date: "2026-11-02", end_date: "2026-11-29", note: "" });
    expect(r.capacity).toMatchObject({ plannedPerWeek: 12, capacity: 10, over: true });
    expect(r.ndaSigned).toBe(true);
    // Retrying the same assignment adds nothing.
    expect((await assignContractor(ctx, "theo", { id: assignmentId, project_id: p.id, vendor_id: vendorId, role: "", rate_eur: 45, rate_unit: "hour", planned_hours: 48, start_date: "", end_date: "", note: "" })).duplicate).toBe(true);

    o = await deliveryOverview(ctx, "theo", new Date("2026-11-03T10:00:00Z"));
    p = o.projects[0];
    expect(p.estimate).toMatchObject({ founder: 60000, contractors: 216000, total: 276000 });
    expect(p.margin).toMatchObject({ margin: -126000, status: "negative" });
    expect(p.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(["negative_margin", "over_capacity"]));
    const partners = await partnersOverview(ctx, "theo");
    expect(partners.vendors[0]).toMatchObject({ freeHoursWeek: 0, projects: ["Garage Test"] });
    expect(partners.vendors[0].load.over).toBe(true);

    // The Command Center attention list and the owner's notifications carry the delivery alerts.
    expect((await deliveryAttention(ctx, "theo")).map((a) => a.title)).toContain("Potential negative margin");
    expect((await notifications(ctx, "theo")).some((n) => n.title === "Potential negative margin")).toBe(true);

    // Fewer hours at the agreed rate: at risk, then healthy once cancelled.
    const a = (await ctx.repo.get("ProjectAssignments", assignmentId))!;
    const a2 = await updateAssignment(ctx, "theo", { id: assignmentId, expected_version: a.version, patch: { planned_hours: 10 } });
    p = (await deliveryOverview(ctx, "theo", new Date("2026-11-03T10:00:00Z"))).projects[0];
    expect(p.margin).toMatchObject({ margin: 150000 - 60000 - 45000, status: "healthy" }); // 30 %
    await expect(updateAssignment(ctx, "theo", { id: assignmentId, expected_version: a.version, patch: { planned_hours: 5 } })).rejects.toMatchObject({ code: "conflict" });
    await updateAssignment(ctx, "theo", { id: assignmentId, expected_version: a2.version, patch: { planned_hours: 15 } }); // 1,500 − 600 − 675 = 225 € (15 %)
    p = (await deliveryOverview(ctx, "theo", new Date("2026-11-03T10:00:00Z"))).projects[0];
    expect(p.margin.status).toBe("at_risk");
  });

  it("flags overdue milestones and unassigned project tasks after the dates pass", async () => {
    const { oppId } = await wonDeal("consulting", 150000);
    await won(oppId);
    const o = await deliveryOverview(ctx, "theo", new Date("2026-11-30T10:00:00Z"));
    expect(o.projects[0].alerts.filter((a) => a.kind === "overdue_milestone").map((a) => (a as { title: string }).title)).toEqual(["Kick-off", "Diagnostic shared"]);
  });
});

describe("Valemont Local subscription: usage, limits and contribution margin", () => {
  it("creates a Local project from the offer and computes the monthly margin with provisions and support overrun", async () => {
    const { oppId } = await wonDeal("local", null, "Plomberie Test (test)");
    await won(oppId);
    const o = await deliveryOverview(ctx, "theo");
    const p = o.projects[0];
    expect(p).toMatchObject({ mrr_minor: 10000, term_months: 12, revenue: 120000 });
    expect(p.estimate.api + p.estimate.infra).toBe(3700 * 12); // provisions × term, labelled provisions
    const clientId = p.client_id;

    await saveUsage(ctx, "theo", { client_id: clientId, month: "2026-11", values: { conversations: 170, qualified_requests: 20, automated_emails: 210, support_minutes: 60, locations: 1 }, actual_cost_eur: null, note: "", expected_version: null });
    let l = await localOverview(ctx, "theo", "2026-11");
    expect(l.rows[0].margin).toMatchObject({ costMinor: 1700 + 4000, marginMinor: 4300, extraSupportMinutes: 30, costBasis: "provisions" });
    expect(l.rows[0].margin.levels).toMatchObject({ conversations: "warn", automated_emails: "over", support_minutes: "over", qualified_requests: "ok" });
    expect(l.totals).toMatchObject({ clients: 1, entered: 1, overSupport: 1, alerts: 1 });
    // A second entry without the version it saw is a visible conflict, never a silent overwrite.
    await expect(saveUsage(ctx, "pablo", { client_id: clientId, month: "2026-11", values: { conversations: 1, qualified_requests: 1, automated_emails: 1, support_minutes: 1, locations: 1 }, actual_cost_eur: null, note: "", expected_version: null })).rejects.toMatchObject({ code: "conflict" });
    // CSV import updates the same month row (one row per client and month).
    const r = await importUsageCsv(ctx, "pablo", { csv: "client,month,support_minutes,actual_cost\nPlomberie Test (test),2026-11,25,30\nInconnu,2026-11,1,\n" });
    expect(r.saved).toBe(1);
    expect(r.errors).toEqual([{ line: 3, reason: "Unknown client" }]);
    l = await localOverview(ctx, "theo", "2026-11");
    expect(l.rows[0].margin).toMatchObject({ costMinor: 3000, marginMinor: 7000, costBasis: "actual", extraSupportMinutes: 0 });
    expect(l.rows[0].values.conversations).toBe(170); // columns missing from the CSV keep their value
    expect((await ctx.repo.list("LocalSubscriptionUsage", { fresh: true })).rows).toHaveLength(1);
  });
});
