/**
 * "What works, what to watch, what to fix" (founder feedback round 6): deterministic reading of the numbers
 * with a concrete next step. Rules use minimum sample sizes so a verdict is never drawn from 3 calls.
 * Texts are English keys with {vars}; the UI translates the key and every string var (labels).
 */
export type VerdictKind = "good" | "watch" | "fix";
export interface Verdict { kind: VerdictKind; key: string; vars?: Record<string, string | number>; action?: { key: string; vars?: Record<string, string | number> } }
const pct = (x: number) => Math.round(x * 100);
const MIN = 20;

/* ---------------- sales (Reports dashboard) ---------------- */
export interface SalesInput {
  kpis: { dials: { value: number | null; delta: number | null }; pickupRate: { value: number | null; delta: number | null }; yesRate: { value: number | null; delta: number | null }; yes: { value: number | null }; meetings: { value: number | null; delta: number | null } };
  byHour: { hour: number; dials: number; pickupRate: number | null }[];
  byNiche: { key: string; dials: number; picked: number; yesRate: number | null }[];
  byMarket: { key: string; dials: number; picked: number; yesRate: number | null }[];
  objections: { key: string; count: number; won: number; wonRate: number | null }[];
}
export function salesVerdicts(d: SalesInput, objectionLabel: (k: string) => string = (k) => k): Verdict[] {
  const out: Verdict[] = [];
  const dials = d.kpis.dials.value ?? 0;
  if (dials === 0) return [{ kind: "fix", key: "No call logged in this period.", action: { key: "Block one calling hour every morning and start Calls." } }];
  if (d.kpis.dials.delta !== null && d.kpis.dials.delta <= -20) out.push({ kind: "watch", key: "Calls are down {d}% vs the previous period.", vars: { d: Math.abs(d.kpis.dials.delta) }, action: { key: "Volume drives everything: get back to your daily call target." } });
  if (d.kpis.dials.delta !== null && d.kpis.dials.delta >= 20) out.push({ kind: "good", key: "Calls are up {d}% vs the previous period.", vars: { d: d.kpis.dials.delta } });
  const bestHour = d.byHour.filter((h) => h.dials >= 5 && h.pickupRate !== null).sort((a, b) => (b.pickupRate ?? 0) - (a.pickupRate ?? 0))[0];
  const pr = d.kpis.pickupRate.value;
  if (pr !== null && dials >= MIN) {
    if (pr >= 0.35) out.push({ kind: "good", key: "{p}% of calls are picked up.", vars: { p: pct(pr) } });
    else if (pr < 0.2) out.push({ kind: "fix", key: "Only {p}% of calls are picked up.", vars: { p: pct(pr) }, action: bestHour ? { key: "Call around {h}:00: your best hour ({p}% picked up).", vars: { h: bestHour.hour, p: pct(bestHour.pickupRate ?? 0) } } : { key: "Try other time slots and keep logging: your best hour will show up." } });
    else if (bestHour && (bestHour.pickupRate ?? 0) - pr >= 0.15) out.push({ kind: "watch", key: "{p}% pick up overall, {b}% around {h}:00.", vars: { p: pct(pr), b: pct(bestHour.pickupRate ?? 0), h: bestHour.hour }, action: { key: "Put your calling block around {h}:00.", vars: { h: bestHour.hour } } });
  }
  const yr = d.kpis.yesRate.value;
  const picked = d.byNiche.reduce((a, n) => a + n.picked, 0);
  const worstObj = d.objections.filter((o) => o.count >= 3).sort((a, b) => (a.wonRate ?? 0) - (b.wonRate ?? 0))[0];
  if (yr !== null && picked >= 10) {
    if (yr >= 0.2) out.push({ kind: "good", key: "{p}% of the people reached say yes.", vars: { p: pct(yr) } });
    else if (yr < 0.1) out.push({ kind: "fix", key: "Only {p}% of the people reached say yes.", vars: { p: pct(yr) }, action: worstObj ? { key: "Work on “{objection}”: heard {n} times, turned around {w}%. Practise it in Calls › Objections.", vars: { objection: objectionLabel(worstObj.key), n: worstObj.count, w: pct(worstObj.wonRate ?? 0) } } : { key: "Rework the opener: one sentence on the problem, then a question." } });
  }
  const yes = d.kpis.yes.value ?? 0;
  const meetings = d.kpis.meetings.value ?? 0;
  if (yes >= 5 && meetings / yes < 0.3) out.push({ kind: "fix", key: "{y} yeses but only {m} meetings.", vars: { y: yes, m: meetings }, action: { key: "Book the slot before hanging up, and send the Calendly link right away (key M)." } });
  if (yes >= 5 && meetings / yes >= 0.5) out.push({ kind: "good", key: "Half of your yeses become meetings.", vars: {} });
  const niches = d.byNiche.filter((n) => n.picked >= 8 && n.yesRate !== null && n.key !== "Free dialling");
  const bestN = [...niches].sort((a, b) => (b.yesRate ?? 0) - (a.yesRate ?? 0))[0];
  const worstN = [...niches].sort((a, b) => (a.yesRate ?? 0) - (b.yesRate ?? 0))[0];
  if (bestN && (bestN.yesRate ?? 0) > 0) out.push({ kind: "good", key: "{niche} answers best: {p}% yes.", vars: { niche: bestN.key, p: pct(bestN.yesRate ?? 0) }, action: { key: "Put more {niche} in your next lists.", vars: { niche: bestN.key } } });
  if (worstN && bestN && worstN.key !== bestN.key && (worstN.yesRate ?? 0) <= (bestN.yesRate ?? 0) / 2) out.push({ kind: "watch", key: "{niche} answers less: {p}% yes.", vars: { niche: worstN.key, p: pct(worstN.yesRate ?? 0) }, action: { key: "Adapt the opener to this trade, or call it less." } });
  const fr = d.byMarket.find((m) => m.key === "FR"), es = d.byMarket.find((m) => m.key === "ES");
  if (fr && es && fr.picked >= 10 && es.picked >= 10 && fr.yesRate !== null && es.yesRate !== null && Math.abs(fr.yesRate - es.yesRate) >= 0.1) {
    const [hi, lo] = fr.yesRate > es.yesRate ? [fr, es] : [es, fr];
    out.push({ kind: "watch", key: "{hi} says yes more often than {lo} ({a}% vs {b}%).", vars: { hi: hi.key === "FR" ? "France" : "Spain", lo: lo.key === "FR" ? "France" : "Spain", a: pct(hi.yesRate ?? 0), b: pct(lo.yesRate ?? 0) } });
  }
  const strongObj = d.objections.filter((o) => o.count >= 3 && (o.wonRate ?? 0) >= 0.5)[0];
  if (strongObj) out.push({ kind: "good", key: "You turn around “{objection}” well ({w}%).", vars: { objection: objectionLabel(strongObj.key), w: pct(strongObj.wonRate ?? 0) } });
  return out;
}

