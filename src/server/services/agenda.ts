import { z } from "zod";
import type { Row } from "@/data/repository";
import { StorageError } from "@/data/repository";
import { calendarEventId, childId, newId } from "@/lib/ids";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { findMutualSlots } from "@/domain/slots";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { settingValue, userRow } from "./common";
import { createTask } from "./tasks";

export interface AgendaEvent {
  id: string;
  calendarId: string;
  kind: "shared" | "own" | "other_busy";
  owner: string | null;
  title: string; // "Busy" for the other founder's personal calendar, always
  start: string;
  end: string;
  link: string | null;
  pointId: string | null;
}

async function recordStatus(ctx: AppContext, integration: string, ok: boolean, error = "") {
  const id = childId("integration", integration);
  const cur = await ctx.repo.get("IntegrationStatuses", id).catch(() => null);
  const next = { integration, status: ok ? "ok" : "error", last_success_at: ok ? new Date().toISOString() : cur?.last_success_at ?? null, last_error: ok ? "" : error.slice(0, 500) };
  if (cur && cur.status === next.status && ok) return; // avoid a write per read when nothing changed
  try {
    if (cur) await ctx.repo.update("IntegrationStatuses", id, cur.version, next, { founder: "system" });
    else await ctx.repo.insert("IntegrationStatuses", [{ id, ...next }], { founder: "system" });
  } catch {
    /* status is best-effort */
  }
}

/**
 * Merged agenda (spec 5.12). Privacy by construction: the other founder's personal calendar is read
 * with free/busy only, so no title, description or location of theirs ever reaches this response.
 */
export async function upcomingEvents(ctx: AppContext, viewer: FounderKey, now = new Date(), days = 14): Promise<{ available: boolean; events: AgendaEvent[]; error: string | null }> {
  if (!ctx.calendar) return { available: false, events: [], error: null };
  const sources = (await ctx.repo.list("CalendarSources")).rows.filter((s) => !s.is_archived);
  if (!sources.length) return { available: false, events: [], error: null };
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + days * 86_400_000).toISOString();
  const links = (await ctx.repo.list("CalendarLinks")).rows;
  const out: AgendaEvent[] = [];
  try {
    for (const s of sources) {
      const mine = s.kind === "personal" && s.owner_founder === viewer;
      if (s.kind === "shared" || (mine && s.access === "details")) {
        for (const e of await ctx.calendar.listEvents(s.calendar_id, timeMin, timeMax)) {
          const link = links.find((l) => l.calendar_id === s.calendar_id && l.event_id === e.id && l.record_type === "founder_point");
          out.push({ id: e.id, calendarId: s.calendar_id, kind: s.kind === "shared" ? "shared" : "own", owner: s.owner_founder, title: e.title, start: e.start, end: e.end, link: e.htmlLink || null, pointId: link?.record_id ?? null });
        }
      } else {
        const fb = await ctx.calendar.freeBusy([s.calendar_id], timeMin, timeMax);
        for (const [i, b] of (fb[s.calendar_id] ?? []).entries()) out.push({ id: `busy-${s.id}-${i}`, calendarId: s.calendar_id, kind: mine ? "own" : "other_busy", owner: s.owner_founder, title: "Busy", start: b.start, end: b.end, link: null, pointId: null });
      }
    }
    await recordStatus(ctx, "Google Calendar", true);
  } catch (e) {
    await recordStatus(ctx, "Google Calendar", false, (e as Error).message);
    return { available: true, events: [], error: (e as Error).message };
  }
  return { available: true, events: out.sort((a, b) => a.start.localeCompare(b.start)), error: null };
}

