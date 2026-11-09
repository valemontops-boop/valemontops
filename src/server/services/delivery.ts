import { z } from "zod";
import { type DataRepository, type Row } from "@/data/repository";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import {
  actualCost, capacityCheck, DELIVERY_TEMPLATES, forecastCost, marginOf, MARGIN_GUARDRAIL_PCT_SEED, projectAlerts, projectCost,
  projectRevenue, PROJECT_STATUSES, templateMilestones, type ProjectAlert,
} from "@/domain/delivery";
import { addDays, localDate } from "@/domain/time";
import { eurConverter, PAY_CURRENCIES, usdToEur, type UsdRate } from "@/domain/usd";
import { LOCALE_OF, translate } from "@/i18n";
import { childId } from "@/lib/ids";
import { patchOf } from "@/lib/zod";
import type { AppContext } from "../context";
import { RuleError } from "../errors";
import { numSetting, offerDefaults, userRow } from "./common";
import { localProvisions } from "./local-subscriptions";
import { quoteForOpportunity } from "./quotes";
import { runWorkflow, runIdOf, stepChildId } from "./workflows";
import { bankRatesOf, currentUsdRate, usdPayments } from "./usd-rates";

/* ---------- quote lookup (Stage 2A) ---------- */

/** What a project inherits from the deal's accepted (else approved / sent, not expired) quote: Stage 2A `quoteForOpportunity`. */
export interface QuoteForProject {
  id: string;
  lines: { label: string; qty: number; unit_minor: number; kind: "one_off" | "monthly" }[];
  oneOffMinor: number;
  mrrMinor: number;
  termMonths: number | null;
  founderHours: number;
  /** Quoted delivery cost (one-off + monthly × term), founder labour included. */
  estimatedCostMinor: number;
  scope: string;
}

export async function quoteForProject(repo: DataRepository, opportunityId: string, hourCostMinor: number): Promise<QuoteForProject | null> {
  const q = await quoteForOpportunity(repo, opportunityId);
  if (!q) return null;
  const months = Math.max(1, q.termMonths ?? (q.mrrMinor > 0 ? 12 : 1));
  const cost = q.estimatedDeliveryCost.oneOffMinor + (q.mrrMinor > 0 || q.estimatedDeliveryCost.monthlyMinor > 0 ? q.estimatedDeliveryCost.monthlyMinor * months : 0);
  return {
    id: q.quote.id, lines: q.services, oneOffMinor: q.oneOffMinor, mrrMinor: q.mrrMinor, termMonths: q.termMonths, founderHours: q.estimatedDeliveryCost.founderHours,
    // The quote's hour cost may differ from today's: the founder share is recomputed by the calculator, the rest stays as quoted.
    estimatedCostMinor: Math.max(0, cost - Math.round(q.estimatedDeliveryCost.founderHours * (q.quote.hour_cost_minor || hourCostMinor))),
    scope: [q.quote.scope, q.quote.exclusions ? `— ${q.quote.exclusions}` : ""].filter(Boolean).join("\n").slice(0, 4_000),
  };
}

/* ---------- Won → Client & Project (WorkflowRuns) ---------- */

export const wonSchema = z.object({
  opportunity_id: z.string().uuid(),
  start_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
  owner_founder: z.enum(FOUNDERS).nullable().default(null),
  promised: z.string().trim().max(2_000).default(""),
  stakeholders: z.string().trim().max(1_000).default(""),
  success: z.string().trim().max(1_000).default(""),
});
type WonInput = { opportunity_id: string; account_id: string; start_date: string; owner: FounderKey; promised: string; stakeholders: string; success: string };

/** Test hook: lets an integration test kill the workflow between two steps (scenario 7). */
export const workflowHooks: { beforeStep?: (step: string) => void | Promise<void> } = {};

