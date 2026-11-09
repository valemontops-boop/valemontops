import type { NewRow, Row } from "@/data/repository";
import type { IgMedia, InstagramAccount } from "@/data/instagram/graph";
import { childId, newId } from "@/lib/ids";
import { captureSlot, dueCheckpoints } from "@/domain/content-studio";
import { addDays, localDate, startOfLocalDay } from "@/domain/time";
import type { AppContext } from "../context";

/**
 * The one scheduled job (spec 4.11): capture Instagram account days, post checkpoints and live stories, once per
 * 6-hour slot. Triggered by an external scheduler on POST /api/jobs/snapshot (signed) and, lazily (spec 4.6), by the
 * first request of a slot. Every row has a deterministic id, so a repeat or a race between two server instances
 * adds nothing that changes a number (readers keep the earliest row per id, D006).
 */
const SYSTEM = { founder: "system" };
export const SNAPSHOT_TZ = "Europe/Paris";
/** Days of account insights re-read when runs were missed (the API serves a limited window; the rest stays a gap). */
export const BACKFILL_DAYS = 7;
export const STATUS_ID = childId("integration", "instagram");
type Trigger = Row<"SnapshotRuns">["trigger"];
export type SnapshotResult =
  | { status: "not_configured" }
  | { status: "skipped"; slot: string }
  | { status: "done" | "error"; slot: string; accounts: number; daily_rows: number; post_rows: number; story_rows: number; errors: string[] };

const g = globalThis as unknown as { __valemontSnapshot?: Map<string, Promise<SnapshotResult>> };
const running = () => (g.__valemontSnapshot ??= new Map());

const sameUrl = (a: string, b: string) => Boolean(a && b) && a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

async function setStatus(ctx: AppContext, status: "ok" | "error", error = "") {
  const cur = await ctx.repo.get("IntegrationStatuses", STATUS_ID, { fresh: true });
  const patch = { status, last_error: error.slice(0, 500), ...(status === "ok" ? { last_success_at: new Date().toISOString() } : {}) };
  if (cur) await ctx.repo.update("IntegrationStatuses", STATUS_ID, cur.version, patch, SYSTEM);
  else await ctx.repo.insert("IntegrationStatuses", [{ id: STATUS_ID, integration: "instagram", last_success_at: null, ...patch }], SYSTEM);
}

/** Runs the capture for the current slot; a second call for the same slot (or while one runs) is a no-op. */
export function runSnapshot(ctx: AppContext, opts: { now?: Date; trigger: Trigger }): Promise<SnapshotResult> {
  const accounts = ctx.instagram ?? [];
  if (!accounts.length) return Promise.resolve({ status: "not_configured" });
  const now = opts.now ?? new Date();
  const slot = captureSlot(now);
  const inflight = running().get(slot);
  if (inflight) return inflight;
  const p = capture(ctx, accounts, slot, now, opts.trigger).finally(() => running().delete(slot));
  running().set(slot, p);
  return p;
}

