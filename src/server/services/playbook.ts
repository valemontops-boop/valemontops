import { z } from "zod";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { mergePlaybook, type PlaybookItem } from "@/domain/playbook";
import type { AppContext } from "../context";
import { userRow } from "./common";

export interface PlaybookData {
  items: PlaybookItem[];
  links: { calendly: string; deckFR: string; deckES: string };
  founderName: string;
  /** The founder's email signature (Settings › Workspace); empty = "First name / Valemont". */
  signature: string;
}

/** Scripts and templates (defaults + founder edits) and the links they insert, for the signed-in founder. */
export async function getPlaybook(ctx: AppContext, founder: FounderKey): Promise<PlaybookData> {
  const t = await ctx.repo.listMany(["Playbook", "SystemSettings"]);
  const s = (k: string) => t.SystemSettings.rows.find((r) => r.key === k && !r.is_archived)?.value ?? "";
  const u = await userRow(ctx.repo, founder);
  return {
    items: mergePlaybook(t.Playbook.rows),
    links: { calendly: s(`calendly_url_${founder}`), deckFR: s("deck_url_fr"), deckES: s("deck_url_es") },
    founderName: u.display_name.split(" ")[0] ?? u.display_name,
    signature: s(`signature_${founder}`),
  };
}

export const playbookEditSchema = z.object({
  kind: z.enum(["opener", "objection", "email", "whatsapp"]),
  key: z.string().trim().min(1).max(60),
  language: z.enum(["FR", "ES"]),
  subject: z.string().trim().max(300).default(""),
  /** Empty body = back to the built-in default. */
  body: z.string().max(5_000),
});

/** Upsert by deterministic id (kind + key + language): a retry or a second founder edits the same row. */
export async function savePlaybookItem(ctx: AppContext, founder: FounderKey, input: z.infer<typeof playbookEditSchema>) {
  const id = childId("playbook", input.kind, input.key, input.language);
  const cur = await ctx.repo.get("Playbook", id, { fresh: true });
  if (cur) return ctx.repo.update("Playbook", id, cur.version, { subject: input.subject, body: input.body.trim(), is_archived: !input.body.trim() }, { founder });
  if (!input.body.trim()) return null;
  return (await ctx.repo.insert("Playbook", [{ id, kind: input.kind, key: input.key, language: input.language, subject: input.subject, body: input.body.trim() }], { founder }))[0];
}