export async function wonToProject(ctx: AppContext, founder: FounderKey, i: z.infer<typeof wonSchema>) {
  const repo = ctx.repo;
  const opp = await repo.get("Opportunities", i.opportunity_id, { fresh: true });
  if (!opp || opp.is_archived) throw new RuleError("Record not found");
  if (opp.stage !== "won") throw new RuleError("Only a won deal can become a client and a project.");
  const account = await repo.get("Accounts", opp.account_id);
  if (!account) throw new RuleError("Record not found");
  const owner = i.owner_founder ?? opp.owner_founder ?? founder;
  const tz = (await userRow(repo, owner)).timezone;
  const input: WonInput = { opportunity_id: opp.id, account_id: account.id, start_date: i.start_date || localDate(new Date(), tz), owner, promised: i.promised, stakeholders: i.stakeholders, success: i.success };
  const clientId = childId("client", account.id);
  const hook = async (s: string) => { await workflowHooks.beforeStep?.(s); };

  return runWorkflow(repo, founder, {
    workflow: "won_to_project", subjectType: "opportunity", subjectId: opp.id, input,
    steps: [
      {
        name: "client",
        run: async (inp, runId) => {
          await hook("client");
          // One client per business: a second won deal for the same business reuses it.
          if (await repo.get("Clients", clientId, { fresh: true })) return [clientId];
          await repo.insert("Clients", [{ id: clientId, account_id: account.id, opportunity_id: opp.id, name: account.name, brand: opp.brand, market: opp.market ?? account.country, owner_founder: inp.owner, status: "onboarding", started_on: inp.start_date, workflow_run_id: runId }], { founder });
          return [clientId];
        },
      },
      {
        name: "project",
        run: async (inp, runId) => {
          await hook("project");
          const id = stepChildId(runId, "project");
          if (await repo.get("Projects", id, { fresh: true })) return [id];
          await repo.insert("Projects", [await projectFromDeal(repo, opp, inp, id, clientId, runId)], { founder });
          return [id];
        },
      },
      {
        name: "milestones",
        run: async (inp, runId) => {
          await hook("milestones");
          const projectId = stepChildId(runId, "project");
          const plan = templateMilestones(opp.brand, inp.start_date);
          const ids = plan.map((_, n) => stepChildId(runId, "milestone", String(n)));
          const have = new Set((await repo.list("Milestones", { fresh: true })).rows.map((m) => m.id));
          const missing = plan.map((m, n) => ({ id: ids[n], project_id: projectId, title: m.title, due_date: m.due_date, done_at: null, sort: n })).filter((m) => !have.has(m.id));
          if (missing.length) await repo.insert("Milestones", missing, { founder });
          return ids;
        },
      },
      {
        name: "handoff",
        run: async (inp, runId) => {
          await hook("handoff");
          const id = stepChildId(runId, "kickoff-task");
          if (await repo.get("Tasks", id, { fresh: true })) return [id];
          const l = LOCALE_OF[inp.owner];
          const tr = (s: string, v?: Record<string, string>) => translate(l, s, v);
          const description = [
            inp.promised ? `${tr("What was promised")}: ${inp.promised}` : "",
            inp.stakeholders ? `${tr("Stakeholders")}: ${inp.stakeholders}` : "",
            inp.success ? `${tr("Success criteria")}: ${inp.success}` : "",
          ].filter(Boolean).join("\n");
          await repo.insert("Tasks", [projectTaskRow(id, inp.owner, founder, { title: tr("Kick-off with {name}", { name: account.name }).slice(0, 300), description, project_id: stepChildId(runId, "project"), client_id: clientId, due_at: addDays(inp.start_date, 3), priority: "P1", account_id: account.id, opportunity_id: opp.id, source_id: "kickoff" })], { founder });
          return [id];
        },
      },
    ],
  });
}

