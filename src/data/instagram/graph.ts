import { StorageError } from "../repository";

/**
 * Instagram statistics (spec 7, 4.11), read-only, for the founders' own professional accounts.
 * Facebook Login path (System User token, does not expire) on graph.facebook.com by default; the Instagram Login path
 * (60-day token) uses graph.instagram.com through INSTAGRAM_API_BASE_URL. Nothing here can post, comment or send.
 */
export interface IgMedia { id: string; kind: "reel" | "post" | "story"; permalink: string; timestamp: string }
export interface IgInsights {
  /** false: Instagram does not serve this value (story under 5 viewers, media too old, before business conversion). */
  available: boolean;
  views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null; saves?: number | null;
  shares?: number | null; profile_visits?: number | null; follows?: number | null; link_clicks?: number | null;
}
export interface IgDay { views: number | null; reach: number | null; profile_visits: number | null; link_clicks: number | null }
export interface InstagramPort {
  profile(): Promise<{ username: string; followers: number | null }>;
  /** Account totals for one day [sinceUnix, untilUnix); null when the API no longer serves that day. */
  dayInsights(sinceUnix: number, untilUnix: number): Promise<IgDay | null>;
  /** Feed posts and Reels published since `sinceUnix`. */
  media(sinceUnix: number): Promise<IgMedia[]>;
  /** Stories still live (Instagram serves them for 24 hours only). */
  stories(): Promise<IgMedia[]>;
  insights(m: IgMedia): Promise<IgInsights>;
}
/** One configured Instagram account: our SocialAccounts key (e.g. "ig-valemont") or id, and its port. */
export interface InstagramAccount { key: string; port: InstagramPort; expiresAt: string | null }

type Json = Record<string, unknown>;
const METRICS: Record<IgMedia["kind"], string> = {
  reel: "views,reach,likes,comments,saved,shares",
  post: "views,reach,likes,comments,saved,shares,profile_visits,follows",
  story: "views,reach,shares,profile_visits,follows",
};
const NAME: Record<string, Exclude<keyof IgInsights, "available">> = { views: "views", reach: "reach", likes: "likes", comments: "comments", saved: "saves", shares: "shares", profile_visits: "profile_visits", follows: "follows", profile_views: "profile_visits", website_clicks: "link_clicks" };

/** Reads `data: [{ name, total_value: { value } } | { name, values: [{ value }] }]` into numbers. */
type Metric = Exclude<keyof IgInsights, "available">;
export function readInsightValues(body: Json): Partial<Record<Metric, number | null>> {
  const out: Partial<Record<Metric, number | null>> = {};
  for (const d of (body.data as Json[] | undefined) ?? []) {
    const key = NAME[String(d.name)];
    if (!key) continue;
    const tv = (d.total_value as Json | undefined)?.value;
    const vs = d.values as { value: unknown }[] | undefined;
    const v = typeof tv === "number" ? tv : vs?.length ? vs.reduce((a, x) => a + (typeof x.value === "number" ? x.value : 0), 0) : null;
    out[key] = typeof v === "number" ? Math.round(v) : null;
  }
  return out;
}

export class GraphInstagramAdapter implements InstagramPort {
  constructor(
    private readonly base: string,
    private readonly userId: string,
    private readonly token: string,
    private readonly opts: { sleep?: (ms: number) => Promise<void>; retries?: number } = {},
  ) {}

  private async get(path: string, params: Record<string, string>): Promise<{ status: number; body: Json }> {
    const url = `${this.base.replace(/\/$/, "")}/${path}?${new URLSearchParams(params)}`;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const retries = this.opts.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        // Bearer header, never the token in the URL (URLs end up in logs).
        res = await fetch(url, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
      } catch {
        if (attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
        throw new StorageError("Instagram is unreachable", undefined, true);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(500 * 2 ** attempt); continue; }
      const body = (await res.json().catch(() => ({}))) as Json;
      return { status: res.status, body };
    }
  }
  private fail(status: number, body: Json): never {
    const err = (body.error as Json | undefined) ?? {};
    // Code 190 = expired or revoked token: the founder must rotate it (docs/INTEGRATIONS.md).
    const msg = err.code === 190 ? "Instagram token expired or revoked" : `Instagram returned ${status}`;
    throw new StorageError(msg, status, status === 429 || status >= 500);
  }

