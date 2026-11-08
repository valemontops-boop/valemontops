import { z } from "zod";
import type { Row } from "@/data/repository";
import { childId } from "@/lib/ids";
import { BRANDS, type FounderKey } from "@/domain/constants";
import { testingGuard } from "@/domain/ideas";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { settingValue } from "./common";
import { activeSprint } from "./sprints";
import { createTask } from "./tasks";
import { createAccount } from "./crm";

const STATUS = ["new", "discuss", "testing", "parked", "done", "rejected"] as const;
export const ideaSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1, "One line is enough").max(300),
  note: z.string().trim().max(2_000).default(""),
  brand: z.enum(BRANDS).nullable().default(null),
  category: z.enum(["offer", "content", "product", "process", "partner", "other"]).default("other"),
});

/** Capture in seconds; an idea never adds to today's targets (spec 5.13). */
export async function addIdea(ctx: AppContext, founder: FounderKey, input: z.infer<typeof ideaSchema>) {
  if (await ctx.repo.get("Ideas", input.id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("Ideas", [{ ...input, status: "new", votes: {}, reason: "", created_by_founder: founder, converted_type: null, converted_id: "" }], { founder });
  return { duplicate: false };
}

export const ideaUpdateSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  status: z.enum(STATUS).optional(),
  reason: z.string().trim().max(500).optional(),
  vote: z.enum(["yes", "maybe", "no"]).optional(),
  park_id: z.string().uuid().optional(), // which Testing idea to park to make room
});

export async function updateIdea(ctx: AppContext, founder: FounderKey, input: z.infer<typeof ideaUpdateSchema>) {
  const ideas = (await ctx.repo.list("Ideas", { fresh: true })).rows;
  const cur = ideas.find((i) => i.id === input.id);
  if (!cur) throw new RuleError("Idea not found");
  const patch: Partial<Row<"Ideas">> = {};
  if (input.vote) patch.votes = { ...cur.votes, [founder]: input.vote };
  if (input.status && input.status !== cur.status) {
    if ((input.status === "parked" || input.status === "rejected") && !(input.reason ?? "").trim()) throw new RuleError("Parked and rejected ideas keep their reason.");
    if (input.status === "testing") {
      const limit = Number(await settingValue(ctx.repo, "ideas_testing_limit")) || 2;
      const g = testingGuard(ideas, cur.id, Boolean(await activeSprint(ctx)), limit);
      if (!g.ok) {
        if (!input.park_id || !g.mustPark.includes(input.park_id)) {
          return { needsPark: true as const, candidates: ideas.filter((i) => g.mustPark.includes(i.id)).map((i) => ({ id: i.id, text: i.text, version: i.version })), limit };
        }
        const park = ideas.find((i) => i.id === input.park_id)!;
        await ctx.repo.update("Ideas", park.id, park.version, { status: "parked", reason: `Parked to test “${cur.text}” during the sprint` }, { founder });
      }
    }
    patch.status = input.status;
    if (input.reason !== undefined) patch.reason = input.reason;
  }
  const updated = await ctx.repo.update("Ideas", cur.id, input.expected_version, patch, { founder });
  return { needsPark: false as const, idea: updated };
}

export const convertSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int(), to: z.enum(["task", "opportunity"]), owner: z.enum(["theo", "pablo"]).nullable().default(null) });

/** One-click conversion keeping the link to the idea. Content concepts and campaigns arrive in Stage 3. */
export async function convertIdea(ctx: AppContext, founder: FounderKey, input: z.infer<typeof convertSchema>) {
  const idea = await ctx.repo.get("Ideas", input.id, { fresh: true });
  if (!idea) throw new RuleError("Idea not found");
  if (idea.converted_id) return { id: idea.converted_id, type: idea.converted_type };
  const target = childId(idea.id, "converted", input.to);
  if (input.to === "task") {
    await createTask(ctx, founder, { id: target, task: { title: idea.text, description: idea.note ? `${idea.note}\n\nFrom idea` : "From idea", owner: input.owner ?? founder, priority: "P2", due_at: "", estimated_minutes: null, recurrence: "none", account_id: "", opportunity_id: "", dependency_ids: [], private: false }, source: "idea", source_id: idea.id });
  } else {
    await createAccount(ctx.repo, founder, { id: target, account: { name: idea.text.slice(0, 200), sector: "", niche: "", country: null, city: "", website: "", phone: "", email: "", linkedin_url: "", lead_source: "Idea box", lead_type: "referral", brand: idea.brand, owner_founder: input.owner ?? founder, lead_status: "new", observed_problem: "", problem_evidence: "", language: "", notes: idea.note }, contact: null, opportunity: { name: idea.text.slice(0, 200), brand: idea.brand ?? "consulting", market: null, stage: "targeted", owner_founder: input.owner ?? founder, value_eur: null, expected_close: "", next_action: "Qualify the idea", next_action_due: "", next_action_priority: "normal" } });
  }
  await ctx.repo.update("Ideas", idea.id, input.expected_version, { converted_type: input.to, converted_id: target, status: idea.status === "new" || idea.status === "discuss" ? "testing" : idea.status }, { founder });
  return { id: target, type: input.to };
}

export async function listIdeas(ctx: AppContext) {
  const ideas = (await ctx.repo.list("Ideas")).rows.filter((i) => !i.is_archived).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sprint = await activeSprint(ctx);
  return { ideas, sprintActive: Boolean(sprint), testingLimit: Number(await settingValue(ctx.repo, "ideas_testing_limit")) || 2 };
}
