import type { DataRepository } from "@/data/repository";
import { childId } from "@/lib/ids";
import { auditHtml, pageIssues, siteIssues } from "@/domain/seo";
import { addDays } from "@/domain/time";
import type { Fetcher } from "./seo";

/**
 * DEMO and browser preview only (D072): a small fictional site on www.example.com, Search Console rows for FR and ES,
 * a first audit and two done site/content tasks, so Growth › Web › SEO and the cost per channel have something to show.
 * Never used in LIVE: the live audit fetches the configured site with `httpFetcher`.
 */
const H = "https://www.example.com";
const page = (o: { lang: string; title: string; desc?: string; h1s: string[]; alt?: string[]; hreflang?: boolean; ld?: string; canonical?: string }) => `<!doctype html><html lang="${o.lang}"><head>
<title>${o.title}</title>${o.desc ? `<meta name="description" content="${o.desc}">` : ""}
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ""}
${o.hreflang ? `<link rel="alternate" hreflang="fr" href="${H}/fr"><link rel="alternate" hreflang="es" href="${H}/es">` : ""}
${o.ld ? `<script type="application/ld+json">${o.ld}</script>` : ""}
</head><body>${o.h1s.map((h) => `<h1>${h}</h1>`).join("")}${(o.alt ?? []).map((a) => (a ? `<img src="i.png" alt="${a}">` : `<img src="i.png">`)).join("")}</body></html>`;

export const DEMO_SITE: Record<string, string> = {
  [`${H}/robots.txt`]: `User-agent: *\nAllow: /\nSitemap: ${H}/sitemap.xml\n`,
  [`${H}/sitemap.xml`]: `<?xml version="1.0"?><urlset><url><loc>${H}/fr</loc></url><url><loc>${H}/fr/plombiers-lyon</loc></url><url><loc>${H}/fr/tarifs</loc></url><url><loc>${H}/es</loc></url><url><loc>${H}/es/fontaneros-madrid</loc></url></urlset>`,
  [`${H}/fr`]: page({ lang: "fr", title: "Valemont | Sites web et IA pour artisans en France et en Espagne", desc: "Valemont crée des sites qui répondent aux appels manqués et prennent les rendez-vous des artisans. Démo gratuite en 15 minutes.", h1s: ["Votre site répond quand vous êtes sur un chantier"], alt: ["Artisan au téléphone", ""], hreflang: true, canonical: `${H}/fr`, ld: `{"@context":"https://schema.org","@type":"Organization","name":"Valemont (demo)","url":"${H}"}` }),
  [`${H}/fr/plombiers-lyon`]: page({ lang: "fr", title: "Site web plombier Lyon", desc: "Un site pour plombiers à Lyon.", h1s: ["Site web pour plombiers", "Nos offres"], alt: [""], canonical: `${H}/fr/plombiers-lyon` }),
  [`${H}/fr/tarifs`]: page({ lang: "fr", title: "Tarifs", h1s: ["Tarifs"], hreflang: true }),
  [`${H}/es`]: page({ lang: "es", title: "Valemont | Webs e IA para profesionales en España y Francia", desc: "Valemont crea webs que contestan las llamadas perdidas y reservan las citas de los profesionales. Demo gratis en 15 minutos.", h1s: ["Tu web contesta cuando estás en la obra"], hreflang: true, canonical: `${H}/es` }),
  [`${H}/es/fontaneros-madrid`]: page({ lang: "es", title: "Web para fontaneros en Madrid | Valemont", desc: "Webs para fontaneros en Madrid que reservan citas solas, con seguimiento por WhatsApp y llamadas perdidas recuperadas.", h1s: ["Webs para fontaneros en Madrid"], hreflang: true, canonical: `${H}/es/fontaneros-madrid` }),
};

/** Serves DEMO_SITE from memory (404 for anything else): no network in DEMO or in the preview. */
export const demoSiteFetcher: Fetcher = async (url) => {
  const key = url.replace(/\/$/, "");
  const text = DEMO_SITE[key];
  return text === undefined ? { status: 404, url, text: "" } : { status: 200, url, text };
};