async function projectFromDeal(repo: DataRepository, opp: Row<"Opportunities">, inp: WonInput, id: string, clientId: string, runId: string) {
  const quote = await quoteForProject(repo, opp.id, (await deliverySettings(repo)).hourCostMinor);
  const tpl = DELIVERY_TEMPLATES[opp.brand];
  const defaults = await offerDefaults(repo);
  const prov = await localProvisions(repo);
  const term = quote?.termMonths ?? (quote ? (quote.mrrMinor > 0 ? 12 : null) : tpl.termMonths);
  const months = Math.max(1, term ?? 1);
  let oneOff = 0, mrr = 0, api = 0, infra = 0, other = 0;
  if (quote) {
    oneOff = quote.oneOffMinor; mrr = quote.mrrMinor; other = quote.estimatedCostMinor;
  } else if (opp.brand === "local") {
    mrr = opp.value_minor ?? defaults.local;
  } else if (opp.brand === "thirty") {
    oneOff = opp.value_minor ?? 3900;
  } else {
    oneOff = opp.value_minor ?? defaults.consulting;
  }
  if (opp.brand === "local" && !quote) {
    // Local running costs from the provisions (labelled provisions, not actuals): AI tokens as API, the rest as infrastructure.
    const ai = prov.lines.find((l) => l.key === "ai_tokens")?.minor ?? 0;
    api = ai * months;
    infra = (prov.lines.reduce((s, l) => s + l.minor, 0) - ai + Math.round((prov.includedSupportMinutes / 60) * prov.supportRateMinorPerHour)) * months;
  }
  const services: Row<"Projects">["services"] = quote?.lines.length
    ? quote.lines
    : [{ label: opp.brand === "local" ? "Valemont Local" : opp.brand === "thirty" ? "30/30 AI" : "Valemont Consulting", qty: 1, unit_minor: mrr || oneOff, kind: mrr ? "monthly" : "one_off" }];
  const due = templateMilestones(opp.brand, inp.start_date).at(-1)?.due_date ?? null;
  return {
    id, client_id: clientId, account_id: opp.account_id, opportunity_id: opp.id, quote_id: quote?.id ?? "", name: opp.name, brand: opp.brand, market: opp.market,
    owner_founder: inp.owner, status: "planned" as const, start_date: inp.start_date, due_date: due, scope: quote?.scope || inp.promised,
    services, checklist: tpl.checklist.map((label, n) => ({ id: String(n + 1), label, done: false })),
    revenue_one_off_minor: oneOff, mrr_minor: mrr, term_months: term, est_founder_hours: quote ? quote.founderHours : tpl.founderHours, est_api_minor: api, est_infra_minor: infra, est_other_minor: other,
    handoff_promised: inp.promised, handoff_stakeholders: inp.stakeholders, handoff_success: inp.success, source: quote ? ("quote" as const) : ("offer" as const), workflow_run_id: runId,
  };
}

function projectTaskRow(id: string, owner: FounderKey | null, by: FounderKey, t: { title: string; description: string; project_id: string; client_id: string; due_at: string | null; priority: "P0" | "P1" | "P2" | "P3"; account_id?: string; opportunity_id?: string; source_id?: string }) {
  return {
    id, title: t.title, description: t.description, owner, created_by_founder: by, account_id: t.account_id ?? "", opportunity_id: t.opportunity_id ?? "", project_id: t.project_id, client_id: t.client_id,
    priority: t.priority, status: "todo" as const, estimated_minutes: null, due_at: t.due_at, recurrence: "none" as const, recurrence_days: [], recurrence_parent_id: "", dependency_ids: [],
    completion_evidence: "", completed_at: null, visibility: "team" as const, snoozed_until: null, snooze_reason: "", area: "ops" as const, source: "system" as const, source_id: t.source_id ?? "",
  };
}

/* ---------- overview ---------- */

export async function deliverySettings(repo: DataRepository) {
  return {
    hourCostMinor: Math.round((await numSetting(repo, "founder_hour_cost_eur", 30)) * 100),
    guardrailPct: await numSetting(repo, "project_margin_guardrail_pct", MARGIN_GUARDRAIL_PCT_SEED),
  };
}

