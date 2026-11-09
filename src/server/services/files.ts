import { z } from "zod";
import { childId } from "@/lib/ids";
import type { FounderKey } from "@/domain/constants";
import { ConsentRequiredError } from "@/data/google/ports";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { settingValue } from "./common";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Read path (spec 4.8): the Valemont OS folder shared with the service account; no per-user token. */
export async function listFolder(ctx: AppContext, folderId: string | null, search: string, view: "folder" | "recent" | "search" = "folder") {
  const root = await settingValue(ctx.repo, "drive_folder_id");
  if (!ctx.drive || !root) return { configured: false as const, root: null, folderId: null, files: [], links: [], view };
  const id = folderId || root;
  const files = view === "recent" ? await ctx.drive.recent(30) : view === "search" && search ? await ctx.drive.search(search) : await ctx.drive.list(id, search || undefined);
  const links = (await ctx.repo.list("FilesIndex")).rows.filter((l) => !l.is_archived);
  return { configured: true as const, root, folderId: id, files, links, view };
}

export const folderSchema = z.object({ name: z.string().trim().min(1).max(120), parent_id: z.string().max(200).nullable().default(null) });
/** New folder: created with the founder's own drive.file grant (never the service account). */
export async function createFolder(ctx: AppContext, founder: FounderKey, grant: string | null, input: z.infer<typeof folderSchema>) {
  const uploader = ctx.uploaderFor(founder, grant);
  if (!uploader) throw new ConsentRequiredError("https://www.googleapis.com/auth/drive.file", "/api/auth/google/drive");
  return uploader.createFolder(input.name, input.parent_id || (await settingValue(ctx.repo, "drive_folder_id")));
}

export const linkSchema = z.object({ file_id: z.string().min(1).max(200), record_type: z.enum(["account", "opportunity", "task", "idea"]), record_id: z.string().uuid() });
export async function linkFile(ctx: AppContext, founder: FounderKey, input: z.infer<typeof linkSchema>) {
  if (!ctx.drive) throw new RuleError("Google Drive is not configured.");
  const f = await ctx.drive.get(input.file_id);
  if (!f) throw new RuleError("That file is not visible to Valemont OS. Put it in the shared folder first.");
  const id = childId("filelink", input.file_id, input.record_type, input.record_id);
  if (await ctx.repo.get("FilesIndex", id, { fresh: true })) return { duplicate: true };
  await ctx.repo.insert("FilesIndex", [{ id, file_id: f.id, name: f.name, mime_type: f.mimeType, url: f.webViewLink, record_type: input.record_type, record_id: input.record_id, linked_by: founder }], { founder });
  return { duplicate: false };
}
export async function filesFor(ctx: AppContext, recordType: string, recordId: string) {
  return (await ctx.repo.list("FilesIndex")).rows.filter((l) => !l.is_archived && l.record_type === recordType && l.record_id === recordId);
}

export const uploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mime_type: z.string().trim().min(3).max(120),
  data_base64: z.string().max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8),
  record_type: z.enum(["account", "opportunity", "task", "idea"]).nullable().default(null),
  record_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  parent_id: z.string().max(200).nullable().default(null),
});

/**
 * Write path: always the signed-in founder's own drive.file grant. Without it, ask for consent;
 * never fall back to the service account (spec 4.8, scenario 20).
 */
export async function uploadFile(ctx: AppContext, founder: FounderKey, grant: string | null, input: z.infer<typeof uploadSchema>) {
  const uploader = ctx.uploaderFor(founder, grant);
  if (!uploader) throw new ConsentRequiredError("https://www.googleapis.com/auth/drive.file", "/api/auth/google/drive");
  const bytes = Uint8Array.from(Buffer.from(input.data_base64, "base64"));
  if (bytes.length > MAX_UPLOAD_BYTES) throw new RuleError("File too large (max 8 MB).");
  const parent = input.parent_id || (await settingValue(ctx.repo, "drive_folder_id"));
  const f = await uploader.upload(input.name, input.mime_type, bytes, parent);
  if (input.record_type && input.record_id) {
    await ctx.repo.insert("FilesIndex", [{ id: childId("filelink", f.id, input.record_type, input.record_id), file_id: f.id, name: f.name, mime_type: f.mimeType, url: f.webViewLink, record_type: input.record_type, record_id: input.record_id, linked_by: founder }], { founder });
  }
  return f;
}
