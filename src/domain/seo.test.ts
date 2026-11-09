import { describe, expect, it } from "vitest";
import { aiChecklist, auditHtml, expectedCtr, latestSnapshot, mapSearchConsoleGrid, pageIssues, seoOpportunities, seoSummary, siteIssues, sitemapUrls, type GscRow } from "./seo";

const GOOD = `<!doctype html><html lang="fr"><head>
<title>Site web pour plombiers à Lyon | Valemont</title>
<meta name="description" content="Un site qui répond aux appels manqués et prend les rendez-vous de votre entreprise de plomberie à Lyon. Démo gratuite en 15 minutes.">
<link rel="canonical" href="https://www.example.com/fr/plombiers-lyon">
<link rel="alternate" hreflang="fr" href="https://www.example.com/fr/plombiers-lyon">
<link rel="alternate" hreflang="es" href="https://www.example.com/es/fontaneros-lyon">
<meta property="og:title" content="Valemont"><meta property="og:image" content="https://www.example.com/og.png">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LocalBusiness","name":"Valemont"},{"@type":"FAQPage","mainEntity":[]}]}</script>
</head><body><h1>Site web pour plombiers</h1><img src="a.png" alt="Plombier à Lyon"><!-- <h1>old</h1> --></body></html>`;
const BAD = `<html><head><title>Accueil</title><meta name="robots" content="noindex, follow"></head>
<body><h1>A</h1><h1>B</h1><img src="x.png"><img src="y.png" alt=""></body></html>`;

describe("auditHtml / pageIssues", () => {
  it("reads a well-built page without issues", () => {
    const a = auditHtml(GOOD, "https://www.example.com/fr/plombiers-lyon");
    expect(a.h1Count).toBe(1);
    expect(a.hreflang).toEqual(["fr", "es"]);
    expect(a.structuredTypes).toEqual(["FAQPage", "LocalBusiness"]);
    expect(a.og).toBe(true);
    expect(a.imagesWithoutAlt).toBe(0);
    expect(pageIssues(a)).toEqual([]);
  });
  it("lists one actionable issue per problem with the page", () => {
    const codes = pageIssues(auditHtml(BAD, "https://www.example.com/")).map((i) => i.code);
    expect(codes).toEqual(["noindex", "title_short", "meta_missing", "h1_multiple", "canonical_missing", "hreflang_missing", "og_missing", "images_alt"]);
    expect(pageIssues(auditHtml(BAD, "https://www.example.com/"))[0].page).toBe("/");
  });
  it("flags a one-sided hreflang and heavy pages", () => {
    const html = GOOD.replace(/<link rel="alternate" hreflang="es"[^>]*>/, "") + "x".repeat(310_000);
    const codes = pageIssues(auditHtml(html, "https://www.example.com/fr")).map((i) => i.code);
    expect(codes).toContain("hreflang_pair");
    expect(codes).toContain("heavy_page");
  });
  it("reports unreachable pages only once", () => {
    expect(pageIssues({ ...auditHtml("", "https://www.example.com/x"), status: 404 }).map((i) => i.code)).toEqual(["fetch_error"]);
  });
});

describe("site checks", () => {
  it("needs robots, sitemap, llms.txt, organisation and FAQ data", () => {
    const bad = auditHtml(BAD, "https://www.example.com/");
    expect(siteIssues([bad], { robots: false, sitemap: false, llms: false }).map((i) => i.code)).toEqual(["robots_missing", "sitemap_missing", "org_schema_missing", "faq_schema_missing", "llms_missing"]);
    expect(siteIssues([auditHtml(GOOD, "https://www.example.com/")], { robots: true, sitemap: true, llms: true })).toEqual([]);
  });
  it("reads same-host https pages from a sitemap and child sitemaps from an index", () => {
    const xml = `<urlset><url><loc>https://www.example.com/fr</loc></url><url><loc>https://other.example.org/x</loc></url><url><loc>http://www.example.com/insecure</loc></url></urlset>`;
    expect(sitemapUrls(xml, "www.example.com")).toEqual({ pages: ["https://www.example.com/fr"], sitemaps: [] });
    expect(sitemapUrls(`<sitemapindex><sitemap><loc>https://www.example.com/s1.xml</loc></sitemap></sitemapindex>`, "www.example.com").sitemaps).toEqual(["https://www.example.com/s1.xml"]);
  });
  it("builds the AI engines checklist", () => {
    const list = aiChecklist({ pages: [auditHtml(GOOD, "https://www.example.com/fr/plombiers-lyon")], facts: { robots: true, sitemap: true, llms: false } }, 12);
    expect(list.map((x) => x.status)).toEqual(["ok", "todo", "ok", "todo", "unknown", "ok"]);
    expect(aiChecklist(null, 0)[0].status).toBe("unknown");
  });
});