export type ProjectView = Awaited<ReturnType<typeof deliveryOverview>>["projects"][number];

export async function deliveryOverview(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const t = await ctx.repo.listMany(["Clients", "Projects", "Milestones", "TimeEntries", "ProjectCosts", "ProjectAssignments", "Vendors", "Tasks", "WorkflowRuns", "Opportunities", "Accounts", "BankTransactions"]);
  const today = localDate(now, (await userRow(ctx.repo, founder)).timezone);
  const s = await deliverySettings(ctx.repo);
  // USD contractors (D085): a cost paid through Wise uses that payment's real rate; the rest today's Wise / manual / demo rate.
  const usd = await currentUsdRate(ctx, today);
  const toEur = eurConverter(usd.rate);
  const bankRates = bankRatesOf(t.BankTransactions.rows);
  const costRate = (c: { currency: string; wise_tx_id: string }): UsdRate | null => (c.currency.toUpperCase() === "USD" ? bankRates.get(c.wise_tx_id) ?? usd.rate : null);
  const costEur = (c: { amount_minor: number; currency: string; wise_tx_id: string }): number | null => {
    if (c.currency.toUpperCase() === "EUR") return c.amount_minor;
    const r = costRate(c);
    return c.currency.toUpperCase() === "USD" && r ? usdToEur(c.amount_minor, r.micro) : null;
  };
  const live = <R extends { is_archived: boolean }>(rows: R[]) => rows.filter((r) => !r.is_archived);
  const vendors = live(t.Vendors.rows);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const assignments = live(t.ProjectAssignments.rows);
  const overCap = new Set(vendors.filter((v) => capacityCheck(v.capacity_hours_week, assignments.filter((a) => a.vendor_id === v.id)).over).map((v) => v.id));
  const clients = live(t.Clients.rows);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const projects = live(t.Projects.rows).map((p) => {
    const ms = live(t.Milestones.rows).filter((m) => m.project_id === p.id).sort((a, b) => a.sort - b.sort || (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    const as = assignments.filter((a) => a.project_id === p.id);
    const entries = live(t.TimeEntries.rows).filter((e) => e.project_id === p.id);
    const costs = live(t.ProjectCosts.rows).filter((c) => c.project_id === p.id);
    const tasks = live(t.Tasks.rows).filter((x) => x.project_id === p.id);
    const estimate = projectCost({ founderHours: p.est_founder_hours, hourCostMinor: s.hourCostMinor, assignments: as, apiMinor: p.est_api_minor, infraMinor: p.est_infra_minor, otherMinor: p.est_other_minor, toEur });
    const actual = actualCost({ entries: entries.map((e) => ({ minutes: e.minutes, person_kind: e.person_kind, vendor_id: e.vendor_id })), costs: costs.map((c) => ({ amount_minor: c.amount_minor, kind: c.kind, currency: c.currency, eur_minor: costEur(c) })), hourCostMinor: s.hourCostMinor, assignments: as, toEur });
    const revenue = projectRevenue(p);
    const forecast = forecastCost(estimate.total, actual.total);
    const margin = marginOf(revenue, forecast, s.guardrailPct);
    const alerts: ProjectAlert[] = projectAlerts({ today, milestones: ms, tasks, margin, overCapacityVendors: [...new Set(as.filter((a) => overCap.has(a.vendor_id) && a.status !== "cancelled" && a.status !== "done").map((a) => vendorName.get(a.vendor_id) ?? ""))].filter(Boolean), delivered: p.status === "delivered" });
    const plannedContractorHours = as.filter((a) => a.status !== "cancelled").reduce((x, a) => x + a.planned_hours, 0);
    return {
      ...p, clientName: clientName.get(p.client_id) ?? p.name, milestones: ms,
      assignments: as.map((a) => ({ ...a, vendorName: vendorName.get(a.vendor_id) ?? "—", overCapacity: overCap.has(a.vendor_id), rate_eur_minor: toEur(a.rate_minor, a.currency), fx_rate: a.currency.toUpperCase() === "USD" ? usd.rate : null })),
      entries: entries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map((e) => ({ ...e, who: e.person_kind === "founder" ? e.founder_key ?? "" : vendorName.get(e.vendor_id) ?? "—" })),
      costs: costs.sort((a, b) => b.date.localeCompare(a.date)).map((c) => ({ ...c, eur_minor: costEur(c), fx_rate: costRate(c) })),
      tasks: tasks.map((x) => ({ id: x.id, version: x.version, title: x.title, owner: x.owner, status: x.status, due_at: x.due_at, priority: x.priority })),
      estimate, actual, revenue, forecast, margin, alerts,
      hours: { estimated: p.est_founder_hours + plannedContractorHours, actual: Math.round((actual.founderHours + actual.contractorHours) * 10) / 10 },
    };
  });
  const runs = t.WorkflowRuns.rows.filter((r) => !r.is_archived && r.status !== "done").map((r) => {
    const opp = t.Opportunities.rows.find((o) => o.id === r.subject_id);
    return { id: r.id, version: r.version, workflow: r.workflow, status: r.status, subject_id: r.subject_id, name: opp?.name ?? "—", steps: r.steps, last_error: r.last_error, updated_at: r.updated_at };
  });
  // Won deals with no workflow yet: the CRM offers the one-click conversion; listed here too so nothing is forgotten.
  const runSubjects = new Set(t.WorkflowRuns.rows.map((r) => r.subject_id));
  const wonWaiting = t.Opportunities.rows.filter((o) => !o.is_archived && o.stage === "won" && !runSubjects.has(o.id)).map((o) => ({ id: o.id, name: o.name, brand: o.brand, account_id: o.account_id }));
  return {
    today, hourCostMinor: s.hourCostMinor, guardrailPct: s.guardrailPct, statuses: PROJECT_STATUSES,
    usd: { rate: usd.rate, wise_status: usd.wise_status, payments: usdPayments(t.BankTransactions.rows) },
    clients: clients.map((c) => ({ id: c.id, version: c.version, name: c.name, brand: c.brand, market: c.market, status: c.status, owner_founder: c.owner_founder, account_id: c.account_id })),
    projects, runs, wonWaiting,
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, hourly_rate_minor: v.hourly_rate_minor, daily_rate_minor: v.daily_rate_minor, fixed_rate_minor: v.fixed_rate_minor, currency: v.currency, capacity_hours_week: v.capacity_hours_week })),
  };
}

