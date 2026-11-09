import { createHmac } from "node:crypto";
import { z } from "zod";
import type { DataRepository, Row } from "@/data/repository";
import { ACTIVITY_TYPES, type FounderKey } from "@/domain/constants";
import { dedupeEvents, funnelCounts, isOutreach, newBusinessesContacted } from "@/domain/activity";
import { channelOf } from "@/domain/funnels";
import { outreachBlock } from "@/domain/suppression";
import { isDay, periodDays } from "@/domain/export";
import { addDays, localDate } from "@/domain/time";
import { childId, newId } from "@/lib/ids";
import type { ActivitySink } from "../activity-hooks";
import type { AppContext } from "../context";
import { RuleError } from "../errors";
import { userRow } from "./common";
import { connectorEnvSync } from "../connector-env";

/**
 * Founder's personal performance tracker (iteration 8), generic both ways:
 * PUSH — every new ActivityEvent of a founder is POSTed to TRACKER_WEBHOOK_URL_<FOUNDER>, signed with
 *        HMAC-SHA256 (TRACKER_WEBHOOK_SECRET_<FOUNDER>), idempotency key = event id, 5 s timeout, https only.
 * PULL — GET /api/tracker/feed returns the same events, authenticated by TRACKER_FEED_TOKEN_<FOUNDER>.
 * Secrets come from env vars or the app's encrypted vault (ciphertext only in Sheets, D087); never shown again. See docs/TRACKER.md.
 */

export const TRACKER_VERSION = 1;
export const TIMEOUT_MS = 5_000;
export const FEED_PATH = "/api/tracker/feed";
const MAX_BACKFILL = 5_000;

type Env = Record<string, string | undefined>;
/** Env first, then the values saved in the app (D087). */
const processEnv = (): Env => connectorEnvSync();
const suffix = (f: FounderKey) => f.toUpperCase();

export interface TrackerConfig { url: string | null; secret: string | null; problem: string | null; feedToken: boolean; dailySummary: boolean }

export function trackerConfig(founder: FounderKey, env: Env = processEnv()): TrackerConfig {
  const rawUrl = (env[`TRACKER_WEBHOOK_URL_${suffix(founder)}`] ?? "").trim();
  const secret = (env[`TRACKER_WEBHOOK_SECRET_${suffix(founder)}`] ?? "").trim();
  let problem: string | null = null;
  let url: string | null = null;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      if (u.protocol !== "https:") problem = "The tracker URL must start with https://.";
      else url = u.toString();
    } catch {
      problem = "The tracker URL is not a valid address.";
    }
    if (url && secret.length < 16) { problem = "The tracker secret must be at least 16 characters."; url = null; }
  }
  return {
    url, secret: secret || null, problem,
    feedToken: (env[`TRACKER_FEED_TOKEN_${suffix(founder)}`] ?? "").trim().length >= 24,
    dailySummary: /^(1|true|yes|on)$/i.test((env[`TRACKER_DAILY_SUMMARY_${suffix(founder)}`] ?? "").trim()),
  };
}

/* ---------------- payload ---------------- */

export interface TrackerEvent {
  id: string;
  type: string;
  occurred_at: string;
  local_date: string;
  channel: string | null;
  outcome: string | null;
  /** Business name only (never a person, phone or email); empty for opted-out businesses or numbers outside the CRM. */
  account: string;
  duration_sec: number | null;
  project: "Valemont";
}
export interface TrackerPayload { source: "valemont-os"; version: number; founder: FounderKey; event: TrackerEvent }
export interface TrackerSummaryPayload {
  source: "valemont-os"; version: number; founder: FounderKey;
  summary: { date: string; project: "Valemont"; counts: Record<string, number>; outreach: number; new_businesses: number; conversations: number; meetings_booked: number; sales: number };
}

type Ev = Pick<Row<"ActivityEvents">, "id" | "activity_type" | "occurred_at" | "local_date" | "channel" | "outcome" | "duration_sec">;
export function toTrackerEvent(e: Ev, account: string): TrackerEvent {
  return {
    id: e.id, type: e.activity_type, occurred_at: e.occurred_at, local_date: e.local_date,
    channel: e.channel ?? channelOf(e), outcome: e.outcome ?? null, account, duration_sec: e.duration_sec ?? null, project: "Valemont",
  };
}
export const eventPayload = (founder: FounderKey, event: TrackerEvent): TrackerPayload => ({ source: "valemont-os", version: TRACKER_VERSION, founder, event });

/** `sha256=<hex HMAC-SHA256 of the exact body bytes>`. */
export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/* ---------------- delivery ---------------- */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export interface Delivery { ok: boolean; status: number | null; error: string }

