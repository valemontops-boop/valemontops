import { ACTIVITY_LABELS, METRIC_LABELS, type ActivityType, type Metric } from "./constants";
import type { Tally } from "./activity";

export interface DailyReportInput {
  founderName: string;
  date: string;
  tally: Tally;
  targets: Partial<Record<Metric, number>>;
  /** Counts per activity type actually logged today (all types, including demos and meetings). */
  byType: Partial<Record<ActivityType, number>>;
  openOpportunities: { name: string; stage: string; nextAction: string }[];
  openOpportunityCount: number;
  nextDayPriority: string;
}

/** "Copy WhatsApp daily report": exactly the logged actions, open opportunities and next-day priority (spec 5.11). */
export function formatWhatsAppReport(i: DailyReportInput, t: (s: string, v?: Record<string, string | number>) => string = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? "")) : s)): string {
  const lines: string[] = [];
  lines.push(`*${i.founderName} · ${i.date}*`);
  lines.push("");
  lines.push(`*${t("Logged today")}*`);
  const typed = (Object.entries(i.byType) as [ActivityType, number][]).filter(([, n]) => n > 0);
  if (typed.length === 0) lines.push(`- ${t("No activity logged")}`);
  for (const [a, n] of typed) lines.push(`- ${t(ACTIVITY_LABELS[a])}: ${n}`);
  lines.push(`- ${t("New businesses contacted: {n}", { n: i.tally.new_businesses })}`);
  const withTargets = (Object.entries(i.targets) as [Metric, number][]).filter(([, t]) => t > 0);
  if (withTargets.length) {
    lines.push("");
    lines.push(`*${t("Against today's targets")}*`);
    for (const [m, n] of withTargets) lines.push(`- ${t(METRIC_LABELS[m])}: ${i.tally[m]}/${n}`);
  }
  lines.push("");
  lines.push(`*${t("Open opportunities: {n}", { n: i.openOpportunityCount })}*`);
  for (const o of i.openOpportunities.slice(0, 5)) lines.push(`- ${o.name} (${t(o.stage)})${o.nextAction ? ` → ${t(o.nextAction)}` : ""}`);
  lines.push("");
  lines.push(`*${t("Tomorrow's priority:")}* ${i.nextDayPriority.trim() || t("not set")}`);
  return lines.join("\n");
}