/** Status of the Won → Project workflow for one deal (CRM button). */
export async function wonStatus(ctx: AppContext, opportunityId: string) {
  const run = await ctx.repo.get("WorkflowRuns", runIdOf("won_to_project", opportunityId));
  if (!run) return { status: "none" as const, projectId: null };
  return { status: run.status, projectId: run.steps.project?.ids[0] ?? null, last_error: run.last_error, steps: run.steps };
}

/* ---------- alerts for the Command Center and notifications ---------- */

const ALERT_TITLE: Record<ProjectAlert["kind"], string> = {
  overdue_milestone: "Overdue milestone",
  unassigned_tasks: "Unassigned project tasks",
  negative_margin: "Potential negative margin",
  at_risk_margin: "Margin at risk",
  over_capacity: "Contractor over capacity",
};
export async function deliveryAttention(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const o = await deliveryOverview(ctx, founder, now);
  const out: { key: string; owner: string | null; title: string; detail: string; href: string }[] = [];
  for (const p of o.projects) for (const a of p.alerts) {
    if (a.kind === "at_risk_margin") continue; // shown in the project only; the attention list keeps what needs action
    const detail = a.kind === "overdue_milestone" ? `${p.name} · ${a.title} · ${a.due}` : a.kind === "unassigned_tasks" ? `${p.name} · ${a.count}` : a.kind === "over_capacity" ? `${p.name} · ${a.vendor}` : `${p.name} · ${(a.marginMinor / 100).toFixed(0)} €`;
    out.push({ key: `proj:${p.id}:${a.kind}:${a.kind === "overdue_milestone" ? a.title + a.due : ""}`, owner: p.owner_founder, title: ALERT_TITLE[a.kind], detail, href: `/clients?project=${p.id}` });
  }
  return out;
}

