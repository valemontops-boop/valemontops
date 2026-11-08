import type { WorkMode } from "./constants";

export const DELIVERABLES = ["concept", "reel", "brand_post", "personal_post", "story", "vsl"] as const;
export type Deliverable = (typeof DELIVERABLES)[number];
export const DELIVERABLE_LABELS: Record<Deliverable, string> = {
  concept: "Video concepts",
  reel: "Reels",
  brand_post: "Brand LinkedIn posts",
  personal_post: "Personal LinkedIn posts",
  story: "Instagram stories",
  vsl: "VSL (every 2 weeks)",
};

/** Weekly team targets (spec 5.6), seeds. VSL counts over 14 days. */
export const CONTENT_TARGETS: Partial<Record<WorkMode, Record<Deliverable, number>>> = {
  JOB_SEARCHING: { concept: 3, reel: 6, brand_post: 4, personal_post: 4, story: 8, vsl: 1 },
  LAUNCH_SPRINT: { concept: 3, reel: 6, brand_post: 4, personal_post: 4, story: 8, vsl: 1 },
  EMPLOYED_35H: { concept: 2, reel: 4, brand_post: 4, personal_post: 2, story: 4, vsl: 0 },
  CUSTOM: { concept: 2, reel: 4, brand_post: 4, personal_post: 2, story: 4, vsl: 0 },
};

export function contentProgress(
  logs: { deliverable: Deliverable; local_date: string; founder_key: string }[],
  mode: WorkMode | null,
  weekStart: string,
  weekEnd: string,
  vslFrom: string,
) {
  const targets = (mode && CONTENT_TARGETS[mode]) || CONTENT_TARGETS.EMPLOYED_35H!;
  return DELIVERABLES.map((d) => {
    const inWindow = logs.filter((l) => l.deliverable === d && l.local_date >= (d === "vsl" ? vslFrom : weekStart) && l.local_date <= weekEnd);
    return { deliverable: d, label: DELIVERABLE_LABELS[d], done: inWindow.length, target: targets[d], byFounder: { theo: inWindow.filter((l) => l.founder_key === "theo").length, pablo: inWindow.filter((l) => l.founder_key === "pablo").length } };
  }).filter((x) => x.target > 0 || x.done > 0);
}
