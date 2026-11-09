/**
 * SEO (iteration 9, D072): Google Search Console data and optimisation points, all deterministic.
 * - `mapSearchConsoleGrid`: the "Performance" export (Queries or Pages table, FR/ES/EN headers) → rows.
 * - `seoSummary`: clicks, impressions, CTR, average position (impression-weighted) of the latest period per language.
 * - `seoOpportunities`: quick wins, low CTR for the position, pages without clicks, FR/ES gaps, brand share.
 * - `auditHtml` / `pageIssues` / `siteIssues`: on-page checks of the site audit (pure; fetching is in the server service).
 * Texts are English keys with {vars}; the UI translates them.
 */

export type SeoLang = "FR" | "ES";
export type SeoDimension = "query" | "page";
export interface GscRow { language: SeoLang; dimension: SeoDimension; key: string; clicks: number; impressions: number; position: number; period_start: string; period_end: string }

/* ---------------- Search Console export ---------------- */

const H = {
  query: ["top queries", "query", "queries", "requêtes les plus fréquentes", "requêtes principales", "requête", "requêtes", "consultas principales", "consulta", "consultas", "consultas más frecuentes"],
  page: ["top pages", "page", "pages", "pages les plus populaires", "pages principales", "páginas principales", "página", "páginas", "landing page"],
  clicks: ["clicks", "clics", "clic"],
  impressions: ["impressions", "impresiones"],
  ctr: ["ctr"],
  position: ["position", "posición", "posicion", "average position", "position moyenne", "posición media"],
};
const norm = (h: unknown) => String(h ?? "").replace(/^﻿/, "").trim().toLowerCase();
const int = (v: unknown) => { const s = String(v ?? "").replace(/[\s  ,.]/g, ""); const n = Number(s); return s !== "" && Number.isFinite(n) ? Math.round(n) : null; };
/** "7.3", "7,3" → 7.3 */
const dec = (v: unknown) => { const s = String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."); const n = Number(s); return s !== "" && Number.isFinite(n) ? n : null; };

/** One GSC table (Queries.csv or Pages.csv) parsed as a grid → rows with the given period and language. */
export function mapSearchConsoleGrid(grid: unknown[][], meta: { language: SeoLang; period_start: string; period_end: string }) {
  const idx = grid.findIndex((r) => r.some((c) => H.impressions.includes(norm(c))));
  if (idx < 0) return { rows: [] as GscRow[], dimension: null, error: "No Impressions column found. Export Search Console › Performance (Queries or Pages table) as CSV." };
  const header = grid[idx].map(norm);
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const q = find(H.query), p = find(H.page);
  const keyCol = q >= 0 ? q : p;
  const dimension: SeoDimension | null = q >= 0 ? "query" : p >= 0 ? "page" : null;
  if (keyCol < 0 || !dimension) return { rows: [] as GscRow[], dimension: null, error: "No Query or Page column found." };
  const ci = find(H.clicks), ii = find(H.impressions), pi = find(H.position);
  const rows: GscRow[] = [];
  for (const r of grid.slice(idx + 1)) {
    const key = String(r[keyCol] ?? "").trim().slice(0, 500);
    const impressions = int(r[ii]);
    if (!key || impressions === null) continue;
    rows.push({ ...meta, dimension, key: dimension === "query" ? key.toLowerCase() : key, clicks: ci >= 0 ? int(r[ci]) ?? 0 : 0, impressions, position: pi >= 0 ? dec(r[pi]) ?? 0 : 0 });
  }
  return { rows, dimension, error: rows.length ? null : "The file has no rows." };
}

/* ---------------- summary ---------------- */

/** Latest imported period per language (an export covers a period; older periods are kept but not added together). */
export function latestSnapshot(rows: GscRow[], language: SeoLang | "all" = "all") {
  const out: GscRow[] = [];
  const periods: { language: SeoLang; from: string; to: string }[] = [];
  for (const lang of ["FR", "ES"] as const) {
    if (language !== "all" && language !== lang) continue;
    const mine = rows.filter((r) => r.language === lang);
    const end = mine.map((r) => r.period_end).sort().at(-1);
    if (!end) continue;
    const start = mine.filter((r) => r.period_end === end).map((r) => r.period_start).sort()[0];
    out.push(...mine.filter((r) => r.period_end === end && r.period_start === start));
    periods.push({ language: lang, from: start, to: end });
  }
  return { rows: out, periods };
}

const ctrOf = (c: number, i: number) => (i ? c / i : null);
const wPos = (rows: GscRow[]) => { const i = rows.reduce((a, r) => a + r.impressions, 0); return i ? Math.round((rows.reduce((a, r) => a + r.position * r.impressions, 0) / i) * 10) / 10 : null; };

/** Totals come from the Pages table when present (the Queries table leaves out anonymised queries), else from the queries. */
export function seoSummary(snapshot: GscRow[]) {
  const pages = snapshot.filter((r) => r.dimension === "page"), queries = snapshot.filter((r) => r.dimension === "query");
  const base = pages.length ? pages : queries;
  const clicks = base.reduce((a, r) => a + r.clicks, 0), impressions = base.reduce((a, r) => a + r.impressions, 0);
  const top = (rows: GscRow[]) => [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).map((r) => ({ key: r.key, language: r.language, clicks: r.clicks, impressions: r.impressions, ctr: ctrOf(r.clicks, r.impressions), position: r.position }));
  return { clicks, impressions, ctr: ctrOf(clicks, impressions), position: wPos(base), basis: pages.length ? ("pages" as const) : queries.length ? ("queries" as const) : null, topQueries: top(queries), topPages: top(pages) };
}

/* ---------------- optimisation points ---------------- */

/** Typical organic CTR by position (conservative curve from public CTR studies), used only as a yardstick. */
export function expectedCtr(position: number): number {
  const p = Math.max(1, Math.round(position));
  const curve = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
  return p <= 10 ? curve[p - 1] : p <= 20 ? 0.01 : 0.003;
}
export const DEFAULT_BRAND_TERMS = ["valemont", "30/30", "3030", "30 30", "trente trente", "treinta treinta"];
export const isBrandQuery = (q: string, terms = DEFAULT_BRAND_TERMS) => terms.some((t) => q.toLowerCase().includes(t.toLowerCase()));

export interface SeoPoint { kind: "quick_win" | "low_ctr" | "no_clicks" | "language_gap" | "brand"; severity: "act" | "watch" | "good"; key: string; vars: Record<string, string | number>; action: string; target: string }
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };

export function seoOpportunities(snapshot: GscRow[], o: { brandTerms?: string[]; minImpressions?: number; max?: number } = {}): SeoPoint[] {
  const min = o.minImpressions ?? 50;
  const out: SeoPoint[] = [];
  const queries = snapshot.filter((r) => r.dimension === "query"), pages = snapshot.filter((r) => r.dimension === "page");
  // Quick wins: page 1 bottom or page 2, already seen often.
  for (const r of queries.filter((x) => x.position >= 4 && x.position <= 20 && x.impressions >= min).sort((a, b) => b.impressions - a.impressions).slice(0, 5)) {
    out.push({ kind: "quick_win", severity: "act", key: "“{q}” ({lang}): position {p}, {i} impressions.", vars: { q: r.key, lang: r.language, p: Math.round(r.position * 10) / 10, i: r.impressions }, action: "Quick win: put the exact phrase in the title and the H1 of the page that ranks, add a short FAQ answering it and two internal links to that page.", target: r.key });
  }
  // CTR well below what the position usually gets: the title/description does not make people click.
  const wins = new Set(out.map((x) => x.target));
  for (const r of [...pages, ...queries].filter((x) => !wins.has(x.key) && x.impressions >= 100 && x.position > 0 && x.position <= 10 && x.clicks / x.impressions < expectedCtr(x.position) * 0.5).sort((a, b) => b.impressions - a.impressions).slice(0, 4)) {
    out.push({ kind: "low_ctr", severity: "act", key: "{target}: CTR {c}% at position {p} (usually about {e}%).", vars: { target: r.dimension === "page" ? pathOf(r.key) : `“${r.key}”`, c: Math.round((r.clicks / r.impressions) * 1000) / 10, p: Math.round(r.position * 10) / 10, e: Math.round(expectedCtr(r.position) * 1000) / 10 }, action: "Rewrite the title (50–60 characters, the query first, a concrete promise) and the meta description (120–155 characters, a call to action).", target: r.key });
  }
  for (const r of pages.filter((x) => x.impressions >= min && x.clicks === 0).sort((a, b) => b.impressions - a.impressions).slice(0, 3)) {
    out.push({ kind: "no_clicks", severity: "watch", key: "{page}: {i} impressions and no click.", vars: { page: pathOf(r.key), i: r.impressions }, action: "Check which queries show this page in Search Console and make its title answer them, or point them to a better page.", target: r.key });
  }
  // FR vs ES coverage.
  const imp = (l: SeoLang) => snapshot.filter((r) => r.language === l && r.dimension === (pages.length ? "page" : "query")).reduce((a, r) => a + r.impressions, 0);
  const fr = imp("FR"), es = imp("ES");
  if (fr + es > 0) {
    const [hi, lo, hiN, loN] = fr >= es ? (["FR", "ES", fr, es] as const) : (["ES", "FR", es, fr] as const);
    if (loN === 0) out.push({ kind: "language_gap", severity: "watch", key: "No {lo} Search Console data: the {lo} site is invisible here.", vars: { lo, hi }, action: "Import the Queries and Pages export of the {lo} property, or check that the {lo} pages are indexed.", target: lo });
    else if (hiN >= loN * 5) out.push({ kind: "language_gap", severity: "watch", key: "{hi} gets {n} times more impressions than {lo}.", vars: { hi, lo, n: Math.round(hiN / loN) }, action: "Translate the {hi} pages that rank into {lo} (same service, local city names), with hreflang links between them.", target: lo });
    // Pages that exist in one language only (same path with /fr/ ↔ /es/).
    const paths = (l: SeoLang) => new Set(pages.filter((r) => r.language === l).map((r) => pathOf(r.key)));
    const frP = paths("FR"), esP = paths("ES");
    const missing = [...frP].filter((p) => /\/fr(\/|$)/.test(p) && esP.size && !esP.has(p.replace(/\/fr(\/|$)/, "/es$1"))).slice(0, 3);
    for (const p of missing) out.push({ kind: "language_gap", severity: "watch", key: "{page} has no Spanish version in the results.", vars: { page: p }, action: "Publish the Spanish version and link both with hreflang fr/es.", target: p });
  }
  // Brand vs non-brand.
  const clicks = queries.reduce((a, r) => a + r.clicks, 0);
  if (clicks >= 20) {
    const brand = queries.filter((r) => isBrandQuery(r.key, o.brandTerms)).reduce((a, r) => a + r.clicks, 0);
    const share = brand / clicks;
    if (share >= 0.7) out.push({ kind: "brand", severity: "act", key: "{p}% of search clicks come from people who already know the brand.", vars: { p: Math.round(share * 100) }, action: "Write one page per service and trade/city (e.g. “site web plombier Lyon”) so new prospects find you.", target: "brand" });
    else out.push({ kind: "brand", severity: "good", key: "{p}% of search clicks come from non-brand searches.", vars: { p: Math.round((1 - share) * 100) }, action: "Keep publishing pages per service and trade.", target: "brand" });
  }
  const rank = { act: 0, watch: 1, good: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, o.max ?? 10);
}