/* ---------- mutations ---------- */

const optDay = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const projectPatch = z.object({
  status: z.enum(PROJECT_STATUSES),
  owner_founder: z.enum(FOUNDERS).nullable(),
  due_date: optDay,
  scope: z.string().trim().max(4_000),
  est_founder_hours: z.number().int().min(0).max(10_000),
  est_api_eur: z.number().min(0).max(1_000_000),
  est_infra_eur: z.number().min(0).max(1_000_000),
  term_months: z.number().int().min(1).max(120).nullable(),
  handoff_promised: z.string().trim().max(2_000),
  handoff_stakeholders: z.string().trim().max(1_000),
  handoff_success: z.string().trim().max(1_000),
  checklist: z.array(z.object({ id: z.string().max(40), label: z.string().trim().min(1).max(300), done: z.boolean() })).max(60),
});
export const updateProjectSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: patchOf(projectPatch) });
export async function updateProject(ctx: AppContext, founder: FounderKey, i: z.infer<typeof updateProjectSchema>) {
  const { est_api_eur, est_infra_eur, due_date, ...rest } = i.patch;
  const patch: Partial<Row<"Projects">> = { ...rest };
  if (est_api_eur !== undefined) patch.est_api_minor = Math.round(est_api_eur * 100);
  if (est_infra_eur !== undefined) patch.est_infra_minor = Math.round(est_infra_eur * 100);
  if (due_date !== undefined) patch.due_date = due_date || null;
  return ctx.repo.update("Projects", i.id, i.expected_version, patch, { founder });
}

async function mustProject(repo: DataRepository, id: string) {
  const p = await repo.get("Projects", id);
  if (!p || p.is_archived) throw new RuleError("Record not found");
  return p;
}

export const milestoneSchema = z.object({ id: z.string().uuid(), project_id: z.string().uuid(), title: z.string().trim().min(1).max(200), due_date: optDay.default("") });
export async function addMilestone(ctx: AppContext, founder: FounderKey, i: z.infer<typeof milestoneSchema>) {
  await mustProject(ctx.repo, i.project_id);
  if (await ctx.repo.get("Milestones", i.id, { fresh: true })) return { duplicate: true };
  const sort = (await ctx.repo.list("Milestones")).rows.filter((m) => m.project_id === i.project_id).length;
  await ctx.repo.insert("Milestones", [{ id: i.id, project_id: i.project_id, title: i.title, due_date: i.due_date || null, done_at: null, sort }], { founder });
  return { duplicate: false };
}
export const milestoneUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: z.object({ title: z.string().trim().min(1).max(200).optional(), due_date: optDay.optional(), done: z.boolean().optional(), archived: z.boolean().optional() }) });
export async function updateMilestone(ctx: AppContext, founder: FounderKey, i: z.infer<typeof milestoneUpdateSchema>) {
  const patch: Partial<Row<"Milestones">> = {};
  if (i.patch.title !== undefined) patch.title = i.patch.title;
  if (i.patch.due_date !== undefined) patch.due_date = i.patch.due_date || null;
  if (i.patch.done !== undefined) patch.done_at = i.patch.done ? new Date().toISOString() : null;
  if (i.patch.archived !== undefined) patch.is_archived = i.patch.archived;
  return ctx.repo.update("Milestones", i.id, i.expected_version, patch, { founder });
}

