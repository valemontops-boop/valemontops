/** Marketing decisions (pure): traffic sources, funnels per brand, audience vs target markets, recommendations. */

const COUNTRY: Record<string, string> = {
  france: "FR", fr: "FR", spain: "ES", "españa": "ES", espana: "ES", es: "ES", espagne: "ES", belgium: "BE", belgique: "BE", switzerland: "CH", suisse: "CH",
  "united states": "US", usa: "US", "united kingdom": "GB", uk: "GB", morocco: "MA", maroc: "MA", mexico: "MX", "méxico": "MX", argentina: "AR",
  colombia: "CO", portugal: "PT", italy: "IT", italia: "IT", germany: "DE", deutschland: "DE", canada: "CA", algeria: "DZ", tunisia: "TN", chile: "CL", peru: "PE",
};
/** "Paris Area, France" / "France" / "ES" -> ISO-2 when known, else the cleaned name. */
export function countryCode(v: string): string {
  const last = v.split(",").pop()!.trim();
  if (/^[A-Z]{2}$/.test(last)) return last;
  return COUNTRY[last.toLowerCase()] ?? last;
}

export interface TrafficRow { date: string; brand: string | null; source: string; medium: string; campaign: string; country: string; sessions: number | null; leads: number | null; meetings: number | null; purchases: number | null; revenue_minor: number | null }

export function bySource(rows: TrafficRow[]) {
  const m = new Map<string, { source: string; medium: string; sessions: number; leads: number; purchases: number; revenue_minor: number }>();
  for (const r of rows) {
    const k = `${r.source}|${r.medium}`;
    const g = m.get(k) ?? { source: r.source, medium: r.medium, sessions: 0, leads: 0, purchases: 0, revenue_minor: 0 };
    g.sessions += r.sessions ?? 0; g.leads += r.leads ?? 0; g.purchases += r.purchases ?? 0; g.revenue_minor += r.revenue_minor ?? 0;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, conversion: g.sessions ? (g.leads + g.purchases) / g.sessions : null })).sort((a, b) => b.sessions - a.sessions);
}

export function byCountry(rows: TrafficRow[]) {
  const m = new Map<string, { country: string; sessions: number; conversions: number }>();
  for (const r of rows) {
    const k = r.country ? countryCode(r.country) : "Unknown";
    const g = m.get(k) ?? { country: k, sessions: 0, conversions: 0 };
    g.sessions += r.sessions ?? 0; g.conversions += (r.leads ?? 0) + (r.purchases ?? 0);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.sessions - a.sessions);
}

/** Share of an audience inside the brand's target markets, from the latest country breakdown. */
export function audienceFit(breakdown: { key: string; value: number }[], targets: string[]) {
  const total = breakdown.reduce((s, b) => s + b.value, 0);
  if (!total) return null;
  const rows = breakdown.map((b) => ({ country: countryCode(b.key), share: b.value / total })).reduce((m, r) => m.set(r.country, (m.get(r.country) ?? 0) + r.share), new Map<string, number>());
  const sorted = [...rows.entries()].map(([country, share]) => ({ country, share, target: targets.includes(country) })).sort((a, b) => b.share - a.share);
  return { inTarget: sorted.filter((r) => r.target).reduce((s, r) => s + r.share, 0), countries: sorted };
}

export interface Insight { severity: "act" | "watch" | "good"; title: string; evidence: string; action: string }

/**
 * Deterministic recommendations with their evidence (no AI, no invented numbers).
 * Thresholds are conservative to avoid conclusions from tiny samples.
 */
