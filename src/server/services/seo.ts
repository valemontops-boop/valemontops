import { z } from "zod";
import Papa from "papaparse";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { aiChecklist, auditHtml, latestSnapshot, mapSearchConsoleGrid, pageIssues, seoOpportunities, seoSummary, siteIssues, sitemapUrls, type GscRow, type PageAudit, type SeoIssue } from "@/domain/seo";
import { classifyTraffic } from "@/domain/marketing";
import { addDays, localDate } from "@/domain/time";
import type { Row } from "@/data/schema/tables";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { settingValue, userRow } from "./common";

/**
 * Growth › Web › SEO (round 9, D072): Search Console data (CSV import of the Performance export, or manual entry),
 * optimisation points and a server-side audit of the configured site URLs (website_url_fr / website_url_es).
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const seoSchema = z.object({ language: z.enum(["all", "FR", "ES"]).default("all"), days: z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).default(30) });

const toGsc = (r: Row<"SearchConsoleRows">): GscRow => ({ language: r.language, dimension: r.dimension, key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position_x10 / 10, period_start: r.period_start, period_end: r.period_end });

export async function seoOverview(ctx: AppContext, founder: FounderKey, input: z.infer<typeof seoSchema>) {
  const u = await userRow(ctx.repo, founder);
  const today = localDate(new Date(), u.timezone);
  const from = addDays(today, -input.days + 1);
  const t = await ctx.repo.listMany(["SearchConsoleRows", "SeoAudits", "TrafficDaily"]);
  const rows = t.SearchConsoleRows.rows.filter((r) => !r.is_archived).map(toGsc);
  const snap = latestSnapshot(rows, input.language);
  const summary = seoSummary(snap.rows);
  const audit = latestAudit(t.SeoAudits.rows);
  const aiVisits = t.TrafficDaily.rows.filter((r) => !r.is_archived && r.date >= from && r.date <= today && classifyTraffic(r.source, r.medium).group === "ai").reduce((a, r) => a + (r.sessions ?? 0), 0);
  const sites = await siteUrls(ctx);
  return {
    periods: snap.periods,
    hasData: rows.length > 0,
    summary: { ...summary, topQueries: summary.topQueries.slice(0, 20), topPages: summary.topPages.slice(0, 20) },
    points: seoOpportunities(snap.rows, { brandTerms: await brandTerms(ctx) }),
    audit,
    ai: { visits: aiVisits, checklist: aiChecklist(audit ? { pages: audit.pages.map(fromStored), facts: audit.facts } : null, aiVisits) },
    sites,
  };
}

function latestAudit(rows: Row<"SeoAudits">[]) {
  const r = rows.filter((x) => !x.is_archived).sort((a, b) => a.run_at.localeCompare(b.run_at)).at(-1);
  return r ? { id: r.id, run_at: r.run_at, founder_key: r.founder_key, site_urls: r.site_urls, pages_checked: r.pages_checked, facts: r.facts, pages: r.pages, issues: r.issues as SeoIssue[] } : null;
}
type StoredPage = Row<"SeoAudits">["pages"][number];
const toStored = (p: PageAudit): StoredPage => ({ url: p.url, status: p.status, bytes: p.bytes, titleLength: [...p.title].length, metaLength: [...p.metaDescription].length, h1Count: p.h1Count, canonical: Boolean(p.canonical), hreflang: p.hreflang, og: p.og, types: p.structuredTypes, imagesWithoutAlt: p.imagesWithoutAlt, noindex: p.noindex });
const fromStored = (p: StoredPage): PageAudit => ({ url: p.url, status: p.status, bytes: p.bytes, title: "", metaDescription: "", h1Count: p.h1Count, canonical: p.canonical ? "x" : "", hreflang: p.hreflang, og: p.og, structuredTypes: p.types, images: 0, imagesWithoutAlt: p.imagesWithoutAlt, noindex: p.noindex });

async function brandTerms(ctx: AppContext) {
  const raw = await settingValue(ctx.repo, "seo_brand_terms");
  const list = (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : undefined;
}
export async function siteUrls(ctx: AppContext): Promise<{ language: "FR" | "ES"; url: string }[]> {
  const out: { language: "FR" | "ES"; url: string }[] = [];
  for (const [language, key] of [["FR", "website_url_fr"], ["ES", "website_url_es"]] as const) {
    const v = (await settingValue(ctx.repo, key))?.trim();
    if (v && safeUrl(v)) out.push({ language, url: v });
  }
  return out;
}

/* ---------------- Search Console import / manual entry ---------------- */