/* ---------------- site audit (pure checks) ---------------- */

export interface PageAudit {
  url: string; status: number; bytes: number; title: string; metaDescription: string; h1Count: number; canonical: string;
  hreflang: string[]; og: boolean; structuredTypes: string[]; images: number; imagesWithoutAlt: number; noindex: boolean;
}
const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x !== undefined) ?? null;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];

/** Reads what the checks need from one HTML page (regex-based, tolerant; scripts and comments are ignored). */
export function auditHtml(html: string, url: string, status = 200): PageAudit {
  const bytes = new TextEncoder().encode(html).length;
  const ldBlocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const head = /<head\b[\s\S]*?<\/head>/i.exec(clean)?.[0] ?? clean;
  const metas = tags(head, "meta");
  const meta = (n: string) => metas.find((m) => (attr(m, "name") ?? attr(m, "property") ?? "").toLowerCase() === n);
  const links = tags(head, "link");
  const rel = (l: string) => (attr(l, "rel") ?? "").toLowerCase();
  const types = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const t = (v as Record<string, unknown>)["@type"];
      for (const x of Array.isArray(t) ? t : [t]) if (typeof x === "string") types.add(x);
      for (const x of Object.values(v)) if (x && typeof x === "object") walk(x);
    }
  };
  for (const b of ldBlocks) { try { walk(JSON.parse(b)); } catch { /* invalid JSON-LD is reported as missing */ } }
  const imgs = tags(clean, "img");
  const robots = (attr(meta("robots") ?? "", "content") ?? "").toLowerCase();
  return {
    url, status, bytes,
    title: decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? ""),
    metaDescription: decode(attr(meta("description") ?? "", "content") ?? ""),
    h1Count: tags(clean, "h1").length,
    canonical: attr(links.find((l) => rel(l) === "canonical") ?? "", "href") ?? "",
    hreflang: links.filter((l) => rel(l) === "alternate" && attr(l, "hreflang")).map((l) => attr(l, "hreflang")!.toLowerCase()),
    og: Boolean(meta("og:title")) && Boolean(meta("og:description") || meta("og:image")),
    structuredTypes: [...types].sort(),
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((i) => { const a = attr(i, "alt"); return a === null; }).length,
    noindex: /noindex/.test(robots),
  };
}

