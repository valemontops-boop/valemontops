import { channelFunnels } from "@/domain/funnels";
import { MINUTES_PER_ACTION_SEED } from "@/domain/seeds";
import { z } from "zod";
import Papa from "papaparse";
import { childId } from "@/lib/ids";
import { BRANDS, BRAND_LABELS, type Brand, type FounderKey } from "@/domain/constants";
import { audienceFit, byCountry, bySource, classifyTraffic, countryCode, mapTrafficGrid, recommendations, trafficSplit, type TrafficRow } from "@/domain/marketing";
import { dedupeEvents } from "@/domain/activity";
import { bestPerDay } from "@/domain/audience";
import { addDays, localDate } from "@/domain/time";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { settingValue, userRow } from "./common";
import { marketingWeek } from "./marketing-week";

async function targetMarkets(ctx: AppContext): Promise<Record<Brand, string[]>> {
  const raw = await settingValue(ctx.repo, "target_markets");
  const d: Record<Brand, string[]> = { local: ["FR", "ES"], consulting: ["FR", "ES"], thirty: ["FR", "ES"] };
  try { return { ...d, ...(raw ? JSON.parse(raw) : {}) }; } catch { return d; }
}

export const overviewSchema = z.object({ days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).default(30), brand: z.enum([...BRANDS, "all"] as const).default("all") });

export async function marketingOverview(ctx: AppContext, founder: FounderKey, input: z.infer<typeof overviewSchema>) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const from = addDays(today, -input.days + 1);
  const t = await ctx.repo.listMany(["TrafficDaily", "SocialAccounts", "SocialAccountDaily", "AudienceBreakdown", "ActivityEvents"]);
  const brandOk = (b: string | null) => input.brand === "all" || b === input.brand;
  const traffic = t.TrafficDaily.rows.filter((r) => !r.is_archived && r.date >= from && r.date <= today && brandOk(r.brand)) as TrafficRow[];
  const accounts = t.SocialAccounts.rows.filter((a) => !a.is_archived && a.visibility === "team" && brandOk(a.brand));
  const daily = t.SocialAccountDaily.rows.filter((r) => r.date >= from && r.date <= today);
  const sum = (ids: string[], k: "views" | "impressions" | "link_clicks" | "profile_visits") => daily.filter((r) => ids.includes(r.account_id)).reduce((s, r) => s + (r[k] ?? 0), 0);
  const markets = await targetMarkets(ctx);
  const events = dedupeEvents(t.ActivityEvents.rows).filter((e) => e.local_date >= from && e.local_date <= today);

  const funnels = (input.brand === "all" ? BRANDS : [input.brand as Brand]).map((b) => {
    const acc = accounts.filter((a) => a.brand === b);
    const ig = acc.filter((a) => a.platform === "instagram").map((a) => a.id);
    const li = acc.filter((a) => a.platform !== "instagram").map((a) => a.id);
    const tr = traffic.filter((r) => r.brand === b);
    const meetings = events.filter((e) => e.brand === b && (e.activity_type === "meeting_booked" || e.outcome === "meeting_booked")).length;
    const steps = [
      ...(ig.length ? [{ label: "Instagram views", value: sum(ig, "views") }] : []),
      ...(li.length ? [{ label: "LinkedIn impressions", value: sum(li, "impressions") }] : []),
      { label: "Link clicks", value: sum([...ig, ...li], "link_clicks") },
      { label: "Website sessions", value: tr.reduce((s, r) => s + (r.sessions ?? 0), 0) },
      { label: "Leads", value: tr.reduce((s, r) => s + (r.leads ?? 0), 0) },
      b === "thirty" ? { label: "Purchases", value: tr.reduce((s, r) => s + (r.purchases ?? 0), 0) } : { label: "Meetings booked", value: meetings },
    ];
    return { brand: b, label: BRAND_LABELS[b], steps, hasData: steps.some((s) => s.value > 0) };
  });

  // Growth › LinkedIn / Instagram: content funnel per platform (team accounts), down to the website visits that came from it.
  const fromSource = (re: RegExp) => traffic.filter((r) => re.test(`${r.source} ${r.medium}`));
  const trafficSteps = (re: RegExp) => [
    { label: "Website visits", value: fromSource(re).reduce((s, r) => s + (r.sessions ?? 0), 0) },
    { label: "Leads", value: fromSource(re).reduce((s, r) => s + (r.leads ?? 0), 0) },
  ];
  const igIds = accounts.filter((a) => a.platform === "instagram").map((a) => a.id);
  const liIds = accounts.filter((a) => a.platform !== "instagram").map((a) => a.id);
  const platforms = {
    instagram: [{ label: "Views", value: sum(igIds, "views") }, { label: "Profile visits", value: sum(igIds, "profile_visits") }, { label: "Link clicks", value: sum(igIds, "link_clicks") }, ...trafficSteps(/instagram|\big\b/i)],
    linkedin: [{ label: "Impressions", value: sum(liIds, "impressions") }, { label: "Link clicks", value: sum(liIds, "link_clicks") }, ...trafficSteps(/linkedin|lnkd/i)],
  };

  const latestBreakdown = (accountId: string) => {
    const rows = t.AudienceBreakdown.rows.filter((r) => r.account_id === accountId && !r.is_archived);
    const last = rows.map((r) => r.date).sort().at(-1);
    return last ? rows.filter((r) => r.date === last).map((r) => ({ key: r.key, value: r.value })) : [];
  };
  const fits = accounts.map((a) => ({ account: a.handle, accountId: a.id, platform: a.platform, targets: markets[(a.brand ?? "consulting") as Brand], fit: audienceFit(latestBreakdown(a.id), markets[(a.brand ?? "consulting") as Brand]) }));
  const sources = bySource(traffic);
  const week = await marketingWeek(ctx, founder);
  return {
    from, to: today,
    totals: { sessions: traffic.reduce((s, r) => s + (r.sessions ?? 0), 0), leads: traffic.reduce((s, r) => s + (r.leads ?? 0), 0), purchases: traffic.reduce((s, r) => s + (r.purchases ?? 0), 0), revenue_minor: traffic.reduce((s, r) => s + (r.revenue_minor ?? 0), 0) },
    sources: sources.slice(0, 8).map((x) => ({ ...x, ...classifyTraffic(x.source, x.medium) })),
    // Round 8: web browser vs AI engines vs social networks, and the web split into search / paid / direct / referral.
    split: trafficSplit(traffic),
    countries: byCountry(traffic).slice(0, 8).map((c) => ({ ...c, target: Object.values(markets).flat().includes(c.country) })),
    funnels,
    platforms,
    fits,
    insights: recommendations({ sources, fits, content: week.items }),
    hasTraffic: traffic.length > 0,
  };
}

