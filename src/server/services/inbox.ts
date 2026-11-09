import { z } from "zod";
import type { Row } from "@/data/schema/tables";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { dedupeEvents } from "@/domain/activity";
import { mergePlaybook } from "@/domain/playbook";
import { INBOX_SOURCES, INBOX_STATUSES, clip, deriveInboxItems, inboxItemInputSchema, safeUrl, suggestReplies, type InboxItemInput } from "@/domain/inbox";
import { childId, newId } from "@/lib/ids";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { settingValue } from "./common";

const SYSTEM = { founder: "system" };
export const inboxId = (externalId: string) => childId("inbox", externalId);

/** Stores new items; an external_id already stored (webhook retried, same comment twice) adds nothing. */
export async function ingestInboxItems(ctx: AppContext, items: InboxItemInput[], actor: { founder: string } = SYSTEM) {
  const have = new Set((await ctx.repo.list("InboxItems", { fresh: true })).rows.map((r) => r.id));
  const fresh = new Map<string, InboxItemInput>();
  for (const it of items) { const id = inboxId(it.external_id); if (!have.has(id) && !fresh.has(id)) fresh.set(id, it); }
  const now = new Date().toISOString();
  if (fresh.size) {
    await ctx.repo.insert("InboxItems", [...fresh.entries()].map(([id, it]) => ({
      id, source: it.source, account_label: it.account_label, from_name: it.from_name, excerpt: it.excerpt, url: it.url,
      received_at: it.received_at ? new Date(it.received_at).toISOString() : now, status: "to_reply" as const, assigned_founder: it.assigned_founder, replied_at: null, external_id: it.external_id,
    })), actor);
  }
  return { added: fresh.size, duplicates: items.length - fresh.size };
}

/** Labels of our Instagram accounts by their Instagram id, from the setting `instagram_account_labels` ({"<id>": "Instagram Valemont"}). */
export async function instagramLabels(ctx: AppContext): Promise<(id: string) => string> {
  let map: Record<string, string> = {};
  try { map = JSON.parse((await settingValue(ctx.repo, "instagram_account_labels")) ?? "{}"); } catch { /* keep default */ }
  return (id) => clip(map[id] ?? "Instagram", 120);
}

export const inboxListSchema = z.object({ scope: z.enum(["me", "team"]).default("me") });
export type InboxView = Awaited<ReturnType<typeof listInbox>>["items"][number];

/** Items still to reply to (stored + derived), oldest first, each with three suggested replies in the founder's language. */
export async function listInbox(ctx: AppContext, founder: FounderKey, input: z.infer<typeof inboxListSchema>) {
  const t = await ctx.repo.listMany(["InboxItems", "EmailSends", "ActivityEvents", "Accounts", "SystemSettings", "Playbook"]);
  const templates = mergePlaybook(t.Playbook.rows); // replies edited in Settings › Templates (D090)
  const stored = new Map(t.InboxItems.rows.filter((r) => !r.is_archived).map((r) => [r.id, r]));
  const derived = deriveInboxItems({ sends: t.EmailSends.rows, events: dedupeEvents(t.ActivityEvents.rows), accounts: t.Accounts.rows, now: new Date() })
    .map((d) => ({ ...d, id: inboxId(d.external_id) }))
    .filter((d) => !stored.has(d.id)); // a derived item marked replied/ignored is stored with its status
  const calendly = t.SystemSettings.rows.find((r) => r.key === `calendly_url_${founder}` && !r.is_archived)?.value ?? null;
  const language = founder === "pablo" ? "ES" : "FR";
  const visible = (f: string | null) => input.scope === "team" || f === null || f === founder;
  const fromRow = (r: Row<"InboxItems">) => ({ id: r.id, version: r.version, source: r.source, account_label: r.account_label, from_name: r.from_name, excerpt: r.excerpt, url: r.url, received_at: r.received_at, assigned_founder: r.assigned_founder, summary: "", derived: false });
  const items = [
    ...[...stored.values()].filter((r) => r.status === "to_reply").map(fromRow),
    ...derived.map((d) => ({ id: d.id, version: 0, source: d.source, account_label: d.account_label, from_name: d.from_name, excerpt: d.excerpt, url: d.url, received_at: d.received_at, assigned_founder: d.assigned_founder, summary: d.summary, derived: true })),
  ]
    .filter((x) => visible(x.assigned_founder))
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .map((x) => ({ ...x, replies: suggestReplies(x, language, calendly, templates) }));
  return { items, count: items.length };
}

export const inboxStatusSchema = z.object({ id: z.string().uuid(), status: z.enum(INBOX_STATUSES), expected_version: z.number().int().min(0) });
/** "Replied" / "Ignored" (or back to "to reply"). A derived item gets its row now; a stored one is updated with a version check (409 on conflict). */
export async function setInboxStatus(ctx: AppContext, founder: FounderKey, input: z.infer<typeof inboxStatusSchema>) {
  const patch = { status: input.status, replied_at: input.status === "replied" ? new Date().toISOString() : null };
  const cur = await ctx.repo.get("InboxItems", input.id, { fresh: true });
  if (cur) return ctx.repo.update("InboxItems", cur.id, input.expected_version, patch, { founder });
  const t = await ctx.repo.listMany(["EmailSends", "ActivityEvents", "Accounts"], { fresh: true });
  const d = deriveInboxItems({ sends: t.EmailSends.rows, events: dedupeEvents(t.ActivityEvents.rows), accounts: t.Accounts.rows, now: new Date() }).find((x) => inboxId(x.external_id) === input.id);
  if (!d) throw new RuleError("Item not found");
  const [row] = await ctx.repo.insert("InboxItems", [{ id: input.id, source: d.source, account_label: d.account_label, from_name: d.from_name, excerpt: d.excerpt, url: d.url, received_at: d.received_at, assigned_founder: d.assigned_founder, external_id: d.external_id, ...patch }], { founder });
  return row;
}

export const inboxAddSchema = z.object({
  source: z.enum(INBOX_SOURCES),
  account_label: z.string().trim().max(120).default(""),
  from_name: z.string().trim().max(200).default(""),
  excerpt: z.string().max(5_000).default("").transform((s) => clip(s, 500)),
  url: z.string().trim().max(1000).default("").refine((v) => !v || safeUrl(v) !== "", "Only http(s) links").transform(safeUrl),
  assigned_founder: z.enum(FOUNDERS).nullable().default(null),
});
/** Manual add: a comment or message seen elsewhere (LinkedIn notification, phone). */
export async function addInboxItem(ctx: AppContext, founder: FounderKey, input: z.infer<typeof inboxAddSchema>) {
  if (!input.from_name && !input.excerpt) throw new RuleError("Say who wrote or what they wrote.");
  const item = inboxItemInputSchema.parse({ ...input, external_id: `manual:${newId()}`, received_at: new Date().toISOString() });
  await ingestInboxItems(ctx, [item], { founder });
  return { id: inboxId(item.external_id) };
}