export async function post(cfg: { url: string; secret: string }, payload: object, idempotencyKey: string, fetchImpl: FetchLike = fetch): Promise<Delivery> {
  const body = JSON.stringify(payload);
  try {
    const res = await fetchImpl(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "valemont-os-tracker/1",
        "x-valemont-signature": signBody(cfg.secret, body),
        "x-valemont-idempotency-key": idempotencyKey,
      },
      body,
      redirect: "error", // a redirect could downgrade to http or leak the body elsewhere
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? { ok: true, status: res.status, error: "" } : { ok: false, status: res.status, error: `The tracker answered HTTP ${res.status}.` };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, status: null, error: name === "TimeoutError" || name === "AbortError" ? "The tracker did not answer within 5 seconds." : "The tracker could not be reached." };
  }
}

const statusId = (f: FounderKey) => childId("integration", "tracker", f);

/** Last delivery result in IntegrationStatuses; written only when it changes (or every 15 minutes), to spare the Sheets quota. */
export async function recordDelivery(repo: DataRepository, founder: FounderKey, d: Delivery, now = new Date()) {
  const id = statusId(founder);
  const cur = await repo.get("IntegrationStatuses", id);
  const status = d.ok ? "ok" : "error";
  if (cur && cur.status === status && (!d.ok || (cur.last_success_at && now.getTime() - Date.parse(cur.last_success_at) < 15 * 60_000))) return;
  const patch = { status, last_error: d.error.slice(0, 500), ...(d.ok ? { last_success_at: now.toISOString() } : {}) };
  const fresh = cur ? await repo.get("IntegrationStatuses", id, { fresh: true }) : null;
  if (fresh) await repo.update("IntegrationStatuses", id, fresh.version, patch, { founder: "system" });
  else await repo.insert("IntegrationStatuses", [{ id, integration: `tracker_${founder}`, last_success_at: null, ...patch }], { founder: "system" });
}

async function blockedAccounts(repo: DataRepository) {
  const t = await repo.listMany(["Accounts", "Contacts", "SuppressionList"]);
  const out = new Set<string>();
  for (const a of t.Accounts.rows) {
    const cs = t.Contacts.rows.filter((c) => c.account_id === a.id);
    if (outreachBlock(null, a, t.SuppressionList.rows).blocked || cs.some((c) => c.consent_status === "opted_out")) out.add(a.id);
  }
  return { blocked: out, names: new Map(t.Accounts.rows.map((a) => [a.id, a.name])) };
}

async function founderEvents(repo: DataRepository, founder: FounderKey, from: string, to: string) {
  const [{ rows }, acc] = await Promise.all([repo.list("ActivityEvents"), blockedAccounts(repo)]);
  return dedupeEvents(rows.filter((e) => !e.is_archived && e.founder_key === founder && e.local_date >= from && e.local_date <= to))
    .map((e) => toTrackerEvent(e, e.account_id && !acc.blocked.has(e.account_id) ? acc.names.get(e.account_id) ?? "" : ""));
}

export async function dailySummaryPayload(repo: DataRepository, founder: FounderKey, date: string): Promise<TrackerSummaryPayload> {
  const all = dedupeEvents((await repo.list("ActivityEvents")).rows.filter((e) => !e.is_archived));
  const day = all.filter((e) => e.founder_key === founder && e.local_date === date);
  const counts = Object.fromEntries(ACTIVITY_TYPES.map((a) => [a, day.filter((e) => e.activity_type === a).length]).filter(([, n]) => (n as number) > 0));
  const f = funnelCounts(day, founder, date, date);
  return {
    source: "valemont-os", version: TRACKER_VERSION, founder,
    summary: { date, project: "Valemont", counts, outreach: day.filter((e) => isOutreach(e.activity_type)).length, new_businesses: newBusinessesContacted(all, founder, date, date).length, conversations: f.conversations, meetings_booked: f.meetingsBooked, sales: f.sales },
  };
}

/* ---------------- live sink (registered by the LIVE context only) ---------------- */

export function trackerSink(fixedEnv?: Env, fetchImpl: FetchLike = fetch): ActivitySink {
  // Read at each event (not once at start-up) so a tracker saved in the app is used without a redeploy (D087).
  const envNow = () => fixedEnv ?? processEnv();
  return {
    async activity(repo, founder, event, accountName) {
      const cfg = trackerConfig(founder, envNow());
      if (!cfg.url || !cfg.secret) return;
      const d = await post({ url: cfg.url, secret: cfg.secret }, eventPayload(founder, toTrackerEvent(event, accountName)), event.id, fetchImpl);
      await recordDelivery(repo, founder, d).catch(() => undefined);
    },
    async dailyReview(repo, founder, date) {
      const cfg = trackerConfig(founder, envNow());
      if (!cfg.url || !cfg.secret || !cfg.dailySummary) return;
      const d = await post({ url: cfg.url, secret: cfg.secret }, await dailySummaryPayload(repo, founder, date), `summary-${founder}-${date}`, fetchImpl);
      await recordDelivery(repo, founder, d).catch(() => undefined);
    },
  };
}

/* ---------------- Settings › My tracker ---------------- */