/* ---------------- traffic import / entry ---------------- */

export const trafficImportSchema = z.object({ brand: z.enum(BRANDS).nullable().default(null), csv: z.string().max(2_000_000), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), file_name: z.string().max(200).default(""), commit: z.boolean().default(false) });

/** GA4 (or any) traffic CSV: comment lines removed, columns matched by name, re-import adds nothing. */
export async function importTraffic(ctx: AppContext, founder: FounderKey, input: z.infer<typeof trafficImportSchema>) {
  const text = input.csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  const grid = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
  const m = mapTrafficGrid(grid, input.period_end);
  if (m.error) throw new RuleError(m.error);
  const existing = new Set((await ctx.repo.list("TrafficDaily", { fresh: true })).rows.map((r) => r.id));
  const rows = m.rows.map((r) => ({ id: childId("traffic", input.brand ?? "", r.date, r.source, r.medium, r.campaign, r.country, "import"), ...r, brand: input.brand, origin: "import" as const, import_file: input.file_name }));
  const fresh = rows.filter((r) => !existing.has(r.id));
  if (input.commit && fresh.length) await ctx.repo.insert("TrafficDaily", fresh, { founder });
  return { mapped: m.mapped, unrecognized: m.unrecognized, rows: rows.length, newRows: fresh.length, sessions: rows.reduce((s, r) => s + (r.sessions ?? 0), 0), committed: input.commit };
}