async function capture(ctx: AppContext, accounts: InstagramAccount[], slot: string, now: Date, trigger: Trigger): Promise<SnapshotResult> {
  const doneId = childId("snapshot-run", slot, "done");
  if (await ctx.repo.get("SnapshotRuns", doneId, { fresh: true })) return { status: "skipped", slot };
  const started = new Date().toISOString();
  const t = await ctx.repo.listMany(["SocialAccounts", "SocialAccountDaily", "SocialPostSnapshots", "ContentVariants", "Tasks"], { fresh: true });
  const dailyIds = new Set(t.SocialAccountDaily.rows.map((r) => r.id));
  const snapIds = new Set(t.SocialPostSnapshots.rows.map((r) => r.id));
  const taskIds = new Set(t.Tasks.rows.map((r) => r.id));
  const daily: NewRow<"SocialAccountDaily">[] = [];
  const snaps: NewRow<"SocialPostSnapshots">[] = [];
  const tasks: NewRow<"Tasks">[] = [];
  const errors: string[] = [];
  let ok = 0;
  const capturedAt = now.toISOString();
  const yesterday = addDays(localDate(now, SNAPSHOT_TZ), -1);
  const unix = (d: string) => Math.floor(startOfLocalDay(d, SNAPSHOT_TZ).getTime() / 1000);

  for (const acc of accounts) {
    const row = t.SocialAccounts.rows.find((a) => !a.is_archived && a.platform === "instagram" && (a.id === acc.key || a.id === childId("social", acc.key)));
    if (!row) { errors.push(`${acc.key}: no Instagram account with this key`); continue; }
    try {
      // 1. Account days: yesterday with the follower count read now, earlier missed days without followers (unknown, not 0).
      const profile = await acc.port.profile();
      for (let i = BACKFILL_DAYS - 1; i >= 0; i--) {
        const d = addDays(yesterday, -i);
        const id = childId("social-daily", row.id, d, "api");
        if (dailyIds.has(id)) continue;
        const ins = await acc.port.dayInsights(unix(d), unix(addDays(d, 1)));
        const followers = d === yesterday ? profile.followers : null;
        if (!ins && followers === null) continue; // not served any more: the day stays a visible gap
        daily.push({ id, account_id: row.id, date: d, followers, views: ins?.views ?? null, impressions: null, reach: ins?.reach ?? null, profile_visits: ins?.profile_visits ?? null, interactions: null, link_clicks: ins?.link_clicks ?? null, source: "api", captured_at: capturedAt, import_file: "" });
        dailyIds.add(id);
      }
      // 2. Posts and Reels at fixed ages (24 h, 72 h, 7 d, 30 d), each captured once, with its real age.
      const media = await acc.port.media(Math.floor(now.getTime() / 1000) - 33 * 86_400);
      for (const m of media) {
        const have = new Set(["h24", "h72", "d7", "d30"].filter((cp) => snapIds.has(childId("post-snap", row.id, m.id, cp))));
        const due = dueCheckpoints(m.timestamp, now, have);
        if (!due.length) continue;
        const ins = await acc.port.insights(m);
        for (const cp of due) snaps.push(snapRow(ctx, t.ContentVariants.rows, row.id, m, cp, "", now, ins));
        due.forEach((cp) => snapIds.add(childId("post-snap", row.id, m.id, cp)));
      }
      // 3. Stories: one capture per slot while Instagram serves them (24 h); kept after they disappear.
      for (const m of await acc.port.stories()) {
        const id = childId("post-snap", row.id, m.id, "live", slot);
        if (snapIds.has(id)) continue;
        snaps.push(snapRow(ctx, t.ContentVariants.rows, row.id, m, "live", slot, now, await acc.port.insights(m)));
        snapIds.add(id);
      }
      ok++;
      // Spec 4.12: a 60-day token gets a task 14 days before it expires.
      if (acc.expiresAt && Date.parse(acc.expiresAt) - now.getTime() < 14 * 86_400_000) {
        const id = childId("ig-token-expiry", acc.key, acc.expiresAt);
        if (!taskIds.has(id)) {
          taskIds.add(id);
          tasks.push({ id, title: `Instagram ${row.handle} : renouveler le jeton / renovar el token`, description: "docs/INTEGRATIONS.md › Instagram", owner: null, created_by_founder: "theo", account_id: "", opportunity_id: "", project_id: "", client_id: "", priority: "P1", status: "todo", estimated_minutes: 15, due_at: acc.expiresAt.slice(0, 10), recurrence: "none", recurrence_days: [], recurrence_parent_id: "", dependency_ids: [], completion_evidence: "", completed_at: null, visibility: "team", snoozed_until: null, snooze_reason: "", area: "marketing", source: "system", source_id: `ig-token:${acc.key}` });
        }
      }
    } catch (e) {
      errors.push(`${acc.key}: ${(e as Error).message}`.slice(0, 200));
    }
  }

  if (daily.length) await ctx.repo.insert("SocialAccountDaily", daily, SYSTEM);
  if (snaps.length) await ctx.repo.insert("SocialPostSnapshots", snaps, SYSTEM);
  if (tasks.length) await ctx.repo.insert("Tasks", tasks, SYSTEM);
  const status = errors.length ? "error" : "done";
  const counts = { accounts: ok, daily_rows: daily.length, post_rows: snaps.filter((s) => s.checkpoint !== "live").length, story_rows: snaps.filter((s) => s.checkpoint === "live").length };
  // Only a clean run closes the slot; after an error the next trigger retries (finished parts are no-ops).
  await ctx.repo.insert("SnapshotRuns", [{ id: status === "done" ? childId("snapshot-run", slot, "done") : newId(), slot, trigger, status, started_at: started, finished_at: new Date().toISOString(), ...counts, error: errors.join(" · ").slice(0, 500) }], SYSTEM);
  await setStatus(ctx, status === "done" ? "ok" : "error", errors.join(" · "));
  return { status, slot, ...counts, errors };
}

