import { addDays, weekday } from "./time";

export type Recurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";

/** Due date of the next instance of a recurring task (created when the current one is completed). */
export function nextDue(due: string, r: Recurrence): string | null {
  if (r === "none") return null;
  if (r === "daily") return addDays(due, 1);
  if (r === "weekly") return addDays(due, 7);
  if (r === "weekdays") {
    let d = addDays(due, 1);
    while ([0, 6].includes(weekday(d))) d = addDays(d, 1);
    return d;
  }
  const [y, m, dd] = due.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(dd, last))).toISOString().slice(0, 10);
}

export interface TaskLike { owner: string | null; status: string; due_at: string | null; snoozed_until: string | null; visibility: string; created_by_founder: string; priority: string }
export type TaskView = "mine" | "theo" | "pablo" | "unassigned" | "overdue" | "all";

export const isOpenTask = (t: TaskLike) => t.status === "todo" || t.status === "in_progress";
export const isOverdue = (t: TaskLike, today: string) => isOpenTask(t) && !!t.due_at && t.due_at < today;

/** Private tasks are never visible to the other founder (spec 8.4 Access). */
export function visibleTo(t: TaskLike, founder: string) {
  return t.visibility !== "private" || t.created_by_founder === founder || t.owner === founder;
}

export function filterTasks<T extends TaskLike>(tasks: T[], view: TaskView, founder: string, today: string): T[] {
  return tasks
    .filter((t) => visibleTo(t, founder))
    .filter((t) =>
      view === "mine" ? t.owner === founder : view === "theo" ? t.owner === "theo" : view === "pablo" ? t.owner === "pablo" : view === "unassigned" ? !t.owner : view === "overdue" ? isOverdue(t, today) : true,
    )
    .sort((a, b) => Number(isOpenTask(b)) - Number(isOpenTask(a)) || a.priority.localeCompare(b.priority) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
}

/** Tasks to show in My Day: open, mine, due today or overdue (or undated P0), not snoozed past today. */
export function todaysTasks<T extends TaskLike>(tasks: T[], founder: string, today: string): T[] {
  return filterTasks(tasks, "mine", founder, today).filter(
    (t) => isOpenTask(t) && (!t.snoozed_until || t.snoozed_until <= today) && ((t.due_at && t.due_at <= today) || (!t.due_at && t.priority === "P0")),
  );
}