export type IssueCode =
  | "fetch_error" | "noindex" | "title_missing" | "title_short" | "title_long" | "meta_missing" | "meta_short" | "meta_long" | "h1_missing" | "h1_multiple"
  | "canonical_missing" | "hreflang_missing" | "hreflang_pair" | "og_missing" | "images_alt" | "heavy_page"
  | "robots_missing" | "sitemap_missing" | "org_schema_missing" | "faq_schema_missing" | "llms_missing";
export interface SeoIssue { code: IssueCode; severity: "act" | "watch"; page: string; vars: Record<string, string | number> }

/** Issue code → English sentence (UI key) and the fix. */
export const ISSUE_TEXT: Record<IssueCode, [string, string]> = {
  fetch_error: ["Page could not be read ({detail}).", "Check that the page is online over https and answers in under 10 seconds."],
  noindex: ["Page is marked noindex: Google will not show it.", "Remove the noindex robots tag if this page should be found."],
  title_missing: ["No title tag.", "Add a title of 50–60 characters: service + city/trade + brand."],
  title_short: ["Title too short ({n} characters).", "Aim for 50–60 characters: service + city/trade + brand."],
  title_long: ["Title too long ({n} characters): Google cuts it.", "Shorten to 60 characters, the key phrase first."],
  meta_missing: ["No meta description.", "Write 120–155 characters with the promise and a call to action."],
  meta_short: ["Meta description too short ({n} characters).", "Write 120–155 characters with the promise and a call to action."],
  meta_long: ["Meta description too long ({n} characters).", "Cut to 155 characters."],
  h1_missing: ["No H1 heading.", "Add one H1 that says the service and the city or trade."],
  h1_multiple: ["{n} H1 headings.", "Keep a single H1; turn the others into H2."],
  canonical_missing: ["No canonical link.", "Add <link rel=\"canonical\"> pointing to the page's own https URL."],
  hreflang_missing: ["No hreflang FR/ES links.", "Add hreflang fr, es and x-default links between the two language versions."],
  hreflang_pair: ["hreflang lists {have} but not {miss}.", "Add the missing language version and link both ways."],
  og_missing: ["No Open Graph tags.", "Add og:title, og:description and og:image so shares on LinkedIn and WhatsApp show a preview."],
  images_alt: ["{n} image(s) without alt text.", "Describe each image in a few words (alt), with the trade or city when relevant."],
  heavy_page: ["Heavy page: {kb} KB of HTML.", "Remove inline scripts and unused sections; keep HTML under 300 KB."],
  robots_missing: ["No robots.txt.", "Publish /robots.txt with the sitemap address."],
  sitemap_missing: ["No sitemap.xml.", "Publish /sitemap.xml listing every page (FR and ES) and submit it in Search Console."],
  org_schema_missing: ["No Organization or LocalBusiness structured data.", "Add Organization (or LocalBusiness) JSON-LD on the home page: name, logo, url, sameAs (LinkedIn, Instagram)."],
  faq_schema_missing: ["No FAQ structured data on any page.", "Add a short FAQ (3–5 real questions) with FAQPage JSON-LD on the service pages."],
  llms_missing: ["No llms.txt.", "Publish /llms.txt: who you are, services, cities, prices, contact, links to the key pages."],
};

const pathLabel = (u: string) => { try { const x = new URL(u); return x.pathname + x.search || "/"; } catch { return u; } };

