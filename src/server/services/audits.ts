/** Audit questionnaires from an opportunity (spec 5.9, D074): start, answer (saved, resumable), summary, validation. */
import { z } from "zod";
import type { DataRepository } from "@/data/repository";
import type { FounderKey } from "@/domain/constants";
import { LOCALE_OF } from "@/i18n";
import { AUDIT_LANGUAGES, COMPLEXITIES, SECTORS, auditSummary, questionsSchema } from "@/domain/audit";
import { RuleError } from "../errors";

export async function listTemplates(repo: DataRepository) {
  return (await repo.list("AuditTemplates")).rows.filter((r) => !r.is_archived).map(({ template_key, sector, complexity, language, title, questions }) => ({ template_key, sector, complexity, language, title, count: questions.length }));
}

export async function auditsFor(repo: DataRepository, opportunityId: string) {
  return (await repo.list("AuditSessions")).rows.filter((a) => a.opportunity_id === opportunityId && !a.is_archived).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const startAuditSchema = z.object({
  id: z.string().uuid(), // client-generated: a retried start creates nothing (D006)
  opportunity_id: z.string().uuid(),
  sector: z.enum(SECTORS),
  complexity: z.enum(COMPLEXITIES),
  language: z.enum(AUDIT_LANGUAGES).nullable().default(null),
});

/** The questionnaire is copied from the stored template, so editing a question never changes the template or older audits. */
export async function startAudit(repo: DataRepository, founder: FounderKey, input: z.infer<typeof startAuditSchema>) {
  const existing = await repo.get("AuditSessions", input.id, { fresh: true });
  if (existing) return existing;
  const opp = await repo.get("Opportunities", input.opportunity_id);
  if (!opp) throw new RuleError("Opportunity not found");
  const acc = opp.account_id ? await repo.get("Accounts", opp.account_id) : null;
  // Client language: the business's market, else the deal's, else the founder's own.
  const language = input.language ?? acc?.country ?? opp.market ?? (LOCALE_OF[founder] === "fr" ? "FR" : "ES");
  const key = `${input.sector}.${input.complexity}.${language}`;
  const tpl = (await repo.list("AuditTemplates")).rows.find((t) => t.template_key === key && !t.is_archived);
  if (!tpl) throw new RuleError("No questionnaire template for this sector and language.");
  const [row] = await repo.insert("AuditSessions", [{
    id: input.id, opportunity_id: opp.id, account_id: opp.account_id, template_key: key, sector: input.sector, complexity: input.complexity, language,
    questions: tpl.questions, answers: {}, status: "in_progress", summary: auditSummary(tpl.questions, {}, language), summary_at: new Date().toISOString(),
    validated_by: null, validated_at: null, owner_founder: founder,
  }], { founder });
  return row;
}

export const saveAuditSchema = z.object({
  id: z.string().uuid(),
  expected_version: z.number().int(),
  answers: z.record(z.string().max(40), z.string().trim().max(2_000)).optional(),
  /** Edited questionnaire (wording, added or removed questions), 1–20 questions. */
  questions: questionsSchema.optional(),
  status: z.enum(["in_progress", "completed"]).optional(),
});

/** Saves answers (resumable) and recomputes the summary; any change clears the founder validation. */
export async function saveAudit(repo: DataRepository, founder: FounderKey, input: z.infer<typeof saveAuditSchema>) {
  const cur = await repo.get("AuditSessions", input.id, { fresh: true });
  if (!cur) throw new RuleError("Audit not found");
  const questions = input.questions ?? cur.questions;
  const keys = new Set(questions.map((q) => q.key));
  if (keys.size !== questions.length) throw new RuleError("Two questions have the same key.");
  const answers = Object.fromEntries(Object.entries({ ...cur.answers, ...(input.answers ?? {}) }).filter(([k]) => keys.has(k)));
  return repo.update("AuditSessions", input.id, input.expected_version, {
    questions, answers, status: input.status ?? cur.status, summary: auditSummary(questions, answers, cur.language), summary_at: new Date().toISOString(), validated_by: null, validated_at: null,
  }, { founder });
}

export const validateAuditSchema = z.object({ id: z.string().uuid(), expected_version: z.number().int() });
/** A founder has read the draft suggestions and validates the summary (still a summary, never a diagnosis). */
export async function validateAudit(repo: DataRepository, founder: FounderKey, input: z.infer<typeof validateAuditSchema>) {
  return repo.update("AuditSessions", input.id, input.expected_version, { validated_by: founder, validated_at: new Date().toISOString(), status: "completed" }, { founder });
}
