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
