import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IgDay, IgInsights, IgMedia, InstagramPort } from "@/data/instagram/graph";

/**
 * Fake Instagram for tests and DEMO-only experiments (synthetic data). Mirrors what matters in Meta's API:
 * stories are served for 24 hours only, a story under 5 viewers has no insights, account insights exist only for a
 * limited window of past days, and faults (429/5xx) can be injected.
 */
export interface FakeIgMedia extends IgMedia { insights: Omit<IgInsights, "available">; viewers?: number }
export interface FakeIgAccount { username: string; followers: number; days: Record<string, IgDay>; media: FakeIgMedia[] }
export class FakeInstagramStore {
  accounts: Record<string, FakeIgAccount> = {};
  /** Clock of the fake (tests move it). */
  now = () => new Date();
  /** Days back for which account insights are still served. */
  windowDays = 30;
  /** Status codes returned by the next HTTP calls (fault injection). */
  faults: number[] = [];
  calls = 0;
  account(id: string) {
    const a = this.accounts[id];
    if (!a) throw new Error(`unknown fake ig user ${id}`);
    return a;
  }
}

const dayOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** In-process port over the store (same behaviour as the HTTP fake, no network). */
export class MemoryInstagram implements InstagramPort {
  constructor(private readonly s: FakeInstagramStore, private readonly userId: string) {}
  async profile() { const a = this.s.account(this.userId); return { username: a.username, followers: a.followers }; }
  async dayInsights(since: number) {
    const date = dayOf(since + 12 * 3600); // the local day that starts at `since` (midnight in Paris is 23:00 UTC)
    const oldest = new Date(this.s.now().getTime() - this.s.windowDays * 86_400_000).toISOString().slice(0, 10);
    if (date < oldest) return null;
    return structuredClone(this.s.account(this.userId).days[date] ?? null);
  }
  async media(since: number) {
    return this.s.account(this.userId).media.filter((m) => m.kind !== "story" && Date.parse(m.timestamp) / 1000 >= since).map(({ id, kind, permalink, timestamp }) => ({ id, kind, permalink, timestamp }));
  }
  async stories() {
    const now = this.s.now().getTime();
    return this.s.account(this.userId).media.filter((m) => m.kind === "story" && now - Date.parse(m.timestamp) < 24 * 3_600_000).map(({ id, kind, permalink, timestamp }) => ({ id, kind, permalink, timestamp }));
  }
  async insights(m: IgMedia): Promise<IgInsights> {
    const f = this.s.account(this.userId).media.find((x) => x.id === m.id);
    if (!f) return { available: false };
    if (f.kind === "story" && (this.s.now().getTime() - Date.parse(f.timestamp) >= 24 * 3_600_000 || (f.viewers ?? 99) < 5)) return { available: false };
    return { available: true, ...structuredClone(f.insights) };
  }
}

/** HTTP fake of the Graph endpoints the adapter reads (bearer token required). */
export function startFakeInstagramHttp(s: FakeInstagramStore, token = "fake-ig-token"): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    s.calls++;
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const fault = s.faults.shift();
    if (fault) return send(fault, { error: { message: "injected", code: fault === 429 ? 4 : 2 } });
    if (req.headers.authorization !== `Bearer ${token}`) return send(400, { error: { message: "Invalid OAuth access token.", code: 190 } });
    const u = new URL(req.url ?? "/", "http://fake");
    const parts = u.pathname.split("/").filter(Boolean);
    const [id, edge] = parts.slice(-2).length === 2 && ["insights", "media", "stories"].includes(parts.at(-1)!) ? [parts.at(-2)!, parts.at(-1)!] : [parts.at(-1)!, ""];
    const mem = (userId: string) => new MemoryInstagram(s, userId);
    const owner = Object.entries(s.accounts).find(([, a]) => a.media.some((m) => m.id === id))?.[0];
    try {
      if (!edge && s.accounts[id]) { const p = await mem(id).profile(); return send(200, { id, username: p.username, followers_count: p.followers }); }
      if (edge === "insights" && s.accounts[id]) {
        const d = await mem(id).dayInsights(Number(u.searchParams.get("since")));
        if (!d) return send(400, { error: { message: "outside the served window", code: 100 } });
        return send(200, { data: [["views", d.views], ["reach", d.reach], ["profile_views", d.profile_visits], ["website_clicks", d.link_clicks]].filter(([, v]) => v !== null).map(([name, value]) => ({ name, period: "day", total_value: { value } })) });
      }
      if (edge === "media" && s.accounts[id]) {
        const list = await mem(id).media(Number(u.searchParams.get("since") ?? 0));
        return send(200, { data: list.map((m) => ({ id: m.id, media_product_type: m.kind === "reel" ? "REELS" : "FEED", permalink: m.permalink, timestamp: m.timestamp })) });
      }
      if (edge === "stories" && s.accounts[id]) {
        const list = await mem(id).stories();
        return send(200, { data: list.map((m) => ({ id: m.id, media_product_type: "STORY", permalink: m.permalink, timestamp: m.timestamp })) });
      }
      if (edge === "insights" && owner) {
        const m = s.accounts[owner].media.find((x) => x.id === id)!;
        const r = await mem(owner).insights(m);
        if (!r.available) return send(400, { error: { message: "(#10) Not enough viewers for the media to show insights", code: 10 } });
        const names: Record<string, string> = { saves: "saved" };
        return send(200, { data: Object.entries(r).filter(([k, v]) => k !== "available" && typeof v === "number").map(([k, v]) => ({ name: names[k] ?? k, period: "lifetime", values: [{ value: v }] })) });
      }
      return send(404, { error: { message: "unknown path", code: 803 } });
    } catch (e) {
      return send(500, { error: { message: (e as Error).message } });
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v21.0`, server })));
}
