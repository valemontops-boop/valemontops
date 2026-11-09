/**
 * Delivery rules (Stage 2, D075): project cost calculator, margin status, contractor capacity, project alerts,
 * Valemont Local plan limits and per-client contribution margin. Pure functions, money in integer cents.
 */
import { addDays } from "./time";

export const PROJECT_STATUSES = ["planned", "in_progress", "review", "delivered", "on_hold"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = { planned: "Planned", in_progress: "In progress", review: "Client review", delivered: "Delivered", on_hold: "On hold" };

export type MarginStatus = "healthy" | "at_risk" | "negative";
export const MARGIN_STATUS_LABELS: Record<MarginStatus, string> = { healthy: "Healthy", at_risk: "At risk", negative: "Negative" };
/** Seed guardrail: below this gross margin a project is "at risk" (setting `project_margin_guardrail_pct`). */
export const MARGIN_GUARDRAIL_PCT_SEED = 30;

export type RateUnit = "hour" | "day" | "fixed";
export interface AssignmentLike { planned_hours: number; rate_minor: number; rate_unit: RateUnit; status?: string; vendor_id?: string; start_date?: string | null; end_date?: string | null }

/** Cost of an assignment: hours × hourly rate, days of 8 h × daily rate, or the fixed fee. */
export function assignmentCost(a: AssignmentLike, hours = a.planned_hours): number {
  if (a.rate_unit === "fixed") return a.rate_minor;
  if (a.rate_unit === "day") return Math.round((hours / 8) * a.rate_minor);
  return Math.round(hours * a.rate_minor);
}

export interface CostInput {
  founderHours: number;
  hourCostMinor: number;
  assignments: AssignmentLike[];
  apiMinor: number;
  infraMinor: number;
  otherMinor?: number;
}
export interface CostBreakdown { founder: number; contractors: number; api: number; infra: number; other: number; total: number }

/** Project cost calculator (spec 5.8): founder labour + contractors + API usage + infrastructure (+ quoted delivery cost not broken down). */
export function projectCost(i: CostInput): CostBreakdown {
  const founder = Math.round(i.founderHours * i.hourCostMinor);
  const contractors = i.assignments.filter((a) => a.status !== "cancelled").reduce((s, a) => s + assignmentCost(a), 0);
  const other = i.otherMinor ?? 0;
  return { founder, contractors, api: i.apiMinor, infra: i.infraMinor, other, total: founder + contractors + i.apiMinor + i.infraMinor + other };
}

export function marginOf(revenueMinor: number, costMinor: number, guardrailPct = MARGIN_GUARDRAIL_PCT_SEED): { margin: number; pct: number | null; status: MarginStatus } {
  const margin = revenueMinor - costMinor;
  const pct = revenueMinor > 0 ? Math.round((margin / revenueMinor) * 1000) / 10 : null;
  const status: MarginStatus = margin < 0 ? "negative" : pct === null || pct < guardrailPct ? "at_risk" : "healthy";
  return { margin, pct, status };
}

/** Revenue counted for a project: one-off + MRR × term (1 month when no term is set). */
export function projectRevenue(p: { revenue_one_off_minor: number; mrr_minor: number; term_months: number | null }): number {
  return p.revenue_one_off_minor + p.mrr_minor * Math.max(1, p.term_months ?? 1);
}

export interface TimeEntryLike { minutes: number; person_kind: "founder" | "contractor"; vendor_id: string }
export interface DirectCostLike { amount_minor: number; kind: string }

/** Actual cost so far: founder minutes × hour cost, contractor minutes × their assignment rate, direct costs. */
export function actualCost(i: { entries: TimeEntryLike[]; costs: DirectCostLike[]; hourCostMinor: number; assignments: AssignmentLike[] }): { founder: number; contractors: number; direct: number; total: number; founderHours: number; contractorHours: number } {
  let founder = 0, contractors = 0, fm = 0, cm = 0;
  for (const e of i.entries) {
    if (e.person_kind === "founder") { fm += e.minutes; founder += Math.round((e.minutes / 60) * i.hourCostMinor); continue; }
    cm += e.minutes;
    const a = i.assignments.find((x) => x.vendor_id === e.vendor_id && x.status !== "cancelled");
    if (a && a.rate_unit !== "fixed") contractors += assignmentCost(a, e.minutes / 60);
  }
  // Fixed-fee assignments cost their fee once work has started on them.
  for (const a of i.assignments) if (a.rate_unit === "fixed" && a.status !== "cancelled" && i.entries.some((e) => e.vendor_id === a.vendor_id)) contractors += a.rate_minor;
  const direct = i.costs.reduce((s, c) => s + c.amount_minor, 0);
  return { founder, contractors, direct, total: founder + contractors + direct, founderHours: fm / 60, contractorHours: cm / 60 };
}

/**
 * Forecast cost: what is spent so far plus what the estimate says is still to come (never below the estimate,
 * never below what is already spent). The margin status uses this forecast, so an overrun shows before the end.
 */
export function forecastCost(estimated: number, actual: number): number {
  return Math.max(estimated, actual);
}

/* ---------- contractor capacity ---------- */

/** Weeks covered by an assignment (at least 1). Open-ended assignments count 4 weeks. */
export function assignmentWeeks(a: { start_date?: string | null; end_date?: string | null }): number {
  if (!a.start_date || !a.end_date) return 4;
  const days = Math.round((Date.parse(a.end_date) - Date.parse(a.start_date)) / 86_400_000) + 1;
  return Math.max(1, Math.ceil(days / 7));
}

/** Planned hours per week for one vendor across active assignments, compared with their capacity. */
export function capacityCheck(capacityHoursWeek: number, assignments: AssignmentLike[]): { plannedPerWeek: number; capacity: number; over: boolean; loadPct: number | null } {
  const active = assignments.filter((a) => a.status !== "cancelled" && a.status !== "done");
  const plannedPerWeek = Math.round(active.reduce((s, a) => s + a.planned_hours / assignmentWeeks(a), 0) * 10) / 10;
  return { plannedPerWeek, capacity: capacityHoursWeek, over: plannedPerWeek > capacityHoursWeek, loadPct: capacityHoursWeek > 0 ? Math.round((plannedPerWeek / capacityHoursWeek) * 100) : null };
}

/** Supplier shortlist (spec 5.8): skills, free capacity, region and cost; cheapest hourly first. */
export function shortlist<V extends { id: string; skills: string[]; country: string; capacity_hours_week: number; availability: string; hourly_rate_minor: number | null }>(
  vendors: V[], freeHours: Map<string, number>, f: { skill?: string; minHours?: number; country?: string; maxRateMinor?: number | null },
): V[] {
  const skill = f.skill?.trim().toLowerCase();
  return vendors
    .filter((v) => v.availability !== "unavailable")
    .filter((v) => !skill || v.skills.some((s) => s.toLowerCase().includes(skill)))
    .filter((v) => !f.country || v.country === f.country)
    .filter((v) => !f.minHours || (freeHours.get(v.id) ?? v.capacity_hours_week) >= f.minHours)
    .filter((v) => !f.maxRateMinor || (v.hourly_rate_minor !== null && v.hourly_rate_minor <= f.maxRateMinor))
    .sort((a, b) => (a.hourly_rate_minor ?? Number.MAX_SAFE_INTEGER) - (b.hourly_rate_minor ?? Number.MAX_SAFE_INTEGER));
}

/* ---------- project alerts ---------- */

export type ProjectAlert =
  | { kind: "overdue_milestone"; title: string; due: string }
  | { kind: "unassigned_tasks"; count: number }
  | { kind: "negative_margin"; marginMinor: number }
  | { kind: "at_risk_margin"; pct: number | null }
  | { kind: "over_capacity"; vendor: string };

export function projectAlerts(i: {
  today: string;
  milestones: { title: string; due_date: string | null; done_at: string | null; is_archived?: boolean }[];
  tasks: { owner: string | null; status: string; is_archived?: boolean }[];
  margin: { margin: number; pct: number | null; status: MarginStatus };
  overCapacityVendors?: string[];
  delivered?: boolean;
}): ProjectAlert[] {
  const out: ProjectAlert[] = [];
  if (!i.delivered) {
    for (const m of i.milestones) if (!m.is_archived && !m.done_at && m.due_date && m.due_date < i.today) out.push({ kind: "overdue_milestone", title: m.title, due: m.due_date });
    const unassigned = i.tasks.filter((t) => !t.is_archived && !t.owner && (t.status === "todo" || t.status === "in_progress")).length;
    if (unassigned) out.push({ kind: "unassigned_tasks", count: unassigned });
    for (const v of i.overCapacityVendors ?? []) out.push({ kind: "over_capacity", vendor: v });
  }
  if (i.margin.status === "negative") out.push({ kind: "negative_margin", marginMinor: i.margin.margin });
  else if (i.margin.status === "at_risk") out.push({ kind: "at_risk_margin", pct: i.margin.pct });
  return out;
}

/* ---------- templates when a deal has no accepted quote ---------- */

export interface DeliveryTemplate { milestones: [string, number][]; checklist: string[]; founderHours: number; termMonths: number | null }
/** Starting points, editable on the project. Hours are estimates entered by the founders later, not facts. */
export const DELIVERY_TEMPLATES: Record<"consulting" | "local" | "thirty", DeliveryTemplate> = {
  consulting: {
    milestones: [["Kick-off", 3], ["Diagnostic shared", 14], ["Solution delivered", 35], ["Handover and training", 45]],
    checklist: ["Kick-off meeting held", "Access and data received", "Diagnostic shared with the client", "Solution delivered and tested", "Client team trained", "Success criteria reviewed with the client"],
    founderHours: 20, termMonths: null,
  },
  local: {
    milestones: [["Setup", 7], ["Go-live", 14], ["First monthly review", 45]],
    checklist: ["Request capture configured", "Owner notifications tested", "Follow-up and feedback messages set", "Owner trained", "Plan limits explained to the client"],
    founderHours: 4, termMonths: 12,
  },
  thirty: {
    milestones: [["Shortlist delivered", 7]],
    checklist: ["Questionnaire answers received", "Shortlist sent"],
    founderHours: 1, termMonths: null,
  },
};

export function templateMilestones(brand: keyof typeof DELIVERY_TEMPLATES, start: string): { title: string; due_date: string }[] {
  return DELIVERY_TEMPLATES[brand].milestones.map(([title, d]) => ({ title, due_date: addDays(start, d) }));
}

/* ---------- Valemont Local subscriptions ---------- */

export const LOCAL_METRICS = ["conversations", "qualified_requests", "automated_emails", "support_minutes", "locations"] as const;
export type LocalMetric = (typeof LOCAL_METRICS)[number];
export const LOCAL_METRIC_LABELS: Record<LocalMetric, string> = { conversations: "AI conversations", qualified_requests: "Qualified requests", automated_emails: "Automated emails", support_minutes: "Support minutes", locations: "Locations" };
/** Local Essential plan limits per month (spec 2.5 seeds, editable: setting `local_plan_limits`). */
export const LOCAL_PLAN_LIMITS_SEED: Record<LocalMetric, number> = { conversations: 200, qualified_requests: 100, automated_emails: 200, support_minutes: 30, locations: 1 };

export interface Provision { key: string; label: string; minor: number }
/** Cost provisions per client per month (spec 2.5 seeds, total 37 €; editable: setting `local_cost_provisions`). Provisions, not actuals. */
export const LOCAL_PROVISIONS_SEED: { lines: Provision[]; supportRateMinorPerHour: number } = {
  lines: [
    { key: "hosting", label: "Hosting and domain share", minor: 300 },
    { key: "ai_tokens", label: "AI tokens", minor: 200 },
    { key: "email", label: "Email, storage and notifications", minor: 300 },
    { key: "payment", label: "Payment fees", minor: 400 },
    { key: "monitoring", label: "Monitoring and tools share", minor: 500 },
  ],
  supportRateMinorPerHour: 4000,
};
export const provisionsTotal = (p: typeof LOCAL_PROVISIONS_SEED, includedSupportMinutes: number) =>
  p.lines.reduce((s, l) => s + l.minor, 0) + Math.round((includedSupportMinutes / 60) * p.supportRateMinorPerHour);

export type LimitLevel = "ok" | "warn" | "over";
/** Alert at 80 % and 100 % of any limit (spec 5.7). */
export function limitLevel(used: number, limit: number): LimitLevel {
  if (limit <= 0) return used > 0 ? "over" : "ok";
  if (used >= limit) return "over"; // 100 % reached
  if (used >= 0.8 * limit) return "warn"; // 80 %
  return "ok";
}

export interface LocalUsageLike { conversations: number; qualified_requests: number; automated_emails: number; support_minutes: number; locations: number; actual_cost_minor: number | null }

/**
 * Contribution margin of one Local client for one month: price − cost. Cost = the actual cost entered, else the provisions,
 * where support is valued at the real minutes (at least the included 30) × the support rate: support over 30 min is the
 * main margin risk, so it moves the margin directly.
 */
export function localMargin(u: LocalUsageLike, priceMinor: number, limits: Record<LocalMetric, number>, prov: typeof LOCAL_PROVISIONS_SEED) {
  const supportMinutes = Math.max(limits.support_minutes, u.support_minutes);
  const supportCost = Math.round((supportMinutes / 60) * prov.supportRateMinorPerHour);
  const provisioned = prov.lines.reduce((s, l) => s + l.minor, 0) + supportCost;
  const cost = u.actual_cost_minor ?? provisioned;
  const levels = Object.fromEntries(LOCAL_METRICS.map((m) => [m, limitLevel(u[m], limits[m])])) as Record<LocalMetric, LimitLevel>;
  const extraSupport = Math.max(0, u.support_minutes - limits.support_minutes);
  return {
    priceMinor, costMinor: cost, costBasis: u.actual_cost_minor === null ? ("provisions" as const) : ("actual" as const), provisionedMinor: provisioned,
    supportCostMinor: supportCost, extraSupportMinutes: extraSupport, extraSupportCostMinor: Math.round((extraSupport / 60) * prov.supportRateMinorPerHour),
    marginMinor: priceMinor - cost, marginPct: priceMinor > 0 ? Math.round(((priceMinor - cost) / priceMinor) * 1000) / 10 : null, levels,
  };
}

/** Parse a usage CSV: client,month,conversations,qualified_requests,automated_emails,support_minutes[,locations][,actual_cost_eur]. Headers in EN/FR/ES. */
export function parseLocalUsageCsv(csv: string): { rows: { client: string; month: string; values: Partial<Record<LocalMetric, number>>; actual_cost_minor: number | null }[]; errors: { line: number; reason: string }[] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: [] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/["']/g, ""));
  const find = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const col = {
    client: find("client", "cliente"), month: find("month", "mois", "mes"), conversations: find("conversations", "conversaciones"),
    qualified_requests: find("qualified", "demandes qualifiees", "solicitudes cualificadas"), automated_emails: find("automated", "emails", "e-mails", "correos"),
    support_minutes: find("support", "soporte"), locations: find("locations", "sites", "ubicaciones", "locales"), actual_cost: find("actual_cost", "cout reel", "coste real", "cost"),
  };
  const rows: ReturnType<typeof parseLocalUsageCsv>["rows"] = [];
  const errors: { line: number; reason: string }[] = [];
  if (col.client < 0 || col.month < 0) return { rows, errors: [{ line: 1, reason: "Missing client or month column" }] };
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const client = (cells[col.client] ?? "").slice(0, 200);
    const month = (cells[col.month] ?? "").slice(0, 7);
    if (!client || !/^\d{4}-\d{2}$/.test(month)) { errors.push({ line: i + 1, reason: "Client and month (YYYY-MM) are required" }); continue; }
    const values: Partial<Record<LocalMetric, number>> = {};
    let bad = false;
    for (const m of LOCAL_METRICS) {
      const idx = col[m];
      if (idx < 0 || cells[idx] === undefined || cells[idx] === "") continue;
      const n = Number(cells[idx].replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) { bad = true; break; }
      values[m] = Math.round(n);
    }
    if (bad) { errors.push({ line: i + 1, reason: "Numbers must be positive" }); continue; }
    let actual: number | null = null;
    if (col.actual_cost >= 0 && cells[col.actual_cost]) {
      const n = Number(cells[col.actual_cost].replace(",", "."));
      if (!Number.isFinite(n) || n < 0) { errors.push({ line: i + 1, reason: "Numbers must be positive" }); continue; }
      actual = Math.round(n * 100);
    }
    rows.push({ client, month, values, actual_cost_minor: actual });
  }
  return { rows, errors };
}