export const sourceSchema = z.object({
  calendar_id: z.string().trim().min(3).max(300),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["shared", "personal"]),
  owner_founder: z.enum(FOUNDERS).nullable().default(null),
  access: z.enum(["free_busy", "details"]).default("free_busy"),
});
export async function addCalendarSource(ctx: AppContext, founder: FounderKey, input: z.infer<typeof sourceSchema>) {
  if (input.kind === "personal" && !input.owner_founder) throw new RuleError("A personal calendar needs its owner.");
  if (input.kind === "personal" && input.owner_founder !== founder) throw new RuleError("Each founder adds their own personal calendar.");
  const id = childId("calsource", input.calendar_id);
  if (await ctx.repo.get("CalendarSources", id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("CalendarSources", [{ id, ...input, owner_founder: input.kind === "shared" ? null : input.owner_founder }], { founder });
  return { duplicate: false };
}
export async function listCalendarSources(ctx: AppContext) {
  return (await ctx.repo.list("CalendarSources")).rows.filter((s) => !s.is_archived);
}
export async function removeCalendarSource(ctx: AppContext, founder: FounderKey, id: string, version: number) {
  return ctx.repo.update("CalendarSources", id, version, { is_archived: true }, { founder });
}

/* ---------------- Founder Points ---------------- */

async function sharedCalendarId(ctx: AppContext) {
  const s = (await listCalendarSources(ctx)).find((x) => x.kind === "shared");
  if (!s) throw new RuleError("Add the shared Valemont calendar in Settings › Calendars first.");
  return s.calendar_id;
}

export const slotsSchema = z.object({ duration_min: z.coerce.number().int().min(15).max(240).default(30) });
/** Three slots free for both founders inside their declared availability (spec 5.12). */
export async function proposeSlots(ctx: AppContext, durationMin: number, now = new Date()) {
  if (!ctx.calendar) throw new RuleError("Google Calendar is not configured.");
  const sources = await listCalendarSources(ctx);
  if (!sources.some((s) => s.kind === "shared")) throw new RuleError("Add the shared Valemont calendar in Settings › Calendars first.");
  const from = new Date(now.getTime() + 60 * 60_000);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const fb = await ctx.calendar.freeBusy(sources.map((s) => s.calendar_id), from.toISOString(), to.toISOString());
  const busy = Object.values(fb).flat().map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  const founders = await Promise.all(FOUNDERS.map((f) => userRow(ctx.repo, f)));
  return findMutualSlots({
    busy, from, days: 7, durationMin, count: 3,
    founders: founders.map((u) => ({ tz: u.timezone, workdays: u.workdays, availStart: u.avail_start || "09:00", availEnd: u.avail_end || "18:00" })),
  }).map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() }));
}

export const pointSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  type: z.enum(["daily", "weekly_review", "decision", "ad_hoc"]),
  duration_min: z.number().int().min(15).max(240),
  start: z.string().datetime({ offset: true }),
  recurrence: z.enum(["daily", "weekly"]).nullable().default(null),
  agenda: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

/**
 * One click writes the event to the shared calendar (no attendees: the shared calendar is what puts it
 * in front of both founders). The event id derives from the point id, so a retry creates no duplicate.
 */
export async function schedulePoint(ctx: AppContext, founder: FounderKey, input: z.infer<typeof pointSchema>) {
  if (!ctx.calendar) throw new RuleError("Google Calendar is not configured.");
  const calendarId = await sharedCalendarId(ctx);
  const eventId = calendarEventId("founder-point", input.id);
  const end = new Date(new Date(input.start).getTime() + input.duration_min * 60_000).toISOString();
  const video = (await settingValue(ctx.repo, "founder_point_video_link")) ?? "";
  const description = [`Founder point (${input.type.replace("_", " ")}).`, `Open in Valemont OS: ${ctx.baseUrl}/agenda`, video ? `Video: ${video}` : ""].filter(Boolean).join("\n");
  let created;
  try {
    created = await ctx.calendar.insertEvent(calendarId, {
      id: eventId, title: `Founder point: ${input.title}`, description, start: new Date(input.start).toISOString(), end,
      ...(input.recurrence ? { recurrence: [`RRULE:FREQ=${input.recurrence === "daily" ? "DAILY" : "WEEKLY"}`] } : {}),
    });
    await recordStatus(ctx, "Google Calendar", true);
  } catch (e) {
    await recordStatus(ctx, "Google Calendar", false, (e as Error).message);
    throw e instanceof StorageError ? e : new StorageError((e as Error).message);
  }
  const existing = await ctx.repo.get("FounderPoints", input.id, { fresh: true });
  if (!existing) {
    await ctx.repo.insert("FounderPoints", [{ id: input.id, title: input.title, type: input.type, duration_min: input.duration_min, status: "scheduled", start_at: created.event.start, calendar_event_id: eventId, recurrence: input.recurrence, notes: "" }], { founder });
    await ctx.repo.insert("CalendarLinks", [{ id: childId("calink", input.id), calendar_id: calendarId, event_id: eventId, record_type: "founder_point", record_id: input.id }], { founder });
    // Ideas marked "Discuss" are added to the agenda automatically (spec 5.12).
    const discuss = (await ctx.repo.list("Ideas")).rows.filter((i) => i.status === "discuss" && !i.is_archived);
    const items = [
      ...input.agenda.map((text, i) => ({ id: childId(input.id, "agenda", String(i)), point_id: input.id, kind: "agenda" as const, text, done: false, owner: null, task_id: "", idea_id: "" })),
      ...discuss.map((idea) => ({ id: childId(input.id, "idea", idea.id), point_id: input.id, kind: "agenda" as const, text: `Idea: ${idea.text}`, done: false, owner: null, task_id: "", idea_id: idea.id })),
    ];
    if (items.length) await ctx.repo.insert("FounderPointItems", items, { founder });
  }
  return { pointId: input.id, eventId, created: created.created };
}