describe("Search Console", () => {
  const meta = { language: "FR" as const, period_start: "2026-08-01", period_end: "2026-10-31" };
  it("maps the French Queries export (comma decimals, % CTR)", () => {
    const grid = [["Requêtes les plus fréquentes", "Clics", "Impressions", "CTR", "Position"], ["Site Web Plombier Lyon", "12", "1 340", "0,9 %", "8,4"], ["valemont", "40", "120", "33,3 %", "1,2"], ["", "", "", "", ""]];
    const r = mapSearchConsoleGrid(grid, meta);
    expect(r.dimension).toBe("query");
    expect(r.rows[0]).toMatchObject({ key: "site web plombier lyon", clicks: 12, impressions: 1340, position: 8.4 });
    expect(r.rows).toHaveLength(2);
  });
  it("maps the Spanish and English Pages exports", () => {
    expect(mapSearchConsoleGrid([["Páginas principales", "Clics", "Impresiones", "CTR", "Posición"], ["https://www.example.com/es", "3", "90", "3.3%", "11.2"]], { ...meta, language: "ES" }).rows[0]).toMatchObject({ dimension: "page", impressions: 90, position: 11.2 });
    expect(mapSearchConsoleGrid([["Top pages", "Clicks", "Impressions", "CTR", "Position"], ["https://www.example.com/", "1,234", "20,000", "6.2%", "4.5"]], meta).rows[0]).toMatchObject({ clicks: 1234, impressions: 20000 });
    expect(mapSearchConsoleGrid([["Foo"]], meta).error).toBeTruthy();
  });

  const row = (p: Partial<GscRow>): GscRow => ({ language: "FR", dimension: "query", key: "q", clicks: 0, impressions: 0, position: 5, period_start: "2026-10-01", period_end: "2026-10-31", ...p });
  it("keeps the latest period per language and weights the position by impressions", () => {
    const rows = [row({ period_end: "2026-09-30", period_start: "2026-09-01", clicks: 99, impressions: 999, dimension: "page", key: "old" }), row({ dimension: "page", key: "https://www.example.com/a", clicks: 10, impressions: 100, position: 2 }), row({ dimension: "page", key: "https://www.example.com/b", clicks: 0, impressions: 300, position: 10 }), row({ key: "x", clicks: 5, impressions: 50 })];
    const snap = latestSnapshot(rows);
    expect(snap.periods).toEqual([{ language: "FR", from: "2026-10-01", to: "2026-10-31" }]);
    const s = seoSummary(snap.rows);
    expect(s.basis).toBe("pages");
    expect(s.clicks).toBe(10);
    expect(s.impressions).toBe(400);
    expect(s.position).toBe(8);
    expect(s.topQueries[0].key).toBe("x");
  });
  it("finds quick wins, low CTR, pages without clicks, language gaps and brand share", () => {
    const snap = [
      row({ key: "site web plombier lyon", impressions: 800, clicks: 6, position: 8.4 }),
      row({ key: "valemont", impressions: 100, clicks: 30, position: 1.1 }),
      row({ key: "agence web artisan", impressions: 400, clicks: 1, position: 3 }),
      row({ dimension: "page", key: "https://www.example.com/fr/tarifs", impressions: 200, clicks: 0, position: 14 }),
      row({ dimension: "page", key: "https://www.example.com/fr/plombiers", impressions: 900, clicks: 40, position: 6 }),
    ];
    const o = seoOpportunities(snap);
    const kinds = o.map((x) => x.kind);
    expect(kinds).toContain("quick_win");
    expect(o.find((x) => x.kind === "quick_win")?.target).toBe("site web plombier lyon");
    expect(o.filter((x) => x.kind === "low_ctr").map((x) => x.target)).toContain("agence web artisan");
    expect(o.find((x) => x.kind === "no_clicks")?.target).toBe("https://www.example.com/fr/tarifs");
    expect(o.find((x) => x.kind === "language_gap")?.vars.lo).toBe("ES");
    expect(o.find((x) => x.kind === "brand")).toMatchObject({ severity: "act" });
  });
  it("uses a decreasing expected CTR curve", () => {
    expect(expectedCtr(1)).toBeGreaterThan(expectedCtr(3));
    expect(expectedCtr(15)).toBe(0.01);
  });
});