function snapRow(_ctx: AppContext, variants: Row<"ContentVariants">[], accountId: string, m: IgMedia, checkpoint: NewRow<"SocialPostSnapshots">["checkpoint"], slot: string, now: Date, ins: Awaited<ReturnType<InstagramAccount["port"]["insights"]>>): NewRow<"SocialPostSnapshots"> {
  const variant = variants.find((v) => !v.is_archived && (v.media_id === m.id || sameUrl(v.platform_post_url, m.permalink)));
  const n = (v: number | null | undefined) => (ins.available && typeof v === "number" ? v : null);
  return {
    id: checkpoint === "live" ? childId("post-snap", accountId, m.id, "live", slot) : childId("post-snap", accountId, m.id, checkpoint),
    account_id: accountId, variant_id: variant?.id ?? "", media_id: m.id, permalink: m.permalink, media_kind: m.kind, checkpoint, slot,
    age_hours: Math.floor((now.getTime() - Date.parse(m.timestamp)) / 3_600_000), captured_at: now.toISOString(),
    // A story under 5 viewers (or no longer served) is "not available", never 0.
    availability: ins.available ? "ok" : "not_available",
    views: n(ins.views), impressions: null, reach: n(ins.reach), likes: n(ins.likes), comments: n(ins.comments), saves: n(ins.saves), shares: n(ins.shares),
    profile_visits: n(ins.profile_visits), link_clicks: n(ins.link_clicks), site_visits: null, leads: null, follows: n(ins.follows), source: "api",
  };
}

/* ---------- lazy trigger (spec 4.6): the first request of a slot starts the capture, without blocking it ---------- */

const lazy = globalThis as unknown as { __valemontSnapshotLazy?: { slot: string; at: number } };
/** Called from the polling endpoint. At most one attempt per slot and process; after an error, retried every 15 minutes. */
export function maybeSnapshot(ctx: AppContext, now = new Date()): Promise<SnapshotResult> | null {
  if (ctx.mode !== "live" || !ctx.instagram?.length) return null;
  const slot = captureSlot(now);
  const last = lazy.__valemontSnapshotLazy;
  if (last && last.slot === slot && now.getTime() - last.at < 15 * 60_000) return null;
  lazy.__valemontSnapshotLazy = { slot, at: now.getTime() };
  const p = runSnapshot(ctx, { now, trigger: "first_request" });
  p.then((r) => { if (r.status === "done" || r.status === "skipped") lazy.__valemontSnapshotLazy = { slot, at: Number.MAX_SAFE_INTEGER }; }).catch((e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", where: "snapshot-lazy", message: (e as Error)?.message }));
  });
  return p;
}

/** Status for the Content Studio and Settings: capability, last success, last runs, token days left. */
export async function snapshotStatus(ctx: AppContext, now = new Date()) {
  const t = await ctx.repo.listMany(["SnapshotRuns", "IntegrationStatuses"]);
  const runs = [...t.SnapshotRuns.rows].sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  const st = t.IntegrationStatuses.rows.find((r) => r.id === STATUS_ID) ?? null;
  const accounts = (ctx.instagram ?? []).map((a) => ({ key: a.key, daysLeft: a.expiresAt ? Math.floor((Date.parse(a.expiresAt) - now.getTime()) / 86_400_000) : null }));
  return {
    mode: ctx.mode,
    capability: accounts.length ? ("connected" as const) : ("manual" as const),
    accounts,
    slot: captureSlot(now),
    lastSuccessAt: st?.last_success_at ?? runs.find((r) => r.status === "done")?.finished_at ?? null,
    lastError: st?.status === "error" ? st.last_error : "",
    runs: runs.slice(0, 5).map((r) => ({ slot: r.slot, status: r.status, trigger: r.trigger, finished_at: r.finished_at, daily_rows: r.daily_rows, post_rows: r.post_rows, story_rows: r.story_rows })),
    schedulerConfigured: typeof process !== "undefined" && Boolean(process.env?.SNAPSHOT_JOB_SECRET || process.env?.SNAPSHOT_JOB_TOKEN),
  };
}