  async profile() {
    const r = await this.get(this.userId, { fields: "username,followers_count" });
    if (r.status !== 200) this.fail(r.status, r.body);
    return { username: String(r.body.username ?? ""), followers: typeof r.body.followers_count === "number" ? r.body.followers_count : null };
  }
  async dayInsights(since: number, until: number) {
    const r = await this.get(`${this.userId}/insights`, { metric: "views,reach,profile_views,website_clicks", period: "day", metric_type: "total_value", since: String(since), until: String(until) });
    if (r.status === 400) return null; // outside the window the API serves
    if (r.status !== 200) this.fail(r.status, r.body);
    const v = readInsightValues(r.body);
    if (!Object.keys(v).length) return null;
    return { views: v.views ?? null, reach: v.reach ?? null, profile_visits: v.profile_visits ?? null, link_clicks: v.link_clicks ?? null };
  }
  private kindOf(m: Json): IgMedia["kind"] {
    return m.media_product_type === "STORY" ? "story" : m.media_product_type === "REELS" ? "reel" : "post";
  }
  async media(since: number) {
    const out: IgMedia[] = [];
    let after = "";
    for (let page = 0; page < 4; page++) {
      const r = await this.get(`${this.userId}/media`, { fields: "id,media_product_type,permalink,timestamp", limit: "50", since: String(since), ...(after ? { after } : {}) });
      if (r.status !== 200) this.fail(r.status, r.body);
      const data = (r.body.data as Json[] | undefined) ?? [];
      out.push(...data.map((m) => ({ id: String(m.id), kind: this.kindOf(m), permalink: String(m.permalink ?? ""), timestamp: new Date(String(m.timestamp)).toISOString() })));
      after = String(((r.body.paging as Json | undefined)?.cursors as Json | undefined)?.after ?? "");
      if (!after || !(r.body.paging as Json | undefined)?.next) break;
    }
    return out.filter((m) => Date.parse(m.timestamp) / 1000 >= since);
  }
  async stories() {
    const r = await this.get(`${this.userId}/stories`, { fields: "id,media_product_type,permalink,timestamp" });
    if (r.status !== 200) this.fail(r.status, r.body);
    return ((r.body.data as Json[] | undefined) ?? []).map((m) => ({ id: String(m.id), kind: "story" as const, permalink: String(m.permalink ?? ""), timestamp: new Date(String(m.timestamp)).toISOString() }));
  }
  async insights(m: IgMedia): Promise<IgInsights> {
    const r = await this.get(`${m.id}/insights`, { metric: METRICS[m.kind] });
    // Code 10 / 400: not enough viewers (story under 5), media before the business conversion, expired story.
    if (r.status === 400) return { available: false };
    if (r.status !== 200) this.fail(r.status, r.body);
    return { available: true, ...readInsightValues(r.body) };
  }
}

/**
 * Accounts from env (never Sheets): either INSTAGRAM_ACCOUNTS_JSON =
 * [{"account":"ig-valemont","ig_user_id":"…","token":"…","expires_at":"YYYY-MM-DD"}, …], or one account with
 * INSTAGRAM_BUSINESS_ACCOUNT_ID + INSTAGRAM_ACCESS_TOKEN (+ INSTAGRAM_ACCOUNT_KEY, default "ig-valemont", and
 * INSTAGRAM_TOKEN_EXPIRES_AT for a 60-day Instagram Login token). Malformed JSON → no account (Needs setup).
 */
export function instagramFromEnv(env: Record<string, string | undefined> = process.env): InstagramAccount[] {
  const base = env.INSTAGRAM_API_BASE_URL || "https://graph.facebook.com/v21.0";
  const out: InstagramAccount[] = [];
  const raw = env.INSTAGRAM_ACCOUNTS_JSON?.trim();
  if (raw) {
    try {
      const list = JSON.parse(raw) as { account?: unknown; ig_user_id?: unknown; token?: unknown; expires_at?: unknown }[];
      for (const a of Array.isArray(list) ? list : []) {
        if (typeof a.account !== "string" || typeof a.ig_user_id !== "string" || typeof a.token !== "string" || !a.token) continue;
        out.push({ key: a.account, port: new GraphInstagramAdapter(base, a.ig_user_id, a.token), expiresAt: typeof a.expires_at === "string" && a.expires_at ? a.expires_at : null });
      }
    } catch { /* stays empty: Needs setup */ }
  }
  if (env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    const key = env.INSTAGRAM_ACCOUNT_KEY || "ig-valemont";
    if (!out.some((a) => a.key === key)) out.push({ key, port: new GraphInstagramAdapter(base, env.INSTAGRAM_BUSINESS_ACCOUNT_ID, env.INSTAGRAM_ACCESS_TOKEN), expiresAt: env.INSTAGRAM_TOKEN_EXPIRES_AT || null });
  }
  return out;
}
