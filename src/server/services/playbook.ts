import { z } from "zod";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { CUSTOM_KINDS, PLAYBOOK_KINDS, customKeyOf, isCustomKey, mergePlaybook, textLimit, type PlaybookItem } from "@/domain/playbook";
import { ConflictError } from "@/data/repository";
import type { AppContext } from "../context";
import { RuleError } from "../errors";
import { senderAddress } from "../sender";
import { userRow } from "./common";

export interface PlaybookData {
  items: PlaybookItem[];
  links: { calendly: string; deckFR: string; deckES: string; thirty: string };
  /** Valemont Local monthly price as said on the phone ("100 €"), from offer_local_monthly_eur. */
  localPrice: string;
  founderName: string;
  /** The founder's email signature (Settings › Workspace); empty = "First name / Valemont". */
  signature: string;
  /** The address every client email leaves from (D090); "" = not set yet. */
  sender: string;
}

/** Scripts and templates (defaults + founder edits + custom templates) and the links they insert, for the signed-in founder. */
export async function getPlaybook(ctx: AppContext, founder: FounderKey): Promise<PlaybookData> {
  const t = await ctx.repo.listMany(["Playbook", "SystemSettings"]);
  const s = (k: string) => t.SystemSettings.rows.find((r) => r.key === k && !r.is_archived)?.value ?? "";
  const u = await userRow(ctx.repo, founder);
  return {
    items: mergePlaybook(t.Playbook.rows),
    links: { calendly: s(`calendly_url_${founder}`), deckFR: s("deck_url_fr"), deckES: s("deck_url_es"), thirty: s("thirty_url") },
    localPrice: `${/^\d{1,6}$/.test(s("offer_local_monthly_eur").trim()) ? s("offer_local_monthly_eur").trim() : "100"} €`,
    founderName: u.display_name.split(" ")[0] ?? u.display_name,
    signature: s(`signature_${founder}`),
    sender: await senderAddress(ctx.repo),
  };
}

export const playbookEditSchema = z.object({
  kind: z.enum(PLAYBOOK_KINDS),
  key: z.string().trim().min(1).max(60),
  language: z.enum(["FR", "ES"]),
  subject: z.string().trim().max(300).default(""),
  /** Empty body = back to the built-in default (a custom template's language version is removed). */
  body: z.string().max(5_000),
  /** The version the founder edited (0 = the built-in text, no row yet). Absent = last write wins (older clients). */
  expected_version: z.number().int().min(0).optional(),
  /** Custom templates only: the name shown on chips. */
  name: z.string().trim().max(80).optional(),
});

function checkLimit(kind: PlaybookItem["kind"], key: string, body: string) {
  const max = textLimit(kind, key);
  if (max !== null && body.trim().length > max) throw new RuleError("Too long: LinkedIn refuses a connection note over 300 characters.");
}

/**
 * Upsert by deterministic id (kind + key + language): a retry or a second founder edits the same row. With
 * `expected_version`, a row saved by the other founder in between is a 409 (ConflictError with their version).
 */
export async function savePlaybookItem(ctx: AppContext, founder: FounderKey, input: z.infer<typeof playbookEditSchema>) {
  const custom = isCustomKey(input.key);
  if (custom && !(CUSTOM_KINDS as readonly string[]).includes(input.kind)) throw new RuleError("Custom templates are for email, WhatsApp or LinkedIn.");
  checkLimit(input.kind, input.key, input.body);
  const id = childId("playbook", input.kind, input.key, input.language);
  const cur = await ctx.repo.get("Playbook", id, { fresh: true });
  const body = input.body.trim();
  // A custom template keeps one name for both languages: the name typed now, else the one of any of its rows.
  const name = custom ? input.name?.trim() || cur?.template_name || (await customName(ctx, input.kind, input.key)) : "";
  if (custom && !cur && !name) throw new RuleError("This template no longer exists.");
  if (cur) {
    if (input.expected_version !== undefined && input.expected_version !== cur.version) throw new ConflictError("Playbook", id, input.expected_version, cur as unknown as Record<string, unknown>);
    return ctx.repo.update("Playbook", id, cur.version, { subject: input.subject, body, is_archived: !body, ...(custom ? { template_name: name } : {}) }, { founder });
  }
  if (!body) return null;
  return (await ctx.repo.insert("Playbook", [{ id, kind: input.kind, key: input.key, language: input.language, subject: input.subject, body, template_name: name }], { founder }))[0];
}

async function customName(ctx: AppContext, kind: string, key: string) {
  const { rows } = await ctx.repo.list("Playbook", { fresh: true });
  return rows.find((r) => r.kind === kind && r.key === key && !r.is_archived && r.template_name)?.template_name ?? "";
}

export const customCreateSchema = z.object({
  /** Client UUID: the key is derived from it, so a retried create never makes a second template. */
  id: z.string().uuid(),
  kind: z.enum(CUSTOM_KINDS),
  name: z.string().trim().min(1).max(80),
  language: z.enum(["FR", "ES"]),
  subject: z.string().trim().max(300).default(""),
  body: z.string().trim().min(1).max(5_000),
});
/** A new template of the founders' own (email / WhatsApp / LinkedIn), first in one language; the other is added by editing it. */
export async function createCustomTemplate(ctx: AppContext, founder: FounderKey, input: z.infer<typeof customCreateSchema>) {
  const key = customKeyOf(input.id);
  const id = childId("playbook", input.kind, key, input.language);
  const cur = await ctx.repo.get("Playbook", id, { fresh: true });
  if (cur) return cur; // retry
  return (await ctx.repo.insert("Playbook", [{ id, kind: input.kind, key, language: input.language, subject: input.subject, body: input.body, template_name: input.name }], { founder }))[0];
}

export const customDeleteSchema = z.object({ kind: z.enum(CUSTOM_KINDS), key: z.string().regex(/^custom_[0-9a-f]{32}$/), expected_versions: z.object({ FR: z.number().int().min(0), ES: z.number().int().min(0) }).partial().default({}) });
/** Deletes a custom template (both languages archived; rows kept for the audit trail). Version-checked per language. */
export async function deleteCustomTemplate(ctx: AppContext, founder: FounderKey, input: z.infer<typeof customDeleteSchema>) {
  const out = [];
  for (const language of ["FR", "ES"] as const) {
    const id = childId("playbook", input.kind, input.key, language);
    const cur = await ctx.repo.get("Playbook", id, { fresh: true });
    if (!cur || cur.is_archived) continue;
    const expected = input.expected_versions[language];
    if (expected !== undefined && expected !== cur.version) throw new ConflictError("Playbook", id, expected, cur as unknown as Record<string, unknown>);
    out.push(await ctx.repo.update("Playbook", id, cur.version, { is_archived: true }, { founder }));
  }
  return { deleted: out.length };
}