/* ---------------- growth (channel funnels) ---------------- */
export interface FunnelInput {
  all: { key: string; touches: number; meetings: number; meetingsPerHour: number | null; steps: { label: string; value: number }[] }[];
  inbound: { steps: { label: string; value: number }[] };
  best: string | null;
}
export function growthVerdicts(f: FunnelInput, label: (k: string) => string = (k) => k): Verdict[] {
  const out: Verdict[] = [];
  const ch = (k: string) => f.all.find((c) => c.key === k);
  const best = f.best ? ch(f.best) : null;
  if (best) out.push({ kind: "good", key: "{channel} brings the most meetings per hour ({n}).", vars: { channel: label(best.key), n: best.meetingsPerHour ?? 0 }, action: { key: "Give it the first hours of your day." } });
  for (const c of f.all.filter((x) => x.touches >= 20 && x.meetings === 0)) out.push({ kind: "fix", key: "{channel}: {n} touches and no meeting.", vars: { channel: label(c.key), n: c.touches }, action: { key: c.key === "linkedin" ? "Fewer invitations, more personal messages that end with a question." : c.key === "email" ? "Shorter emails, one question, sent right after a call." : "Change the message or the target list." } });
  const email = ch("email");
  if (email && (email.steps[0]?.value ?? 0) >= MIN) {
    const rate = (email.steps[1]?.value ?? 0) / (email.steps[0]?.value || 1);
    if (rate >= 0.1) out.push({ kind: "good", key: "{p}% of your emails get a reply.", vars: { p: pct(rate) } });
    else if (rate < 0.03) out.push({ kind: "fix", key: "Only {p}% of your emails get a reply.", vars: { p: pct(rate) }, action: { key: "Shorter emails, one question, sent right after a call." } });
  }
  const phone = ch("phone");
  const reached = phone?.steps[1]?.value ?? 0;
  const sent = (email?.steps[0]?.value ?? 0) + (ch("whatsapp")?.steps[0]?.value ?? 0);
  if (reached >= 10) {
    const cover = sent / reached;
    if (cover < 0.5) out.push({ kind: "fix", key: "Only {p}% of the people you reached got a message.", vars: { p: pct(Math.min(1, cover)) }, action: { key: "Send them all in one click from Calls › Messages." } });
    else out.push({ kind: "good", key: "Almost everyone you reached got a message.", vars: {} });
  }
  const visits = f.inbound.steps[0]?.value ?? 0, leads = f.inbound.steps[1]?.value ?? 0;
  if (visits >= 200) {
    const conv = leads / visits;
    if (conv < 0.01) out.push({ kind: "fix", key: "The website turns {p}% of visits into leads.", vars: { p: Math.round(conv * 1000) / 10 }, action: { key: "One clear call to action on the home page: book a 15-minute call." } });
    else if (conv >= 0.03) out.push({ kind: "good", key: "The website turns {p}% of visits into leads.", vars: { p: Math.round(conv * 1000) / 10 } });
  }
  return out;
}