export const timeEntrySchema = z.object({
  id: z.string().uuid(), project_id: z.string().uuid(), person_kind: z.enum(["founder", "contractor"]), founder_key: z.enum(FOUNDERS).nullable().default(null),
  vendor_id: z.union([z.literal(""), z.string().uuid()]).default(""), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hours: z.number().positive().max(24), note: z.string().trim().max(500).default(""),
});
export async function addTimeEntry(ctx: AppContext, founder: FounderKey, i: z.infer<typeof timeEntrySchema>) {
  await mustProject(ctx.repo, i.project_id);
  if (i.person_kind === "contractor" && !i.vendor_id) throw new RuleError("Choose the contractor.");
  if (await ctx.repo.get("TimeEntries", i.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("TimeEntries", [{ id: i.id, project_id: i.project_id, person_kind: i.person_kind, founder_key: i.person_kind === "founder" ? i.founder_key ?? founder : null, vendor_id: i.person_kind === "contractor" ? i.vendor_id : "", date: i.date, minutes: Math.round(i.hours * 60), note: i.note }], { founder });
  return { duplicate: false };
}

export const costSchema = z.object({
  id: z.string().uuid(), project_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kind: z.enum(["api", "infra", "contractor", "other"]),
  /** Amount in `currency` (named before D085, when everything was EUR). */
  label: z.string().trim().min(1).max(200), amount_eur: z.number().min(0).max(1_000_000), tool_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  currency: z.enum(PAY_CURRENCIES).optional(),
  /** The Wise payment that paid it (its real rate converts USD to EUR). */
  wise_tx_id: z.union([z.literal(""), z.string().uuid()]).optional(),
});
export async function addCost(ctx: AppContext, founder: FounderKey, i: z.infer<typeof costSchema>) {
  await mustProject(ctx.repo, i.project_id);
  if (await ctx.repo.get("ProjectCosts", i.id, { fresh: true })) return { duplicate: true };
  const currency = i.currency ?? "EUR", wiseTx = i.wise_tx_id ?? "";
  if (wiseTx) await mustUsdPayment(ctx.repo, wiseTx, currency);
  await ctx.repo.insert("ProjectCosts", [{ id: i.id, project_id: i.project_id, date: i.date, kind: i.kind, label: i.label, amount_minor: Math.round(i.amount_eur * 100), currency, tool_id: i.tool_id, wise_tx_id: wiseTx }], { founder });
  return { duplicate: false };
}

/** A Wise movement can give its rate only when it is a USD payment out of a EUR balance. */
async function mustUsdPayment(repo: DataRepository, txId: string, currency: string) {
  if (currency !== "USD") throw new RuleError("Only a USD cost takes the rate of a Wise payment.");
  const tx = await repo.get("BankTransactions", txId);
  if (!tx || tx.is_archived || !bankRatesOf([tx]).has(tx.id)) throw new RuleError("This Wise movement is not a USD payment.");
}

export const costLinkSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), wise_tx_id: z.union([z.literal(""), z.string().uuid()]) });
/** Link (or unlink) a USD project cost to the Wise payment that paid it, once paid: its real rate replaces the estimate. */
export async function linkCost(ctx: AppContext, founder: FounderKey, i: z.infer<typeof costLinkSchema>) {
  const c = await ctx.repo.get("ProjectCosts", i.id, { fresh: true });
  if (!c || c.is_archived) throw new RuleError("Record not found");
  if (i.wise_tx_id) await mustUsdPayment(ctx.repo, i.wise_tx_id, c.currency.toUpperCase());
  return ctx.repo.update("ProjectCosts", i.id, i.expected_version, { wise_tx_id: i.wise_tx_id }, { founder });
}