export async function seedDemoSeo(repo: DataRepository, today: string) {
  const sys = { founder: "system" };
  await repo.insert("SystemSettings", [
    { id: childId("setting", "website_url_fr"), key: "website_url_fr", value: `${H}/fr`, description: "French website address (https)." },
    { id: childId("setting", "website_url_es"), key: "website_url_es", value: `${H}/es`, description: "Spanish website address (https)." },
  ], sys);
  const start = addDays(today, -90), end = addDays(today, -2);
  const q = (language: "FR" | "ES", dimension: "query" | "page", key: string, clicks: number, impressions: number, pos: number) => ({
    id: childId("gsc", language, start, end, dimension, key), period_start: start, period_end: end, language, dimension, key, clicks, impressions, position_x10: Math.round(pos * 10), origin: "import" as const, import_file: "demo-gsc.csv",
  });
  await repo.insert("SearchConsoleRows", [
    q("FR", "query", "valemont", 46, 130, 1.2), q("FR", "query", "site web plombier lyon", 9, 1_240, 8.6), q("FR", "query", "site internet artisan prise de rendez-vous", 4, 610, 12.4),
    q("FR", "query", "agence web artisan", 2, 480, 4.1), q("FR", "query", "répondeur intelligent artisan", 6, 220, 6.3), q("FR", "query", "30/30 ia formation", 18, 90, 2.0),
    q("FR", "page", `${H}/fr`, 64, 820, 5.2), q("FR", "page", `${H}/fr/plombiers-lyon`, 12, 1_560, 9.1), q("FR", "page", `${H}/fr/tarifs`, 0, 240, 14.2),
    q("ES", "query", "valemont", 8, 25, 1.4), q("ES", "query", "web para fontaneros", 1, 140, 17.5),
    q("ES", "page", `${H}/es`, 9, 120, 9.4), q("ES", "page", `${H}/es/fontaneros-madrid`, 1, 95, 16.8),
  ], sys);
  // A first audit, computed from the demo pages with the same pure checks as a real run.
  const pages = Object.entries(DEMO_SITE).filter(([u]) => !/\.(txt|xml)$/.test(u)).map(([u, html]) => auditHtml(html, u));
  const facts = { robots: true, sitemap: true, llms: false };
  const issues = [...siteIssues(pages, facts), ...pages.flatMap(pageIssues)];
  const run_at = new Date(Date.parse(`${addDays(today, -3)}T09:00:00.000Z`)).toISOString();
  await repo.insert("SeoAudits", [{
    id: childId("seo-audit", "demo"), run_at, founder_key: "theo", site_urls: `${H}/fr ${H}/es`, pages_checked: pages.length, facts,
    pages: pages.map((p) => ({ url: p.url, status: p.status, bytes: p.bytes, titleLength: [...p.title].length, metaLength: [...p.metaDescription].length, h1Count: p.h1Count, canonical: Boolean(p.canonical), hreflang: p.hreflang, og: p.og, types: p.structuredTypes, imagesWithoutAlt: p.imagesWithoutAlt, noindex: p.noindex })),
    issues,
  }], sys);
  // Done work that costs time: one site task (web/SEO) and one content task, so social and web are never "free".
  const done = `${addDays(today, -4)}T16:00:00.000Z`;
  const task = (k: string, title: string, area: "marketing" | "ops", owner: "theo" | "pablo", min: number) => ({
    id: childId("demo-task-seo", k), title, description: "", owner, created_by_founder: owner, account_id: "", opportunity_id: "", project_id: "", client_id: "",
    priority: "P2" as const, status: "done" as const, estimated_minutes: min, due_at: addDays(today, -4), recurrence: "none", recurrence_parent_id: "", dependency_ids: [], completion_evidence: "",
    completed_at: done, visibility: "team" as const, snoozed_until: null, snooze_reason: "", source: "manual", source_id: "", area,
  });
  await repo.insert("Tasks", [task("site", "Réécrire la page plombiers Lyon (SEO)", "ops", "theo", 120), task("content", "Grabar 2 reels Instagram 30/30 (ES)", "marketing", "pablo", 90)] as never, sys);
}
