import type { Stage } from "./constants";

export interface OppLike {
  stage: Stage;
  next_action: string;
  next_action_due: string | null;
  value_minor: number | null;
  anum_authority: string;
  anum_need: string;
  anum_urgency: string;
  anum_money: string;
  is_archived: boolean;
}

export const OPEN_STAGES: Stage[] = ["targeted", "contacted", "replied", "discovery_scheduled", "qualified", "demo_shown", "proposal_sent", "negotiation"];

export function isOpen(o: Pick<OppLike, "stage" | "is_archived">): boolean {
  return !o.is_archived && OPEN_STAGES.includes(o.stage);
}

/** Hygiene flags (spec 5.5). */
export function hygieneFlags(o: OppLike, today: string): string[] {
  const flags: string[] = [];
  if (!isOpen(o)) return flags;
  if (!o.next_action.trim() || !o.next_action_due) flags.push("No next action with a date");
  else if (o.next_action_due < today) flags.push("Next action overdue");
  return flags;
}

const QUALIFIED_OR_LATER: Stage[] = ["qualified", "demo_shown", "proposal_sent", "negotiation", "won"];

/** Moving to Qualified (or beyond) requires authority, need, urgency and money notes (ANUM). */
export function stageChangeErrors(o: OppLike, to: Stage, lostReason: string): string[] {
  const errs: string[] = [];
  if (QUALIFIED_OR_LATER.includes(to)) {
    const missing = (["anum_authority", "anum_need", "anum_urgency", "anum_money"] as const).filter((k) => !o[k].trim());
    if (missing.length) errs.push(`Qualified requires ANUM notes: missing ${missing.map((k) => k.replace("anum_", "")).join(", ")}`);
  }
  if (to === "lost" && !lostReason.trim()) errs.push("A lost reason is required");
  return errs;
}

export function weightedValueMinor(opps: (OppLike & { probability: number })[]): number {
  return Math.round(opps.filter(isOpen).reduce((s, o) => s + (o.value_minor ?? 0) * o.probability, 0));
}

/**
 * Yes-only pipeline (D029): businesses enter the board when they say yes (talk again or meeting).
 * Targeted/contacted businesses live in call lists, not on the board. Exact stages stay editable.
 */
export const PIPELINE_GROUPS: { key: string; label: string; stages: Stage[]; entry: Stage }[] = [
  { key: "talk", label: "Talk again", stages: ["replied"], entry: "replied" },
  { key: "meeting", label: "Meeting booked", stages: ["discovery_scheduled"], entry: "discovery_scheduled" },
  { key: "met", label: "Met / demo", stages: ["qualified", "demo_shown"], entry: "qualified" },
  { key: "proposal", label: "Proposal", stages: ["proposal_sent", "negotiation"], entry: "proposal_sent" },
  { key: "won", label: "Won", stages: ["won"], entry: "won" },
];

export const PRE_PIPELINE: Stage[] = ["targeted", "contacted"];

export function groupOf(stage: Stage): string | null {
  return PIPELINE_GROUPS.find((g) => g.stages.includes(stage))?.key ?? null;
}

/** The stage a card lands on when moved to a column: unchanged if already inside it. */
export function stageForGroup(current: Stage, groupKey: string): Stage {
  const g = PIPELINE_GROUPS.find((x) => x.key === groupKey);
  if (!g) return current;
  return g.stages.includes(current) ? current : g.entry;
}

export function nextGroup(stage: Stage): string | null {
  const i = PIPELINE_GROUPS.findIndex((g) => g.stages.includes(stage));
  return i >= 0 && i < PIPELINE_GROUPS.length - 1 ? PIPELINE_GROUPS[i + 1].key : null;
}

/** Business status from its last call, for the contacts view. */
export type LeadStatus = "not_called" | "no_answer" | "refused" | "yes" | "won" | "lost" | "opted_out";
export function leadStatus(i: { blocked: boolean; stage: Stage | null; lastOutcome: string | null; called: boolean }): LeadStatus {
  if (i.blocked) return "opted_out";
  if (i.stage === "won") return "won";
  if (i.stage === "lost") return "lost";
  if (i.stage && !PRE_PIPELINE.includes(i.stage)) return "yes";
  if (!i.called) return "not_called";
  if (i.lastOutcome === "not_interested") return "refused";
  return "no_answer";
}