export const gscImportSchema = z.object({
  language: z.enum(["FR", "ES"]), period_start: DATE, period_end: DATE, csv: z.string().max(2_000_000), file_name: z.string().max(200).default(""), commit: z.boolean().default(false),
}).refine((v) => v.period_start <= v.period_end, { message: "The period start must be before its end" });
const gscId = (r: { language: string; period_start: string; period_end: string; dimension: string; key: string }) => childId("gsc", r.language, r.period_start, r.period_end, r.dimension, r.key);

/** Queries.csv or Pages.csv of the GSC Performance export; re-importing the same period adds nothing. */
export async function importSearchConsole(ctx: AppContext, founder: FounderKey, input: z.infer<typeof gscImportSchema>) {
  const grid = Papa.parse<string[]>(input.csv.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data;
  const m = mapSearchConsoleGrid(grid, { language: input.language, period_start: input.period_start, period_end: input.period_end });
  if (m.error) throw new RuleError(m.error);
  const existing = new Set((await ctx.repo.list("SearchConsoleRows", { fresh: true })).rows.map((r) => r.id));
  const seen = new Set<string>();
  const rows = m.rows.map((r) => ({ id: gscId(r), period_start: r.period_start, period_end: r.period_end, language: r.language, dimension: r.dimension, key: r.key, clicks: r.clicks, impressions: r.impressions, position_x10: Math.round(r.position * 10), origin: "import" as const, import_file: input.file_name }))
    .filter((r) => !seen.has(r.id) && seen.add(r.id));
  const fresh = rows.filter((r) => !existing.has(r.id));
  if (input.commit && fresh.length) await ctx.repo.insert("SearchConsoleRows", fresh, { founder });
  return { dimension: m.dimension, rows: rows.length, newRows: fresh.length, clicks: rows.reduce((a, r) => a + r.clicks, 0), impressions: rows.reduce((a, r) => a + r.impressions, 0), committed: input.commit };
}

export const gscManualSchema = z.object({
  language: z.enum(["FR", "ES"]), period_start: DATE, period_end: DATE, dimension: z.enum(["query", "page"]), key: z.string().trim().min(1).max(500),
  clicks: z.number().int().min(0), impressions: z.number().int().min(0), position: z.number().min(0).max(200),
}).refine((v) => v.period_start <= v.period_end, { message: "The period start must be before its end" }).refine((v) => v.clicks <= v.impressions, { message: "Clicks cannot exceed impressions" });
export async function addSearchConsoleRow(ctx: AppContext, founder: FounderKey, input: z.infer<typeof gscManualSchema>) {
  const key = input.dimension === "query" ? input.key.toLowerCase() : input.key;
  const id = gscId({ ...input, key });
  const data = { period_start: input.period_start, period_end: input.period_end, language: input.language, dimension: input.dimension, key, clicks: input.clicks, impressions: input.impressions, position_x10: Math.round(input.position * 10), origin: "manual" as const, import_file: "" };
  const cur = await ctx.repo.get("SearchConsoleRows", id, { fresh: true });
  if (cur) return ctx.repo.update("SearchConsoleRows", id, cur.version, data, { founder });
  return (await ctx.repo.insert("SearchConsoleRows", [{ id, ...data }], { founder }))[0];
}

/* ---------------- site audit ---------------- */

export interface Fetched { status: number; url: string; text: string }
export type Fetcher = (url: string) => Promise<Fetched | null>;
const MAX_PAGES = 20;
const MAX_BYTES = 3_000_000;

/** https only, a public host name (no IP literal, no localhost / internal name). */
export function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
    return u;
  } catch { return null; }
}

