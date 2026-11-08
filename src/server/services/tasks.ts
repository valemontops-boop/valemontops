import { z } from "zod";
import type { NewRow, Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { filterTasks, nextDue, type TaskView } from "@/domain/tasks";
import { localDate } from "@/domain/time";
import { ForbiddenError, RuleError } from "../errors";
import type { AppContext } from "../context";
import { patchOf } from "@/lib/zod";
import { userRow } from "./common";

export type TaskRow = Row<"Tasks"> & { private: boolean };

const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default("");
export const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4_000).default(""),
  owner: z.enum(FOUNDERS).nullable().default(null),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  due_at: day,
  estimated_minutes: z.number().int().min(0).max(2_400).nullable().default(null),
  recurrence: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]).default("none"),
  account_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  opportunity_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  dependency_ids: z.array(z.string().uuid()).max(20).default([]),
  private: z.boolean().default(false),
  area: z.enum(["sales", "marketing", "ops"]).optional(),
});
export const createTaskSchema = z.object({ id: z.string().uuid(), task: taskInput, source: z.enum(["manual", "founder_point", "idea"]).default("manual"), source_id: z.string().max(40).default("") });

function toNew(id: string, founder: FounderKey, t: z.infer<typeof taskInput>, source: string, sourceId: string): NewRow<"Tasks"> {
  return {
    id, title: t.title, description: t.description, owner: t.private ? founder : t.owner, created_by_founder: founder, account_id: t.account_id,
    opportunity_id: t.opportunity_id, project_id: "", client_id: "", priority: t.priority, status: "todo", estimated_minutes: t.estimated_minutes,
    due_at: t.due_at || null, recurrence: t.recurrence, recurrence_parent_id: "", dependency_ids: t.dependency_ids, completion_evidence: "",
    completed_at: null, visibility: t.private ? "private" : "team", snoozed_until: null, snooze_reason: "", area: t.area ?? "sales", source: source as never, source_id: sourceId,
  };
}

/** Private tasks live in the founder's own spreadsheet, never in the shared Sheet (spec 4.7). */
function privateTable(ctx: AppContext, founder: string) {
  const r = ctx.privateRepo(founder);
  if (!r) throw new RuleError("Private tasks need your private spreadsheet. Set PRIVATE_SHEET_ID for your account (see README).");
  return r;
}

export async function createTask(ctx: AppContext, founder: FounderKey, input: z.infer<typeof createTaskSchema>) {
  const row = toNew(input.id, founder, input.task, input.source, input.source_id);
  if (input.task.private) {
    const r = privateTable(ctx, founder);
    if (await r.get("PrivateTasks", input.id, { fresh: true })) return { id: input.id, duplicate: true };
    await r.insert("PrivateTasks", [row as never], { founder });
  } else {
    if (await ctx.repo.get("Tasks", input.id, { fresh: true })) return { id: input.id, duplicate: true };
    await ctx.repo.insert("Tasks", [row], { founder });
  }
  return { id: input.id, duplicate: false };
}

export async function listTasks(ctx: AppContext, founder: FounderKey, view: TaskView = "all"): Promise<TaskRow[]> {
  const shared = (await ctx.repo.list("Tasks")).rows.filter((t) => !t.is_archived).map((t) => ({ ...t, private: false }));
  const own = ctx.privateRepo(founder);
  const priv = own ? (await own.list("PrivateTasks")).rows.filter((t) => !t.is_archived).map((t) => ({ ...(t as unknown as Row<"Tasks">), private: true })) : [];
  const u = await userRow(ctx.repo, founder);
  return filterTasks([...shared, ...priv], view, founder, localDate(new Date(), u.timezone));
}

export const updateTaskSchema = z.object({
  id: z.string().uuid(),
  private: z.boolean().default(false),
  expected_version: z.number().int(),
  patch: patchOf(taskInput.omit({ private: true })).extend({
    status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
    completion_evidence: z.string().trim().max(1_000).optional(),
    snoozed_until: day.optional(),
    snooze_reason: z.string().trim().max(300).optional(),
  }),
});

export async function updateTask(ctx: AppContext, founder: FounderKey, input: z.infer<typeof updateTaskSchema>) {
  const repo = input.private ? privateTable(ctx, founder) : ctx.repo;
  const table = (input.private ? "PrivateTasks" : "Tasks") as "Tasks";
  const cur = (await repo.get(table, input.id, { fresh: true })) as Row<"Tasks"> | null;
  if (!cur) throw new RuleError("Task not found");
  if (cur.visibility === "private" && cur.created_by_founder !== founder) throw new ForbiddenError("This task is private.");
  const { due_at, snoozed_until, ...rest } = input.patch;
  const patch: Partial<Row<"Tasks">> = { ...rest };
  if (due_at !== undefined) patch.due_at = due_at || null;
  if (snoozed_until !== undefined) {
    if (snoozed_until && !(input.patch.snooze_reason ?? "").trim()) throw new RuleError("Snoozing needs a reason.");
    patch.snoozed_until = snoozed_until || null;
  }
  if (input.patch.status === "done" && cur.status !== "done") {
    const open = (cur.dependency_ids ?? []).length ? (await ctx.repo.list("Tasks")).rows.filter((t) => cur.dependency_ids.includes(t.id) && t.status !== "done" && t.status !== "cancelled") : [];
    if (open.length) throw new RuleError(`Finish first: ${open.map((t) => t.title).join(", ")}`);
    patch.completed_at = new Date().toISOString();
  }
  if (input.patch.status && input.patch.status !== "done") patch.completed_at = null;
  const updated = await repo.update(table, input.id, input.expected_version, patch, { founder });
  // Recurring: completing creates the next instance once (deterministic id → retry-safe).
  if (input.patch.status === "done" && cur.status !== "done" && cur.recurrence !== "none" && cur.due_at) {
    const next = nextDue(cur.due_at, cur.recurrence);
    const id = childId(cur.id, "next", next ?? "");
    if (next && !(await repo.get(table, id, { fresh: true }))) {
      await repo.insert(table, [{ ...toNew(id, founder, { ...cur, private: cur.visibility === "private", due_at: next, estimated_minutes: cur.estimated_minutes, dependency_ids: [] } as never, cur.source, cur.source_id), created_by_founder: cur.created_by_founder, owner: cur.owner, recurrence_parent_id: cur.recurrence_parent_id || cur.id }], { founder });
    }
  }
  return updated;
}

export const commentSchema = z.object({ id: z.string().uuid(), task_id: z.string().uuid(), body: z.string().trim().min(1).max(2_000) });
export async function addComment(ctx: AppContext, founder: FounderKey, input: z.infer<typeof commentSchema>) {
  if (!(await ctx.repo.get("Tasks", input.task_id))) throw new RuleError("Comments are available on team tasks.");
  if (await ctx.repo.get("TaskComments", input.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("TaskComments", [{ id: input.id, task_id: input.task_id, author: founder, body: input.body }], { founder });
  return { duplicate: false };
}
export async function listComments(ctx: AppContext, taskId: string) {
  return (await ctx.repo.list("TaskComments")).rows.filter((c) => c.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
