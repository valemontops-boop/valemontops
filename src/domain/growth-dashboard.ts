import type { Verdict, VerdictKind } from "./verdicts";

/**
 * Growth as ONE dashboard (iteration 10, D077). Pure helpers: which detail drawer a channel row opens, the URL state
 * (?channel=web&view=cost&tab=seo), the value a row shows in each view of "Channels compared", the key numbers and
 * the three verdicts shown first.
 */

/** Detail drawers: one per channel family, plus the "To reply" list and Content. */
export const GROWTH_PANELS = ["calls", "messages", "linkedin", "social", "web", "inbox", "content"] as const;
export type GrowthPanel = (typeof GROWTH_PANELS)[number];
/** Views of the same information in "Channels compared". */
export const GROWTH_VIEWS = ["volume", "results", "cost"] as const;
export type GrowthView = (typeof GROWTH_VIEWS)[number];
/** Tabs inside a drawer, only for drawers with several views (the first one is the default). */
export const PANEL_TABS: Record<GrowthPanel, readonly string[]> = {
  calls: [], messages: ["results", "waiting", "quality"], linkedin: ["outreach", "accounts"], social: ["funnel", "accounts"],
  web: ["visits", "seo", "add"], inbox: [], content: [],
};

/** Channel row (funnel key) → the drawer it opens. */
export function panelOf(key: string): GrowthPanel {
  switch (key) {
    case "phone": case "field": return "calls";
    case "email": case "whatsapp": return "messages";
    case "linkedin": return "linkedin";
    case "social": return "social";
    default: return "web"; // web, ai, inbound
  }
}

export interface GrowthState { panel: GrowthPanel | null; view: GrowthView; tab: string | null }

/** Reads the URL; anything unknown falls back to the main view (no drawer, "volume", the drawer's first tab). */
export function readGrowthState(q: URLSearchParams): GrowthState {
  const c = q.get("channel");
  const panel = (GROWTH_PANELS as readonly string[]).includes(c ?? "") ? (c as GrowthPanel) : null;
  const v = q.get("view");
  const view = (GROWTH_VIEWS as readonly string[]).includes(v ?? "") ? (v as GrowthView) : "volume";
  const tabs = panel ? PANEL_TABS[panel] : [];
  const t = q.get("tab");
  const tab = tabs.length ? (t && tabs.includes(t) ? t : tabs[0]) : null;
  return { panel, view, tab };
}

/** "/marketing?channel=web&view=cost&tab=seo"; the defaults are left out so a plain link stays plain. */
export function growthHref(s: Partial<GrowthState>): string {
  const q = new URLSearchParams();
  if (s.panel) q.set("channel", s.panel);
  if (s.view && s.view !== "volume") q.set("view", s.view);
  if (s.panel && s.tab && PANEL_TABS[s.panel].length && s.tab !== PANEL_TABS[s.panel][0]) q.set("tab", s.tab);
  const qs = q.toString();
  return qs ? `/marketing?${qs}` : "/marketing";
}

interface RowLite { touches: number; meetings: number; won: number }
interface CostLite { minutes: number; perMeetingMinor: number | null; cacMinor: number | null }

/** The number a channel row is drawn with in a view: touches, meetings, or the cost per meeting (null = no meeting yet). */
export function rowValue(view: GrowthView, c: RowLite, cost: CostLite | undefined): number | null {
  if (view === "volume") return c.touches;
  if (view === "results") return c.meetings;
  return cost?.perMeetingMinor ?? null;
}

/** Key numbers of the band: outreach touches, meetings, clients (deals won + 30/30 purchases), meetings per hour of outreach. */
export function keyNumbers(d: { all: (RowLite & { hours: number | null })[]; sources?: RowLite[]; inbound: RowLite; totalMeetings: number }) {
  const touches = d.all.reduce((s, c) => s + c.touches, 0);
  const deals = d.all.reduce((s, c) => s + c.won, 0);
  const purchases = (d.sources ?? [d.inbound]).reduce((s, c) => s + c.won, 0);
  const hours = d.all.reduce((s, c) => s + (c.hours ?? 0), 0);
  const outMeetings = d.all.reduce((s, c) => s + c.meetings, 0);
  return { touches, meetings: d.totalMeetings, clients: deals + purchases, deals, purchases, hours, perHour: hours ? Math.round((outMeetings / hours) * 100) / 100 : null };
}

const ORDER: VerdictKind[] = ["fix", "watch", "good"];
/** Verdicts ordered "to improve" → "to watch" → "what works" (stable inside each kind). */
export function orderVerdicts(list: Verdict[]): Verdict[] {
  return ORDER.flatMap((k) => list.filter((v) => v.kind === k));
}