/* ---------------- money (Wise + Stripe) ---------------- */
export interface MoneyInput {
  months: { month: string; income: number; expenses: number; net: number }[];
  expensesByCategory: { category: string; amount: number }[];
  previousExpensesByCategory?: { category: string; amount: number }[];
  toReview: number;
  balance: number | null;
  mrr: number | null;
  mrrPrevious?: number | null;
  topClientShare?: { name: string; share: number } | null;
}
export function moneyVerdicts(m: MoneyInput, fmt: (minor: number) => string, label: (k: string) => string = (k) => k): Verdict[] {
  const out: Verdict[] = [];
  const cur = m.months.at(-1);
  if (cur && cur.net < 0 && cur.expenses > 0) {
    const top = m.expensesByCategory[0];
    out.push({ kind: "fix", key: "This month you spend more than you earn ({x}).", vars: { x: fmt(cur.net) }, action: top ? { key: "Start with the biggest item: {category} ({y}).", vars: { category: label(top.category), y: fmt(top.amount) } } : undefined });
  } else if (cur && cur.net > 0) out.push({ kind: "good", key: "This month is positive: {x}.", vars: { x: fmt(cur.net) } });
  const last3 = m.months.slice(-3);
  const burn = -last3.reduce((a, x) => a + x.net, 0) / (last3.length || 1);
  if (m.balance !== null && burn > 0) {
    const runway = m.balance / burn;
    out.push({ kind: runway < 3 ? "fix" : runway < 6 ? "watch" : "good", key: "Cash covers about {n} months at the current pace.", vars: { n: Math.round(runway * 10) / 10 }, action: runway < 6 ? { key: "Priority: signed clients and subscriptions before new spending." } : undefined });
  }
  if (m.topClientShare && m.topClientShare.share >= 0.5) out.push({ kind: "watch", key: "{name} is {p}% of your revenue.", vars: { name: m.topClientShare.name, p: pct(m.topClientShare.share) }, action: { key: "Sign two more clients to reduce the risk." } });
  if (m.mrr !== null && m.mrrPrevious !== null && m.mrrPrevious !== undefined) {
    if (m.mrr > m.mrrPrevious) out.push({ kind: "good", key: "Recurring revenue grows: {x} per month.", vars: { x: fmt(m.mrr) } });
    else if (m.mrr < m.mrrPrevious) out.push({ kind: "fix", key: "Recurring revenue went down to {x} per month.", vars: { x: fmt(m.mrr) }, action: { key: "Call the clients who cancelled: why, and what would bring them back." } });
  }
  for (const c of m.expensesByCategory) {
    const prev = m.previousExpensesByCategory?.find((p) => p.category === c.category)?.amount ?? 0;
    if (c.amount >= 5000 && prev > 0 && c.amount >= prev * 1.5) out.push({ kind: "watch", key: "{category} spending is up: {x} vs {y} last month.", vars: { category: label(c.category), x: fmt(c.amount), y: fmt(prev) } });
  }
  if (m.toReview > 0) out.push({ kind: "watch", key: "{n} incoming payments to check.", vars: { n: m.toReview }, action: { key: "Confirm client revenue vs founder contributions in Movements › To check." } });
  return out;
}
