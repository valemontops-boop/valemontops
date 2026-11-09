import { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import type { AppContext } from "../context";
import {
  addEntry, allocationSchema, contractSchema, contractsFromProjects, contractUpdateSchema, createContract, entrySchema, financeOverview, generateSchedule,
  generateSchema, overviewSchema, reverseEntry, reverseSchema, saveAllocation, scheduleUpdateSchema, updateContract, updateScheduleLine,
} from "./finance";

type Handler = (ctx: AppContext, founder: FounderKey, input: never) => Promise<unknown>;
/**
 * Finance API (Stage 3, D078), one table shared by the Next route handlers (src/app/api/finance/**, through route():
 * session, same-origin, Zod) and the browser preview's mock fetch.
 */
export const FINANCE_ROUTES: Record<string, [z.ZodTypeAny | null, Handler]> = {
  "GET /api/finance": [overviewSchema, (c, f, i: { months?: number }) => financeOverview(c, f, i)],
  "PATCH /api/finance/allocation": [allocationSchema, (c, f, i) => saveAllocation(c, f, i)],
  "POST /api/finance/entries": [entrySchema, (c, f, i) => addEntry(c, f, i)],
  "POST /api/finance/entries/reverse": [reverseSchema, (c, f, i) => reverseEntry(c, f, i)],
  "POST /api/finance/contracts": [contractSchema, (c, f, i) => createContract(c, f, i)],
  "PATCH /api/finance/contracts": [contractUpdateSchema, (c, f, i) => updateContract(c, f, i)],
  "POST /api/finance/contracts/from-projects": [z.object({}).passthrough(), (c, f) => contractsFromProjects(c, f)],
  "POST /api/finance/schedules/generate": [generateSchema, (c, f, i) => generateSchedule(c, f, i)],
  "PATCH /api/finance/schedules": [scheduleUpdateSchema, (c, f, i) => updateScheduleLine(c, f, i)],
};