export const trafficManualSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), brand: z.enum(BRANDS).nullable().default(null), source: z.string().trim().min(1).max(80), medium: z.string().trim().max(80).default(""), country: z.string().trim().max(60).default(""), sessions: z.number().int().min(0), leads: z.number().int().min(0).default(0), purchases: z.number().int().min(0).default(0) });
export async function addTraffic(ctx: AppContext, founder: FounderKey, input: z.infer<typeof trafficManualSchema>) {
  const id = childId("traffic", input.brand ?? "", input.date, input.source, input.medium, "", input.country, "manual");
  const data = { date: input.date, brand: input.brand, source: input.source, medium: input.medium, campaign: "", country: input.country, sessions: input.sessions, leads: input.leads, meetings: null, purchases: input.purchases, revenue_minor: null, origin: "manual" as const, import_file: "" };
  const cur = await ctx.repo.get("TrafficDaily", id, { fresh: true });
  if (cur) return ctx.repo.update("TrafficDaily", id, cur.version, data, { founder });
  return (await ctx.repo.insert("TrafficDaily", [{ id, ...data }], { founder }))[0];
}

export const breakdownSchema = z.object({ account_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), entries: z.array(z.object({ country: z.string().trim().min(2).max(60), percent: z.number().min(0).max(100) })).min(1).max(20) });
/** Manual country split (e.g. from Instagram Insights > Audience), stored as basis points. */
export async function addBreakdown(ctx: AppContext, founder: FounderKey, input: z.infer<typeof breakdownSchema>) {
  const a = await ctx.repo.get("SocialAccounts", input.account_id);
  if (!a || (a.visibility === "owner" && a.owner_founder !== founder)) throw new RuleError("Account not found");
  const rows = input.entries.map((e) => ({ id: childId("breakdown", a.id, input.date, countryCode(e.country), "manual"), account_id: a.id, date: input.date, dimension: "country" as const, key: countryCode(e.country), value: Math.round(e.percent * 100), unit: "bp" as const, source: "manual" as const }));
  const existing = new Set((await ctx.repo.list("AudienceBreakdown", { fresh: true })).rows.map((r) => r.id));
  const fresh = rows.filter((r) => !existing.has(r.id));
  if (fresh.length) await ctx.repo.insert("AudienceBreakdown", fresh, { founder });
  return { added: fresh.length };
}

/* ---------------- funnels across every channel (round 5) ---------------- */
export const funnelsSchema = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30), scope: z.enum(["team", "me"]).default("team") });
/** Calls, field visits, LinkedIn, email, WhatsApp, web browser, AI engines and social funnels for the period, with meetings per hour of work. */
export async function marketingFunnels(ctx: AppContext, founder: FounderKey, input: z.infer<typeof funnelsSchema>) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const from = addDays(today, -input.days + 1);
  const t = await ctx.repo.listMany(["ActivityEvents", "EmailSends", "Opportunities", "OpportunityStageEvents", "TrafficDaily", "SocialAccounts", "SocialAccountDaily"]);
  const mine = (f: string) => input.scope === "team" || f === founder;
  const events = dedupeEvents(t.ActivityEvents.rows).filter((e) => mine(e.founder_key));
  // Social audience of the accounts this founder can see (team pages + their own profile): views (Instagram) and impressions (LinkedIn).
  const visible = new Set(t.SocialAccounts.rows.filter((a) => !a.is_archived && (a.visibility === "team" || a.owner_founder === founder)).map((a) => a.id));
  const socialReach = [...visible].flatMap((id) => bestPerDay(t.SocialAccountDaily.rows.filter((r) => !r.is_archived && r.account_id === id && r.date >= from && r.date <= today))).reduce((a, r) => a + (r.views ?? 0) + (r.impressions ?? 0), 0);
  const r = channelFunnels({
    events, sends: t.EmailSends.rows.filter((s) => mine(s.founder_key)), opps: t.Opportunities.rows, stageEvents: t.OpportunityStageEvents.rows,
    traffic: t.TrafficDaily.rows.filter((x) => !x.is_archived), from, to: today, minutes: MINUTES_PER_ACTION_SEED, socialReach,
  });
  return { from, to: today, ...r };
}