/** Changes made directly in Google Calendar win after the next sync (spec 4.13). */
export async function listPoints(ctx: AppContext) {
  const t = await ctx.repo.listMany(["FounderPoints", "FounderPointItems", "CalendarLinks"]);
  const points = t.FounderPoints.rows.filter((p) => !p.is_archived).sort((a, b) => (b.start_at ?? "").localeCompare(a.start_at ?? ""));
  if (ctx.calendar) {
    for (const p of points.filter((p) => p.status === "scheduled" || p.status === "moved_in_calendar")) {
      const link = t.CalendarLinks.rows.find((l) => l.record_type === "founder_point" && l.record_id === p.id);
      if (!link) continue;
      try {
        const ev = await ctx.calendar.getEvent(link.calendar_id, link.event_id);
        if (!ev || ev.status === "cancelled") {
          Object.assign(p, await ctx.repo.update("FounderPoints", p.id, p.version, { status: "deleted_in_calendar" }, { founder: "system" }));
        } else if (ev.start !== p.start_at) {
          Object.assign(p, await ctx.repo.update("FounderPoints", p.id, p.version, { start_at: ev.start, duration_min: Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60_000), status: "moved_in_calendar" }, { founder: "system" }));
        }
      } catch {
        /* keep the last known state; Integrations shows the error */
      }
    }
  }
  return points.map((p) => ({ ...p, items: t.FounderPointItems.rows.filter((i) => i.point_id === p.id && !i.is_archived).sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
}

export const pointItemSchema = z.object({ id: z.string().uuid(), point_id: z.string().uuid(), kind: z.enum(["agenda", "decision", "action"]), text: z.string().trim().min(1).max(500), owner: z.enum(FOUNDERS).nullable().default(null), due_at: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default("") });

/** Action items become Tasks with an owner; decisions show in the weekly review. */
export async function addPointItem(ctx: AppContext, founder: FounderKey, input: z.infer<typeof pointItemSchema>) {
  if (await ctx.repo.get("FounderPointItems", input.id, { fresh: true })) return { duplicate: true };
  let taskId = "";
  if (input.kind === "action") {
    taskId = childId(input.id, "task");
    await createTask(ctx, founder, { id: taskId, task: { title: input.text, description: "From a founder point", owner: input.owner, priority: "P1", due_at: input.due_at, estimated_minutes: null, recurrence: "none", account_id: "", opportunity_id: "", dependency_ids: [], private: false, area: "ops" }, source: "founder_point", source_id: input.point_id });
  }
  await ctx.repo.insert("FounderPointItems", [{ id: input.id, point_id: input.point_id, kind: input.kind, text: input.text, done: false, owner: input.owner, task_id: taskId, idea_id: "" }], { founder });
  return { duplicate: false, taskId };
}

export const pointUpdateSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), status: z.enum(["scheduled", "done", "cancelled"]).optional(), notes: z.string().trim().max(4_000).optional() });
export async function updatePoint(ctx: AppContext, founder: FounderKey, input: z.infer<typeof pointUpdateSchema>) {
  const { id, expected_version, ...patch } = input;
  return ctx.repo.update("FounderPoints", id, expected_version, patch as Partial<Row<"FounderPoints">>, { founder });
}
export const itemToggleSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), done: z.boolean() });
export async function toggleItem(ctx: AppContext, founder: FounderKey, input: z.infer<typeof itemToggleSchema>) {
  return ctx.repo.update("FounderPointItems", input.id, input.expected_version, { done: input.done }, { founder });
}

export { newId };