/** Issues of one page, most important first. */
export function pageIssues(p: PageAudit): SeoIssue[] {
  const page = pathLabel(p.url);
  const out: SeoIssue[] = [];
  const add = (code: IssueCode, severity: "act" | "watch", vars: Record<string, string | number> = {}) => out.push({ code, severity, page, vars });
  if (p.status < 200 || p.status >= 400) { add("fetch_error", "act", { detail: `HTTP ${p.status}` }); return out; }
  if (p.noindex) add("noindex", "act");
  const tl = [...p.title].length, ml = [...p.metaDescription].length;
  if (!tl) add("title_missing", "act"); else if (tl < 30) add("title_short", "watch", { n: tl }); else if (tl > 60) add("title_long", "watch", { n: tl });
  if (!ml) add("meta_missing", "act"); else if (ml < 70) add("meta_short", "watch", { n: ml }); else if (ml > 160) add("meta_long", "watch", { n: ml });
  if (p.h1Count === 0) add("h1_missing", "act"); else if (p.h1Count > 1) add("h1_multiple", "watch", { n: p.h1Count });
  if (!p.canonical) add("canonical_missing", "watch");
  const langs = new Set(p.hreflang.map((h) => h.slice(0, 2)));
  if (!p.hreflang.length) add("hreflang_missing", "watch");
  else if (langs.has("fr") !== langs.has("es")) add("hreflang_pair", "watch", { have: langs.has("fr") ? "fr" : "es", miss: langs.has("fr") ? "es" : "fr" });
  if (!p.og) add("og_missing", "watch");
  if (p.imagesWithoutAlt) add("images_alt", "watch", { n: p.imagesWithoutAlt });
  if (p.bytes > 300_000) add("heavy_page", "watch", { kb: Math.round(p.bytes / 1024) });
  return out;
}

export interface SiteFacts { robots: boolean; sitemap: boolean; llms: boolean }
/** Site-wide checks: robots.txt, sitemap.xml, llms.txt, Organization/LocalBusiness and FAQ structured data on at least one page. */
export function siteIssues(pages: PageAudit[], f: SiteFacts, home = "/"): SeoIssue[] {
  const out: SeoIssue[] = [];
  const types = new Set(pages.flatMap((p) => p.structuredTypes));
  if (!f.robots) out.push({ code: "robots_missing", severity: "watch", page: "/robots.txt", vars: {} });
  if (!f.sitemap) out.push({ code: "sitemap_missing", severity: "act", page: "/sitemap.xml", vars: {} });
  if (pages.length && ![...types].some((t) => /^(Organization|LocalBusiness|ProfessionalService|Corporation)$/.test(t) || /Business$/.test(t))) out.push({ code: "org_schema_missing", severity: "act", page: home, vars: {} });
  if (pages.length && !types.has("FAQPage")) out.push({ code: "faq_schema_missing", severity: "watch", page: home, vars: {} });
  if (!f.llms) out.push({ code: "llms_missing", severity: "watch", page: "/llms.txt", vars: {} });
  return out;
}

/** Page URLs listed in a sitemap (or child sitemaps of a sitemap index), same host only. */
export function sitemapUrls(xml: string, host: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  const same = locs.filter((u) => { try { const x = new URL(u); return x.protocol === "https:" && x.host === host; } catch { return false; } });
  const isIndex = /<sitemapindex\b/i.test(xml);
  return isIndex ? { pages: [], sitemaps: same } : { pages: same, sitemaps: [] };
}

/** "Visible in AI engines" checklist from the last audit and the AI-engine visits. */
export function aiChecklist(a: { pages: PageAudit[]; facts: SiteFacts } | null, aiVisits: number) {
  const types = new Set(a?.pages.flatMap((p) => p.structuredTypes) ?? []);
  const servicePages = a ? a.pages.filter((p) => { try { return new URL(p.url).pathname.split("/").filter(Boolean).filter((s) => !/^(fr|es)$/.test(s)).length >= 1; } catch { return false; } }).length : 0;
  const st = (v: boolean | null) => (v === null ? ("unknown" as const) : v ? ("ok" as const) : ("todo" as const));
  return [
    { key: "FAQ structured data on the service pages", status: st(a ? types.has("FAQPage") : null), hint: "AI engines quote short question–answer blocks." },
    { key: "One clear page per service and city or trade", status: st(a ? servicePages >= 3 : null), hint: "{n} page(s) other than the home page found in the audit.", n: servicePages },
    { key: "Organization / LocalBusiness data (name, city, sameAs)", status: st(a ? [...types].some((t) => /^(Organization|LocalBusiness|ProfessionalService)$/.test(t)) : null), hint: "Lets AI engines tie the site to Valemont and its profiles." },
    { key: "llms.txt published", status: st(a ? a.facts.llms : null), hint: "A plain summary for AI crawlers: services, cities, prices, contact." },
    { key: "Cited elsewhere (directories, Google Business Profile, articles)", status: "unknown" as const, hint: "Check by hand: AI engines repeat what other sites say about you." },
    { key: "Visits from AI engines in this period", status: aiVisits > 0 ? ("ok" as const) : ("todo" as const), hint: "{n} visit(s) from ChatGPT, Perplexity, Claude, Gemini… (GA4).", n: aiVisits },
  ];
}