export const assignSchema = z.object({
  id: z.string().uuid(), project_id: z.string().uuid(), vendor_id: z.string().uuid(), role: z.string().trim().max(200).default(""),
  /** Rate in `currency` (named before D085). */
  rate_eur: z.number().min(0).max(100_000), rate_unit: z.enum(["hour", "day", "fixed"]), planned_hours: z.number().int().min(0).max(5_000),
  /** Defaults to the contractor's currency (EUR or USD). */
  currency: z.enum(PAY_CURRENCIES).optional(),
  start_date: optDay.default(""), end_date: optDay.default(""), note: z.string().trim().max(500).default(""),
});
/** Assign a contractor with a rate and planned hours; returns the capacity check (a warning, never a silent block). */
export async function assignContractor(ctx: AppContext, founder: FounderKey, i: z.infer<typeof assignSchema>) {
  await mustProject(ctx.repo, i.project_id);
  const vendor = await ctx.repo.get("Vendors", i.vendor_id);
  if (!vendor || vendor.is_archived) throw new RuleError("Record not found");
  if (vendor.availability === "unavailable") throw new RuleError("This contractor is marked unavailable.");
  if (i.start_date && i.end_date && i.end_date < i.start_date) throw new RuleError("The end date is before the start date.");
  const existing = await ctx.repo.get("ProjectAssignments", i.id, { fresh: true });
  if (!existing) {
    await ctx.repo.insert("ProjectAssignments", [{ id: i.id, project_id: i.project_id, vendor_id: i.vendor_id, role: i.role, rate_minor: Math.round(i.rate_eur * 100), rate_unit: i.rate_unit, currency: i.currency ?? (vendor.currency.toUpperCase() === "USD" ? "USD" : "EUR"), planned_hours: i.planned_hours, start_date: i.start_date || null, end_date: i.end_date || null, status: "planned", note: i.note }], { founder });
  }
  const all = (await ctx.repo.list("ProjectAssignments", { fresh: true })).rows.filter((a) => !a.is_archived && a.vendor_id === vendor.id);
  const cap = capacityCheck(vendor.capacity_hours_week, all);
  const rateExpired = Boolean(vendor.rate_valid_until && vendor.rate_valid_until < localDate(new Date(), "Europe/Paris"));
  return { duplicate: Boolean(existing), capacity: cap, rateExpired, ndaSigned: vendor.nda_status === "signed" };
}
export const assignmentUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: z.object({ status: z.enum(["planned", "active", "done", "cancelled"]).optional(), planned_hours: z.number().int().min(0).max(5_000).optional(), rate_eur: z.number().min(0).max(100_000).optional(), currency: z.enum(PAY_CURRENCIES).optional() }) });
export async function updateAssignment(ctx: AppContext, founder: FounderKey, i: z.infer<typeof assignmentUpdateSchema>) {
  const { rate_eur, ...rest } = i.patch;
  return ctx.repo.update("ProjectAssignments", i.id, i.expected_version, { ...rest, ...(rate_eur !== undefined ? { rate_minor: Math.round(rate_eur * 100) } : {}) }, { founder });
}

export const projectTaskSchema = z.object({ id: z.string().uuid(), project_id: z.string().uuid(), title: z.string().trim().min(1).max(300), owner: z.enum(FOUNDERS).nullable().default(null), due_at: optDay.default("") });
/** Project tasks are ordinary team Tasks with project_id (they appear in Tasks and My Day). */
export async function addProjectTask(ctx: AppContext, founder: FounderKey, i: z.infer<typeof projectTaskSchema>) {
  const p = await mustProject(ctx.repo, i.project_id);
  if (await ctx.repo.get("Tasks", i.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("Tasks", [projectTaskRow(i.id, i.owner, founder, { title: i.title, description: "", project_id: p.id, client_id: p.client_id, due_at: i.due_at || null, priority: "P2", account_id: p.account_id, opportunity_id: p.opportunity_id })], { founder });
  return { duplicate: false };
}

export const clientUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: z.object({ status: z.enum(["onboarding", "active", "paused", "ended"]).optional(), owner_founder: z.enum(FOUNDERS).nullable().optional() }) });
export async function updateClient(ctx: AppContext, founder: FounderKey, i: z.infer<typeof clientUpdateSchema>) {
  return ctx.repo.update("Clients", i.id, i.expected_version, i.patch, { founder });
}
