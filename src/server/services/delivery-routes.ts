import { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import type { AppContext } from "../context";
import {
  addCost, costLinkSchema, linkCost, addMilestone, addProjectTask, addTimeEntry, assignContractor, assignmentUpdateSchema, assignSchema, clientUpdateSchema, costSchema, deliveryOverview,
  milestoneSchema, milestoneUpdateSchema, projectTaskSchema, timeEntrySchema, updateAssignment, updateClient, updateMilestone, updateProject, updateProjectSchema,
  wonSchema, wonStatus, wonToProject,
} from "./delivery";
import { importUsageCsv, localOverview, localOverviewSchema, planSchema, savePlan, saveUsage, usageCsvSchema, usageSchema } from "./local-subscriptions";
import {
  agentCreateSchema, agentUpdateSchema, createAgent, createTool, createVendor, partnersOverview, toolCreateSchema, toolUpdateSchema, updateAgent, updateTool,
  updateVendor, vendorCreateSchema, vendorUpdateSchema,
} from "./partners";

type Handler = (ctx: AppContext, founder: FounderKey, input: never) => Promise<unknown>;
/**
 * Clients & delivery API (Stage 2B), one table shared by the Next route handlers (src/app/api/clients/**, through route():
 * session, same-origin, Zod) and the browser preview's mock fetch.
 */
export const DELIVERY_ROUTES: Record<string, [z.ZodTypeAny | null, Handler]> = {
  "GET /api/clients": [null, (c, f) => deliveryOverview(c, f)],
  "PATCH /api/clients": [clientUpdateSchema, (c, f, i) => updateClient(c, f, i)],
  "GET /api/clients/won": [z.object({ opportunity_id: z.string().uuid() }), (c, _f, i: { opportunity_id: string }) => wonStatus(c, i.opportunity_id)],
  "POST /api/clients/won": [wonSchema, (c, f, i) => wonToProject(c, f, i)],
  "PATCH /api/clients/projects": [updateProjectSchema, (c, f, i) => updateProject(c, f, i)],
  "POST /api/clients/milestones": [milestoneSchema, (c, f, i) => addMilestone(c, f, i)],
  "PATCH /api/clients/milestones": [milestoneUpdateSchema, (c, f, i) => updateMilestone(c, f, i)],
  "POST /api/clients/time": [timeEntrySchema, (c, f, i) => addTimeEntry(c, f, i)],
  "POST /api/clients/costs": [costSchema, (c, f, i) => addCost(c, f, i)],
  "PATCH /api/clients/costs": [costLinkSchema, (c, f, i) => linkCost(c, f, i)],
  "POST /api/clients/assignments": [assignSchema, (c, f, i) => assignContractor(c, f, i)],
  "PATCH /api/clients/assignments": [assignmentUpdateSchema, (c, f, i) => updateAssignment(c, f, i)],
  "POST /api/clients/tasks": [projectTaskSchema, (c, f, i) => addProjectTask(c, f, i)],
  "GET /api/clients/partners": [null, (c, f) => partnersOverview(c, f)],
  "POST /api/clients/vendors": [vendorCreateSchema, (c, f, i) => createVendor(c, f, i)],
  "PATCH /api/clients/vendors": [vendorUpdateSchema, (c, f, i) => updateVendor(c, f, i)],
  "POST /api/clients/tools": [toolCreateSchema, (c, f, i) => createTool(c, f, i)],
  "PATCH /api/clients/tools": [toolUpdateSchema, (c, f, i) => updateTool(c, f, i)],
  "POST /api/clients/agents": [agentCreateSchema, (c, f, i) => createAgent(c, f, i)],
  "PATCH /api/clients/agents": [agentUpdateSchema, (c, f, i) => updateAgent(c, f, i)],
  "GET /api/clients/local": [localOverviewSchema, (c, f, i: { month?: string }) => localOverview(c, f, i.month)],
  "PUT /api/clients/local": [usageSchema, (c, f, i) => saveUsage(c, f, i)],
  "POST /api/clients/local": [usageCsvSchema, (c, f, i) => importUsageCsv(c, f, i)],
  "POST /api/clients/local/plan": [planSchema, (c, f, i) => savePlan(c, f, i)],
};