export function recommendations(i: {
  sources: ReturnType<typeof bySource>;
  fits: { account: string; fit: ReturnType<typeof audienceFit>; targets: string[] }[];
  content: { label: string; done: number; target: number }[];
  minSessions?: number;
}): Insight[] {
  const out: Insight[] = [];
  const min = i.minSessions ?? 30;
  for (const f of i.fits) {
    if (!f.fit) continue;
    const pct = Math.round(f.fit.inTarget * 100);
    if (f.fit.inTarget < 0.6) out.push({ severity: "act", title: `${f.account}: only ${pct}% of the audience is in ${f.targets.join(" + ")}`, evidence: `Top countries: ${f.fit.countries.slice(0, 3).map((c) => `${c.country} ${Math.round(c.share * 100)}%`).join(", ")}`, action: `Post in the language of your target market and use local hashtags and places; avoid content that travels outside ${f.targets.join("/")}.` });
    else out.push({ severity: "good", title: `${f.account}: ${pct}% of the audience is in your target markets`, evidence: f.fit.countries.slice(0, 3).map((c) => `${c.country} ${Math.round(c.share * 100)}%`).join(", "), action: "Keep the current targeting." });
    for (const t of f.targets) {
      const s = f.fit.countries.find((c) => c.country === t)?.share ?? 0;
      if (f.targets.length > 1 && s < 0.2) out.push({ severity: "watch", title: `${f.account}: ${t} is under-reached (${Math.round(s * 100)}% of the audience)`, evidence: `${f.targets.join(" and ")} are both target markets`, action: `Publish more ${t === "ES" ? "Spanish" : "French"} versions and ask the ${t === "ES" ? "Spanish" : "French"} founder to share them.` });
    }
  }
  const eligible = i.sources.filter((s) => s.sessions >= min && s.conversion !== null);
  if (eligible.length >= 2) {
    const total = eligible.reduce((a, s) => ({ s: a.s + s.sessions, c: a.c + (s.leads + s.purchases) }), { s: 0, c: 0 });
    const avg = total.c / total.s;
    const best = [...eligible].sort((a, b) => b.conversion! - a.conversion!)[0];
    if (best.conversion! > avg * 1.3) out.push({ severity: "act", title: `${best.source} / ${best.medium || "—"} converts best`, evidence: `${Math.round(best.conversion! * 1000) / 10}% of sessions convert vs ${Math.round(avg * 1000) / 10}% on average (${best.sessions} sessions)`, action: `Put more of next week's content effort into ${best.source}.` });
  }
  for (const s of i.sources.filter((x) => x.sessions >= Math.max(min, 50) && x.leads + x.purchases === 0)) {
    out.push({ severity: "act", title: `${s.source} brings visits but no leads`, evidence: `${s.sessions} sessions, 0 leads or purchases`, action: "Check the link destination, the call to action and the form for this source." });
  }
  if (!i.sources.length) out.push({ severity: "watch", title: "No traffic data yet", evidence: "Sources and conversions are unknown", action: "Import a GA4 export (Reports › Acquisition › Traffic acquisition, CSV) or enter this week's numbers." });
  for (const c of i.content.filter((x) => x.target > 0 && x.done < x.target)) out.push({ severity: "watch", title: `${c.label}: ${c.done}/${c.target} this week`, evidence: "Weekly content target", action: "Schedule the missing pieces before Friday." });
  const rank = { act: 0, watch: 1, good: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
}

/* ---------------- GA4 / traffic CSV ---------------- */

const ALIASES: Record<string, string[]> = {
  date: ["date", "day", "fecha"],
  source_medium: ["session source / medium", "source / medium", "first user source / medium"],
  source: ["session source", "source", "first user source", "utm_source"],
  medium: ["session medium", "medium", "first user medium", "utm_medium"],
  campaign: ["session campaign", "campaign", "session campaign name", "utm_campaign"],
  country: ["country", "pays", "país"],
  sessions: ["sessions", "visits", "sesiones"],
  leads: ["key events", "conversions", "leads", "form submissions"],
  purchases: ["purchases", "ecommerce purchases", "transactions"],
  revenue: ["total revenue", "purchase revenue", "revenue"],
};

/** Maps a parsed CSV grid (rows of strings) to traffic rows. Comment lines (#) must be removed before parsing. */
export function mapTrafficGrid(grid: string[][], fallbackDate: string) {
  const headerIdx = grid.findIndex((r) => r.some((c) => ALIASES.sessions.includes(String(c).trim().toLowerCase())));
  if (headerIdx < 0) return { rows: [] as Omit<TrafficRow, "brand">[], mapped: {} as Record<string, string>, unrecognized: [] as string[], error: "No Sessions column found." };
  const header = grid[headerIdx].map((c) => String(c).trim());
  const col: Record<string, number> = {};
  const mapped: Record<string, string> = {};
  const unrecognized: string[] = [];
  header.forEach((h, i) => {
    const k = Object.keys(ALIASES).find((a) => col[a] === undefined && ALIASES[a].includes(h.toLowerCase()));
    if (k) { col[k] = i; mapped[h] = k; } else if (h) unrecognized.push(h);
  });
  const num = (v: string | undefined) => { const n = Number(String(v ?? "").replace(/[\s,]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n) : null; };
  const toDate = (v: string | undefined) => { const s = String(v ?? "").trim(); if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; return fallbackDate; };
  const rows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
    let source = col.source !== undefined ? r[col.source] : "";
    let medium = col.medium !== undefined ? r[col.medium] : "";
    if (col.source_medium !== undefined) [source, medium = ""] = String(r[col.source_medium] ?? "").split(" / ");
    return {
      date: col.date !== undefined ? toDate(r[col.date]) : fallbackDate,
      source: String(source || "(direct)").trim().slice(0, 80),
      medium: String(medium || "").trim().slice(0, 80),
      campaign: col.campaign !== undefined ? String(r[col.campaign] ?? "").trim().slice(0, 120) : "",
      country: col.country !== undefined ? String(r[col.country] ?? "").trim().slice(0, 60) : "",
      sessions: num(r[col.sessions]),
      leads: col.leads !== undefined ? num(r[col.leads]) : null,
      meetings: null,
      purchases: col.purchases !== undefined ? num(r[col.purchases]) : null,
      revenue_minor: col.revenue !== undefined ? (num(r[col.revenue]) ?? 0) * 100 : null,
    };
  }).filter((r) => r.sessions !== null && !/^(grand )?total$/i.test(r.source));
  return { rows, mapped, unrecognized, error: null };
}

/** LinkedIn follower export "Location"/"Country" sheet -> country counts. */
export function mapLocationSheet(grid: unknown[][]): { key: string; value: number }[] | null {
  const idx = grid.findIndex((r) => r.some((c) => ["location", "country", "country/region"].includes(String(c ?? "").trim().toLowerCase())));
  if (idx < 0) return null;
  const h = grid[idx].map((c) => String(c ?? "").trim().toLowerCase());
  const k = h.findIndex((c) => ["location", "country", "country/region"].includes(c));
  const v = h.findIndex((c) => ["total followers", "followers", "count", "follower count"].includes(c));
  if (v < 0) return null;
  const m = new Map<string, number>();
  for (const r of grid.slice(idx + 1)) {
    const key = String(r[k] ?? "").trim();
    const n = Number(String(r[v] ?? "").replace(/[\s,]/g, ""));
    if (!key || !Number.isFinite(n)) continue;
    const c = countryCode(key);
    m.set(c, (m.get(c) ?? 0) + Math.round(n));
  }
  return [...m.entries()].map(([key, value]) => ({ key, value }));
}
