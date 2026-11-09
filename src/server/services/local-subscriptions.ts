import { z } from "zod";
import { ConflictError, type DataRepository } from "@/data/repository";
import { LOCAL_METRICS, LOCAL_PLAN_LIMITS_SEED, LOCAL_PROVISIONS_SEED, localMargin, parseLocalUsageCsv, type LocalMetric } from "@/domain/delivery";
import type { FounderKey } from "@/domain/constants";
import { addDays, localDate } from "@/domain/time";
import { childId } from "@/lib/ids";
import type { AppContext } from "../context";
import { RuleError } from "../errors";
import { offerDefaults, settingValue, userRow } from "./common";

/**
 * Valemont Local subscriptions (spec 5.7): usage per client and month against the plan limits, and the contribution
 * margin = monthly price (`offer_local_monthly_eur`) − actual cost, else the provisions (spec 2.5, labelled provisions).
 * Limits and provisions are SystemSettings JSON (`local_plan_limits`, `local_cost_provisions`), seeds used while unset.
 */
export async function localLimits(repo: DataRepository): Promise<Record<LocalMetric, number>> {
  try {
    const raw = await settingValue(repo, "local_plan_limits");
    const v = raw ? (JSON.parse(raw) as Partial<Record<LocalMetric, number>>) : {};
    return Object.fromEntries(LOCAL_METRICS.map((m) => [m, Number.isFinite(Number(v[m])) && Number(v[m]) >= 0 ? Number(v[m]) : LOCAL_PLAN_LIMITS_SEED[m]])) as Record<LocalMetric, number>;
  } catch {
    return { ...LOCAL_PLAN_LIMITS_SEED };
  }
}

export async function localProvisions(repo: DataRepository) {
  const limits = await localLimits(repo);
  let p = LOCAL_PROVISIONS_SEED;
  try {
    const raw = await settingValue(repo, "local_cost_provisions");
    if (raw) p = provisionsSchema.parse(JSON.parse(raw));
  } catch {
    /* malformed cell: seeds apply, the diagnostics page reports integrity separately */
  }
  return { ...p, includedSupportMinutes: limits.support_minutes };
}

const provisionsSchema = z.object({
  lines: z.array(z.object({ key: z.string().max(40), label: z.string().trim().min(1).max(120), minor: z.number().int().min(0).max(1_000_000) })).max(20),
  supportRateMinorPerHour: z.number().int().min(0).max(1_000_000),
});

const month = z.string().regex(/^\d{4}-\d{2}$/);
export const localOverviewSchema = z.object({ month: month.optional() });

export async function localOverview(ctx: AppContext, founder: FounderKey, m?: string, now = new Date()) {
  const today = localDate(now, (await userRow(ctx.repo, founder)).timezone);
  const cur = m ?? today.slice(0, 7);
  const t = await ctx.repo.listMany(["Clients", "LocalSubscriptionUsage"]);
  const limits = await localLimits(ctx.repo);
  const prov = await localProvisions(ctx.repo);
  const price = (await offerDefaults(ctx.repo)).local;
  const usage = t.LocalSubscriptionUsage.rows.filter((u) => !u.is_archived);
  const clients = t.Clients.rows.filter((c) => !c.is_archived && (c.brand === "local" || usage.some((u) => u.client_id === c.id)));
  const prevMonths = [1, 2, 3, 4, 5].map((k) => addDays(`${cur}-15`, -30 * k).slice(0, 7));
  const rows = clients.map((c) => {
    const u = usage.find((x) => x.client_id === c.id && x.month === cur) ?? null;
    const values = u ?? { conversations: 0, qualified_requests: 0, automated_emails: 0, support_minutes: 0, locations: 1, actual_cost_minor: null };
    const margin = localMargin(values, price, limits, prov);
    const history = prevMonths.map((pm) => usage.find((x) => x.client_id === c.id && x.month === pm)).filter(Boolean).map((x) => ({ month: x!.month, support_minutes: x!.support_minutes, margin: localMargin(x!, price, limits, prov).marginMinor }));
    return { client: { id: c.id, name: c.name, status: c.status, market: c.market }, usage: u ? { id: u.id, version: u.version, source: u.source, note: u.note, ...pick(u), actual_cost_minor: u.actual_cost_minor } : null, values: pick(values), margin, history };
  });
  const entered = rows.filter((r) => r.usage);
  return {
    month: cur, priceMinor: price, limits, provisions: prov, provisionsTotalMinor: prov.lines.reduce((s, l) => s + l.minor, 0) + Math.round((prov.includedSupportMinutes / 60) * prov.supportRateMinorPerHour),
    rows: rows.sort((a, b) => b.values.support_minutes - a.values.support_minutes),
    totals: { clients: rows.length, entered: entered.length, marginMinor: entered.reduce((s, r) => s + r.margin.marginMinor, 0), overSupport: rows.filter((r) => r.margin.extraSupportMinutes > 0).length, alerts: rows.filter((r) => Object.values(r.margin.levels).some((l) => l !== "ok")).length },
  };
}
const pick = (u: Record<LocalMetric, number>) => Object.fromEntries(LOCAL_METRICS.map((m) => [m, u[m]])) as Record<LocalMetric, number>;

