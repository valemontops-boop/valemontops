/** Audience metrics (spec 5.6). Pure helpers: header mapping for LinkedIn exports, source precedence, gaps. */

export const AUDIENCE_METRICS = ["followers", "views", "impressions", "reach", "profile_visits", "interactions", "link_clicks"] as const;
export type AudienceMetric = (typeof AUDIENCE_METRICS)[number];

const ALIASES: Record<AudienceMetric | "date" | "reactions" | "comments" | "reposts", string[]> = {
  date: ["date", "day"],
  followers: ["total followers", "followers (total)", "total followers count"],
  views: ["views"],
  impressions: ["impressions (total)", "impressions", "total impressions", "post impressions"],
  reach: ["unique impressions (organic)", "unique impressions", "members reached", "unique impressions (total)"],
  profile_visits: ["page views (total)", "total page views (desktop and mobile)", "profile views", "page views"],
  interactions: ["engagements", "engagements (total)"],
  link_clicks: ["clicks (total)", "clicks"],
  reactions: ["reactions (total)", "reactions"],
  comments: ["comments (total)", "comments"],
  reposts: ["reposts (total)", "reposts", "shares"],
};

export interface MappedSheet {
  headerRow: number;
  mapped: Record<string, string>;
  unrecognized: string[];
  rows: { date: string; values: Partial<Record<AudienceMetric, number>> }[];
}

export function parseExportDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20_000 && v < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10); // Excel serial
  }
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    // LinkedIn exports use MM/DD/YYYY; a first part above 12 can only be a day.
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (a > 12) [a, b] = [b, a];
    return `${m[3]}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  return null;
}

const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const s = String(v ?? "").replace(/[\s,]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(Number(s)) : null;
};

/** Finds the header row (first row with a Date column) and maps known columns by name. */
export function mapSheet(grid: unknown[][]): MappedSheet | null {
  const headerRow = grid.findIndex((r) => r.some((c) => ALIASES.date.includes(String(c ?? "").trim().toLowerCase())));
  if (headerRow < 0) return null;
  const header = grid[headerRow].map((c) => String(c ?? "").trim());
  const colFor: Partial<Record<keyof typeof ALIASES, number>> = {};
  const mapped: Record<string, string> = {};
  const unrecognized: string[] = [];
  header.forEach((h, i) => {
    const key = (Object.keys(ALIASES) as (keyof typeof ALIASES)[]).find((k) => colFor[k] === undefined && ALIASES[k].includes(h.toLowerCase()));
    if (key) {
      colFor[key] = i;
      mapped[h] = key;
    } else if (h) unrecognized.push(h);
  });
  const rows: MappedSheet["rows"] = [];
  for (const r of grid.slice(headerRow + 1)) {
    const date = parseExportDate(r[colFor.date!]);
    if (!date) continue;
    const values: Partial<Record<AudienceMetric, number>> = {};
    for (const m of AUDIENCE_METRICS) {
      const i = colFor[m];
      if (i !== undefined) {
        const n = num(r[i]);
        if (n !== null) values[m] = n;
      }
    }
    if (values.interactions === undefined) {
      const parts = (["reactions", "comments", "reposts"] as const).map((k) => (colFor[k] !== undefined ? num(r[colFor[k]!]) : null)).filter((x): x is number => x !== null);
      if (parts.length) values.interactions = parts.reduce((a, b) => a + b, 0);
    }
    rows.push({ date, values });
  }
  return { headerRow, mapped, unrecognized, rows };
}

/** Merges the sheets of one export into one row per day. */
export function mergeSheets(sheets: MappedSheet[]) {
  const byDate = new Map<string, Partial<Record<AudienceMetric, number>>>();
  for (const s of sheets) for (const r of s.rows) byDate.set(r.date, { ...byDate.get(r.date), ...r.values });
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, values }));
}

const RANK = { api: 3, import: 2, manual: 1 } as const;
/** One value per day: the most authoritative source wins (api > import > manual). */
export function bestPerDay<R extends { date: string; source: "api" | "import" | "manual" }>(rows: R[]): R[] {
  const best = new Map<string, R>();
  for (const r of rows) {
    const p = best.get(r.date);
    if (!p || RANK[r.source] > RANK[p.source]) best.set(r.date, r);
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Daily series for a date range with explicit nulls for missing days: charts never interpolate. */
export function seriesWithGaps<R extends { date: string }>(rows: R[], from: string, to: string, pick: (r: R) => number | null | undefined, addDays: (d: string, n: number) => string) {
  const by = new Map(rows.map((r) => [r.date, r]));
  const out: { date: string; value: number | null }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = by.get(d);
    const v = r ? pick(r) : null;
    out.push({ date: d, value: v ?? null });
  }
  return out;
}

/** The chart metric per platform: Instagram views and LinkedIn impressions are different measures and are never summed. */
export function primaryMetricFor(platform: string): AudienceMetric {
  return platform === "instagram" ? "views" : "impressions";
}
