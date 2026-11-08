import { z } from "zod";
import type { FounderKey } from "@/domain/constants";
import { RuleError } from "../errors";
import type { AppContext } from "../context";

/** Private job search: only in the founder's own spreadsheet; never in team metrics, caches or exports (spec 4.7). */
function repoFor(ctx: AppContext, founder: FounderKey) {
  const r = ctx.privateRepo(founder);
  if (!r) throw new RuleError("Job search needs your private spreadsheet (PRIVATE_SHEET_ID for your account).");
  return r;
}

const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default("");
export const jobSchema = z.object({
  id: z.string().uuid(),
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().max(200).default(""),
  status: z.enum(["to_apply", "applied", "interview", "offer", "rejected", "withdrawn"]).default("to_apply"),
  applied_on: day,
  next_step: z.string().trim().max(300).default(""),
  next_step_due: day,
  url: z.string().trim().max(500).default(""),
  notes: z.string().trim().max(2_000).default(""),
});

export async function listJobs(ctx: AppContext, founder: FounderKey) {
  const r = ctx.privateRepo(founder);
  if (!r) return { configured: false, jobs: [] };
  return { configured: true, jobs: (await r.list("JobApplications")).rows.filter((j) => !j.is_archived).sort((a, b) => (a.next_step_due ?? "9999").localeCompare(b.next_step_due ?? "9999")) };
}
export async function saveJob(ctx: AppContext, founder: FounderKey, input: z.infer<typeof jobSchema> & { expected_version?: number }) {
  const r = repoFor(ctx, founder);
  const data = { ...input, applied_on: input.applied_on || null, next_step_due: input.next_step_due || null };
  delete (data as { expected_version?: number }).expected_version;
  const cur = await r.get("JobApplications", input.id, { fresh: true });
  if (cur) return r.update("JobApplications", input.id, input.expected_version ?? cur.version, data, { founder });
  return (await r.insert("JobApplications", [data], { founder }))[0];
}