export async function trackerStatus(ctx: AppContext, founder: FounderKey, env: Env = processEnv()) {
  const cfg = trackerConfig(founder, env);
  const st = await ctx.repo.get("IntegrationStatuses", statusId(founder)).catch(() => null);
  return {
    mode: ctx.mode,
    configured: Boolean(cfg.url && cfg.secret),
    problem: cfg.problem,
    /** Host only: a webhook path or query may itself carry a token. */
    host: cfg.url ? new URL(cfg.url).host : null,
    feedConfigured: cfg.feedToken,
    feedPath: FEED_PATH,
    dailySummary: cfg.dailySummary,
    envNames: { url: `TRACKER_WEBHOOK_URL_${suffix(founder)}`, secret: `TRACKER_WEBHOOK_SECRET_${suffix(founder)}`, feed: `TRACKER_FEED_TOKEN_${suffix(founder)}`, summary: `TRACKER_DAILY_SUMMARY_${suffix(founder)}` },
    fields: ["id", "type", "occurred_at", "local_date", "channel", "outcome", "account", "duration_sec", "project"],
    last: st ? { status: st.status, at: st.status === "ok" ? st.last_success_at : st.updated_at, error: st.last_error } : null,
  };
}

const day = z.string().refine(isDay, "Invalid date");
export const trackerActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("backfill"), from: day, to: day }),
  z.object({ action: z.literal("summary"), date: day.optional() }),
]);

function liveConfig(ctx: AppContext, founder: FounderKey, env: Env) {
  if (ctx.mode !== "live") throw new RuleError("DEMO data is never sent to your tracker. Connect it on the live app.");
  const cfg = trackerConfig(founder, env);
  if (!cfg.url || !cfg.secret) throw new RuleError(cfg.problem ?? "Your tracker is not configured yet.");
  return { url: cfg.url, secret: cfg.secret };
}

export async function trackerAction(ctx: AppContext, founder: FounderKey, input: z.infer<typeof trackerActionSchema>, env: Env = processEnv(), fetchImpl: FetchLike = fetch) {
  const cfg = liveConfig(ctx, founder, env);
  if (input.action === "test") {
    const id = newId();
    const now = new Date();
    const tz = (await userRow(ctx.repo, founder)).timezone;
    const d = await post(cfg, eventPayload(founder, { id, type: "test", occurred_at: now.toISOString(), local_date: localDate(now, tz), channel: null, outcome: null, account: "", duration_sec: null, project: "Valemont" }), id, fetchImpl);
    await recordDelivery(ctx.repo, founder, d).catch(() => undefined);
    if (!d.ok) throw new RuleError(d.error);
    return { sent: 1, failed: 0, total: 1 };
  }
  if (input.action === "summary") {
    const date = input.date ?? localDate(new Date(), (await userRow(ctx.repo, founder)).timezone);
    const d = await post(cfg, await dailySummaryPayload(ctx.repo, founder, date), `summary-${founder}-${date}`, fetchImpl);
    await recordDelivery(ctx.repo, founder, d).catch(() => undefined);
    if (!d.ok) throw new RuleError(d.error);
    return { sent: 1, failed: 0, total: 1 };
  }
  if (input.from > input.to) throw new RuleError("The start date must be before the end date.");
  if (periodDays(input.from, input.to) > 400) throw new RuleError("Choose a period of at most 400 days.");
  const events = (await founderEvents(ctx.repo, founder, input.from, input.to)).slice(0, MAX_BACKFILL);
  let sent = 0, failed = 0, streak = 0, last: Delivery = { ok: true, status: null, error: "" };
  // Small batches in parallel; the receiver dedupes by X-Valemont-Idempotency-Key, so a re-run is harmless.
  for (let i = 0; i < events.length && streak < 5; i += 4) {
    const batch = await Promise.all(events.slice(i, i + 4).map((e) => post(cfg, eventPayload(founder, e), e.id, fetchImpl)));
    for (const d of batch) { last = d; if (d.ok) { sent++; streak = 0; } else { failed++; streak++; } }
  }
  if (events.length) await recordDelivery(ctx.repo, founder, failed && !sent ? last : { ok: true, status: 200, error: "" }).catch(() => undefined);
  return { sent, failed, total: events.length, stopped: streak >= 5 };
}

/* ---------------- pull feed ---------------- */

export const feedSchema = z.object({ from: day.optional(), to: day.optional() });
export async function trackerFeed(repo: DataRepository, founder: FounderKey, input: z.infer<typeof feedSchema>, now = new Date()) {
  const tz = (await userRow(repo, founder)).timezone;
  const to = input.to ?? localDate(now, tz);
  const from = input.from ?? addDays(to, -29);
  if (from > to) throw new RuleError("The start date must be before the end date.");
  if (periodDays(from, to) > 400) throw new RuleError("Choose a period of at most 400 days.");
  return { source: "valemont-os" as const, version: TRACKER_VERSION, founder, project: "Valemont", from, to, events: await founderEvents(repo, founder, from, to) };
}
