import { z } from "zod";
import type { Row } from "@/data/repository";
import { BANK_CATEGORIES } from "@/domain/bank";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { capacityCheck } from "@/domain/delivery";
import { localDate } from "@/domain/time";
import { patchOf } from "@/lib/zod";
import type { AppContext } from "../context";
import { userRow } from "./common";

/**
 * Three separate registries (spec 5.8), never mixed: (a) human contractors and suppliers (`Vendors`), (b) software / AI
 * tools and providers (`ToolCosts`), (c) internal agent / workflow templates (`AgentTemplates`). Rates are inputs.
 */
export async function partnersOverview(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const t = await ctx.repo.listMany(["Vendors", "ToolCosts", "AgentTemplates", "ProjectAssignments", "Projects"]);
  const today = localDate(now, (await userRow(ctx.repo, founder)).timezone);
  const projects = t.Projects.rows.filter((p) => !p.is_archived);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const assignments = t.ProjectAssignments.rows.filter((a) => !a.is_archived);
  const vendors = t.Vendors.rows.filter((v) => !v.is_archived).map((v) => {
    const mine = assignments.filter((a) => a.vendor_id === v.id);
    const cap = capacityCheck(v.capacity_hours_week, mine);
    return {
      ...v, load: cap, freeHoursWeek: Math.max(0, Math.round((v.capacity_hours_week - cap.plannedPerWeek) * 10) / 10),
      rateExpired: Boolean(v.rate_valid_until && v.rate_valid_until < today),
      projects: [...new Set(mine.filter((a) => a.status !== "cancelled").map((a) => projectName.get(a.project_id) ?? ""))].filter(Boolean),
    };
  });
  const tools = t.ToolCosts.rows.filter((x) => !x.is_archived).map((x) => ({ ...x, projects: x.linked_project_ids.map((id) => projectName.get(id)).filter(Boolean) as string[] }));
  const agents = t.AgentTemplates.rows.filter((x) => !x.is_archived).map((x) => ({ ...x, projects: x.linked_project_ids.map((id) => projectName.get(id)).filter(Boolean) as string[], tools: x.linked_tool_ids.map((id) => tools.find((y) => y.id === id)?.name).filter(Boolean) as string[] }));
  return {
    today, vendors, tools, agents,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    toolsMonthlyMinor: tools.filter((x) => x.integration_status !== "retired" && x.currency === "EUR").reduce((s, x) => s + x.monthly_cost_minor, 0),
  };
}

const optDay = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const eur = z.number().min(0).max(1_000_000).nullable();
const cents = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));

const vendorInput = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).default(""),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  services: z.string().trim().max(1_000).default(""),
  timezone: z.string().trim().max(60).default(""),
  country: z.string().trim().toUpperCase().max(2).default(""),
  currency: z.string().trim().toUpperCase().length(3).default("EUR"),
  hourly_rate_eur: eur.default(null),
  daily_rate_eur: eur.default(null),
  fixed_rate_eur: eur.default(null),
  capacity_hours_week: z.number().int().min(0).max(80).default(0),
  availability: z.enum(["available", "limited", "unavailable"]).default("available"),
  response_sla_hours: z.number().int().min(0).max(720).nullable().default(null),
  nda_status: z.enum(["none", "sent", "signed"]).default("none"),
  contract_status: z.enum(["none", "draft", "signed"]).default("none"),
  rate_valid_until: optDay.default(""),
  contact_email: z.union([z.literal(""), z.string().trim().email().max(200)]).default(""),
  contact_phone: z.string().trim().max(40).default(""),
  notes: z.string().trim().max(2_000).default(""),
  quality_feedback: z.string().trim().max(2_000).default(""),
});
function vendorRow(v: Partial<z.infer<typeof vendorInput>>): Partial<Row<"Vendors">> {
  const { hourly_rate_eur, daily_rate_eur, fixed_rate_eur, rate_valid_until, ...rest } = v;
  const out: Partial<Row<"Vendors">> = { ...rest };
  if (hourly_rate_eur !== undefined) out.hourly_rate_minor = cents(hourly_rate_eur);
  if (daily_rate_eur !== undefined) out.daily_rate_minor = cents(daily_rate_eur);
  if (fixed_rate_eur !== undefined) out.fixed_rate_minor = cents(fixed_rate_eur);
  if (rate_valid_until !== undefined) out.rate_valid_until = rate_valid_until || null;
  return out;
}
export const vendorCreateSchema = z.object({ id: z.string().uuid(), vendor: vendorInput });
export async function createVendor(ctx: AppContext, founder: FounderKey, i: z.infer<typeof vendorCreateSchema>) {
  if (await ctx.repo.get("Vendors", i.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("Vendors", [{ id: i.id, ...(vendorRow(i.vendor) as Omit<Row<"Vendors">, "id">) }], { founder });
  return { duplicate: false };
}
export const vendorUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: patchOf(vendorInput).extend({ archived: z.boolean().optional() }) });
export async function updateVendor(ctx: AppContext, founder: FounderKey, i: z.infer<typeof vendorUpdateSchema>) {
  const { archived, ...rest } = i.patch;
  return ctx.repo.update("Vendors", i.id, i.expected_version, { ...vendorRow(rest), ...(archived !== undefined ? { is_archived: archived } : {}) }, { founder });
}

