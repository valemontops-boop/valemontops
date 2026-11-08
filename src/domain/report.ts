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
export function formatWhatsAppReport(i: DailyReportInput): string {
  const lines: string[] = [];
  lines.push(`*${i.founderName} · ${i.date}*`);
  lines.push("");
  lines.push("*Logged today*");
  const typed = (Object.entries(i.byType) as [ActivityType, number][]).filter(([, n]) => n > 0);
  if (typed.length === 0) lines.push("- No activity logged");
  for (const [t, n] of typed) lines.push(`- ${ACTIVITY_LABELS[t]}: ${n}`);
  lines.push(`- New businesses contacted: ${i.tally.new_businesses}`);
  const withTargets = (Object.entries(i.targets) as [Metric, number][]).filter(([, t]) => t > 0);
  if (withTargets.length) {
    lines.push("");
    lines.push("*Against today's targets*");
    for (const [m, t] of withTargets) lines.push(`- ${METRIC_LABELS[m]}: ${i.tally[m]}/${t}`);
  }
  lines.push("");
  lines.push(`*Open opportunities: ${i.openOpportunityCount}*`);
  for (const o of i.openOpportunities.slice(0, 5)) lines.push(`- ${o.name} (${o.stage})${o.nextAction ? ` → ${o.nextAction}` : ""}`);
  lines.push("");
  lines.push(`*Tomorrow's priority:* ${i.nextDayPriority.trim() || "not set"}`);
  return lines.join("\n");
}
