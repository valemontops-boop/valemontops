import { z } from "zod";
import { BRANDS, type FounderKey } from "@/domain/constants";
import { DELIVERABLES, PUBLISHING_CALENDAR, contentProgress, postsFor } from "@/domain/content";
import { addDays, localDate, startOfWeek, weekday } from "@/domain/time";
import type { AppContext } from "../context";
import { userRow } from "./common";

export async function marketingWeek(ctx: AppContext, founder: FounderKey, now = new Date()) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(now, u.timezone);
  const week = startOfWeek(today);
  const t = await ctx.repo.listMany(["ContentLog"]);
  const seen = new Map<string, (typeof t.ContentLog.rows)[number]>();
  for (const l of [...t.ContentLog.rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) if (!seen.has(l.idempotency_key) && !l.is_archived) seen.set(l.idempotency_key, l);
  const logs = [...seen.values()];
  return {
    weekStart: week,
    /** Weekly content goals (iteration 8): 3 video concepts, Reels FR/ES per brand. */
    items: contentProgress(logs, week, addDays(week, 6)),
    /** Today's planned posts from the weekday calendar, marked done when logged today. */
    todayPosts: postsFor(logs, today, weekday(today)),
    calendar: [1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, posts: PUBLISHING_CALENDAR.filter((s) => s.weekday === d).map((s) => s.label) })),
    recent: logs.filter((l) => l.local_date >= week).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10)
      .map((l) => ({ id: l.id, deliverable: l.deliverable, title: l.deliverable === "personal_post" && l.founder_key !== founder ? "" : l.title, founder: l.founder_key, local_date: l.local_date, language: l.language })),
  };
}

export const contentLogSchema = z.object({
  idempotency_key: z.string().uuid(),
  deliverable: z.enum(DELIVERABLES),
  brand: z.enum(BRANDS).nullable().default(null),
  language: z.enum(["FR", "ES"]).nullable().default(null),
  title: z.string().trim().max(200).default(""),
  url: z.string().trim().max(500).default(""),
});

/** "Log published content": one tap; personal posts are never tagged with a brand (spec 2.3). */
export async function logContent(ctx: AppContext, founder: FounderKey, input: z.infer<typeof contentLogSchema>) {
  const { rows } = await ctx.repo.list("ContentLog", { fresh: true });
  const dup = rows.find((r) => r.idempotency_key === input.idempotency_key);
  if (dup) return { duplicate: true, id: dup.id };
  const u = await userRow(ctx.repo, founder);
  const [row] = await ctx.repo.insert("ContentLog", [{ id: crypto.randomUUID(), ...input, brand: input.deliverable === "personal_post" ? null : input.brand, founder_key: founder, local_date: localDate(new Date(), u.timezone) }], { founder });
  return { duplicate: false, id: row.id };
}