const toolInput = z.object({
  name: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).default(""),
  use_case: z.string().trim().max(500).default(""),
  apis: z.string().trim().max(500).default(""),
  integration_status: z.enum(["planned", "testing", "live", "retired"]).default("planned"),
  monthly_cost_eur: z.number().min(0).max(1_000_000).default(0),
  currency: z.string().trim().toUpperCase().length(3).default("EUR"),
  usage_limits: z.string().trim().max(500).default(""),
  pricing_version: z.string().trim().max(120).default(""),
  pricing_date: optDay.default(""),
  owner_founder: z.enum(FOUNDERS).nullable().default(null),
  environment: z.enum(["production", "test", "both"]).default("production"),
  linked_project_ids: z.array(z.string().uuid()).max(50).default([]),
  risk_notes: z.string().trim().max(1_000).default(""),
  expense_category: z.enum(BANK_CATEGORIES).default("software"),
});
function toolRow(v: Partial<z.infer<typeof toolInput>>): Partial<Row<"ToolCosts">> {
  const { monthly_cost_eur, pricing_date, ...rest } = v;
  return { ...rest, ...(monthly_cost_eur !== undefined ? { monthly_cost_minor: Math.round(monthly_cost_eur * 100) } : {}), ...(pricing_date !== undefined ? { pricing_date: pricing_date || null } : {}) };
}
export const toolCreateSchema = z.object({ id: z.string().uuid(), tool: toolInput });
export async function createTool(ctx: AppContext, founder: FounderKey, i: z.infer<typeof toolCreateSchema>) {
  if (await ctx.repo.get("ToolCosts", i.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("ToolCosts", [{ id: i.id, ...(toolRow(i.tool) as Omit<Row<"ToolCosts">, "id">) }], { founder });
  return { duplicate: false };
}
export const toolUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: patchOf(toolInput).extend({ archived: z.boolean().optional() }) });
export async function updateTool(ctx: AppContext, founder: FounderKey, i: z.infer<typeof toolUpdateSchema>) {
  const { archived, ...rest } = i.patch;
  return ctx.repo.update("ToolCosts", i.id, i.expected_version, { ...toolRow(rest), ...(archived !== undefined ? { is_archived: archived } : {}) }, { founder });
}

const agentInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(["agent", "workflow"]).default("workflow"),
  purpose: z.string().trim().max(1_000).default(""),
  stack: z.string().trim().max(500).default(""),
  inputs: z.string().trim().max(500).default(""),
  outputs: z.string().trim().max(500).default(""),
  linked_tool_ids: z.array(z.string().uuid()).max(30).default([]),
  linked_project_ids: z.array(z.string().uuid()).max(50).default([]),
  owner_founder: z.enum(FOUNDERS).nullable().default(null),
  status: z.enum(["draft", "tested", "in_use", "retired"]).default("draft"),
  notes: z.string().trim().max(2_000).default(""),
});
export const agentCreateSchema = z.object({ id: z.string().uuid(), agent: agentInput });
export async function createAgent(ctx: AppContext, founder: FounderKey, i: z.infer<typeof agentCreateSchema>) {
  if (await ctx.repo.get("AgentTemplates", i.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("AgentTemplates", [{ id: i.id, ...i.agent }], { founder });
  return { duplicate: false };
}
export const agentUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), patch: patchOf(agentInput).extend({ archived: z.boolean().optional() }) });
export async function updateAgent(ctx: AppContext, founder: FounderKey, i: z.infer<typeof agentUpdateSchema>) {
  const { archived, ...rest } = i.patch;
  return ctx.repo.update("AgentTemplates", i.id, i.expected_version, { ...rest, ...(archived !== undefined ? { is_archived: archived } : {}) }, { founder });
}