const counts = z.object(Object.fromEntries(LOCAL_METRICS.map((m) => [m, z.number().int().min(0).max(1_000_000)])) as Record<LocalMetric, z.ZodNumber>);
export const usageSchema = z.object({
  client_id: z.string().uuid(), month, values: counts, actual_cost_eur: z.number().min(0).max(100_000).nullable().default(null),
  note: z.string().trim().max(500).default(""), expected_version: z.number().int().nullable().default(null),
});
export const usageId = (clientId: string, m: string) => childId("local-usage", clientId, m);

/** One row per client and month (UUIDv5): a second entry updates it, version-checked (spec 4.3). */
export async function saveUsage(ctx: AppContext, founder: FounderKey, i: z.infer<typeof usageSchema>, source: "manual" | "import" = "manual") {
  const client = await ctx.repo.get("Clients", i.client_id);
  if (!client || client.is_archived) throw new RuleError("Record not found");
  const id = usageId(i.client_id, i.month);
  const cur = await ctx.repo.get("LocalSubscriptionUsage", id, { fresh: true });
  const data = { ...i.values, actual_cost_minor: i.actual_cost_eur === null ? null : Math.round(i.actual_cost_eur * 100), note: i.note, source };
  if (!cur) {
    await ctx.repo.insert("LocalSubscriptionUsage", [{ id, client_id: i.client_id, month: i.month, ...data }], { founder });
    return { id, created: true };
  }
  if (i.expected_version === null) throw new ConflictError("LocalSubscriptionUsage", id, 0, cur as unknown as Record<string, unknown>);
  await ctx.repo.update("LocalSubscriptionUsage", id, i.expected_version, data, { founder });
  return { id, created: false };
}

export const usageCsvSchema = z.object({ csv: z.string().min(1).max(500_000) });
/** CSV import (until the Local product can send usage): clients matched by name; an import overwrites that month's row. */
export async function importUsageCsv(ctx: AppContext, founder: FounderKey, i: z.infer<typeof usageCsvSchema>) {
  const parsed = parseLocalUsageCsv(i.csv);
  const clients = (await ctx.repo.list("Clients")).rows.filter((c) => !c.is_archived);
  const norm = (s: string) => s.trim().toLowerCase();
  let saved = 0;
  const errors = [...parsed.errors];
  for (const [n, r] of parsed.rows.entries()) {
    const c = clients.find((x) => norm(x.name) === norm(r.client));
    if (!c) { errors.push({ line: n + 2, reason: "Unknown client" }); continue; }
    const cur = await ctx.repo.get("LocalSubscriptionUsage", usageId(c.id, r.month), { fresh: true });
    const base = cur ? pick(cur) : { conversations: 0, qualified_requests: 0, automated_emails: 0, support_minutes: 0, locations: 1 };
    await saveUsage(ctx, founder, { client_id: c.id, month: r.month, values: { ...base, ...r.values }, actual_cost_eur: r.actual_cost_minor !== null ? r.actual_cost_minor / 100 : cur && cur.actual_cost_minor !== null ? cur.actual_cost_minor / 100 : null, note: cur?.note ?? "", expected_version: cur?.version ?? null }, "import");
    saved++;
  }
  return { saved, errors };
}

export const planSchema = z.object({ limits: counts, provisions: provisionsSchema });
/** Edit the plan limits and the cost provisions (settings rows, version-checked by a fresh read). */
export async function savePlan(ctx: AppContext, founder: FounderKey, i: z.infer<typeof planSchema>) {
  for (const [key, value] of [["local_plan_limits", JSON.stringify(i.limits)], ["local_cost_provisions", JSON.stringify(i.provisions)]] as const) {
    const id = childId("setting", key);
    const cur = await ctx.repo.get("SystemSettings", id, { fresh: true });
    if (cur) await ctx.repo.update("SystemSettings", id, cur.version, { value }, { founder });
    else await ctx.repo.insert("SystemSettings", [{ id, key, value, description: key === "local_plan_limits" ? "Valemont Local plan limits per month (JSON)." : "Valemont Local cost provisions per client per month, in cents (JSON). Provisions, not actuals." }], { founder });
  }
  return { ok: true };
}