/** Live fetcher: 10 s timeout, size cap, and the final URL (after redirects) must stay on https and the same host. */
export const httpFetcher: Fetcher = async (url) => {
  const start = safeUrl(url);
  if (!start) return null;
  try {
    // Redirects are followed by hand (max 5 hops) and every hop is checked BEFORE it is requested, so a redirect can
    // never make the server call an internal address (SSRF, D084). One 10 s budget for the whole chain.
    const signal = AbortSignal.timeout(10_000);
    let end: URL = start;
    let res: Response | null = null;
    for (let hop = 0; hop <= 5; hop++) {
      res = await fetch(end.href, { redirect: "manual", signal, headers: { "user-agent": "ValemontOS-SEO-Audit/1.0", accept: "text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1" } });
      if (res.status < 300 || res.status >= 400) break;
      const next = safeUrl(new URL(res.headers.get("location") ?? "", end).href);
      await res.body?.cancel().catch(() => undefined);
      if (!next || next.host !== start.host || hop === 5) return { status: 0, url: start.href, text: "" };
      end = next;
    }
    if (!res) return { status: 0, url: start.href, text: "" };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return { status: res.status, url: end.href, text: new TextDecoder().decode(buf) };
  } catch {
    return { status: 0, url: start.href, text: "" };
  }
};

/** Audits the configured site(s): robots.txt, llms.txt, sitemap.xml (one level of index), then up to 20 same-host pages. */
export async function runSiteAudit(ctx: AppContext, founder: FounderKey, fetcher: Fetcher = httpFetcher) {
  const sites = await siteUrls(ctx);
  if (!sites.length) throw new RuleError("Set the website address (https) in Settings › Workspace first.");
  const ok = (f: Fetched | null) => Boolean(f && f.status >= 200 && f.status < 300 && f.text.trim());
  const facts = { robots: false, sitemap: false, llms: false };
  const queue: string[] = [];
  const add = (u: string) => { if (!queue.includes(u) && queue.length < MAX_PAGES) queue.push(u); };
  for (const s of sites) add(new URL(s.url).href);
  for (const host of [...new Set(sites.map((s) => new URL(s.url).origin))]) {
    const robots = await fetcher(`${host}/robots.txt`);
    if (ok(robots)) facts.robots = true;
    const llms = await fetcher(`${host}/llms.txt`);
    if (ok(llms) && !/<html/i.test(llms!.text)) facts.llms = true;
    const declared = ok(robots) ? [...robots!.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
    const h = new URL(host).host;
    for (const sm of [...new Set([...declared, `${host}/sitemap.xml`])].filter((u) => safeUrl(u)?.host === h).slice(0, 2)) {
      const x = await fetcher(sm);
      if (!ok(x) || !/<(urlset|sitemapindex)\b/i.test(x!.text)) continue;
      facts.sitemap = true;
      const r = sitemapUrls(x!.text, h);
      r.pages.forEach(add);
      for (const child of r.sitemaps.slice(0, 3)) {
        const c = await fetcher(child);
        if (ok(c)) sitemapUrls(c!.text, h).pages.forEach(add);
      }
    }
  }
  const pages: PageAudit[] = [];
  for (let i = 0; i < queue.length; i += 4) {
    const batch = await Promise.all(queue.slice(i, i + 4).map(async (u) => {
      const f = await fetcher(u);
      return auditHtml(f?.text ?? "", u, f?.status ?? 0);
    }));
    pages.push(...batch);
  }
  const issues = [...siteIssues(pages.filter((p) => p.status >= 200 && p.status < 400), facts), ...pages.flatMap(pageIssues)].slice(0, 150);
  const run_at = new Date().toISOString();
  const [row] = await ctx.repo.insert("SeoAudits", [{ id: childId("seo-audit", run_at, founder), run_at, founder_key: founder, site_urls: sites.map((s) => s.url).join(" "), pages_checked: pages.length, facts, pages: pages.map(toStored), issues }], { founder });
  return latestAudit([row]);
}
