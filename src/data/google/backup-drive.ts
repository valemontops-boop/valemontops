import type { DriveFile } from "./ports";
import type { GoogleHttp } from "./http";

/**
 * Drive operations of the backup job (Stage 4B, D084), with the service account's own credential and the `drive`
 * scope, limited by sharing to the backups folder. On a personal Google account a service account has no storage
 * quota, so files.copy fails with storageQuotaExceeded unless the folder is in a Shared Drive (Workspace): see
 * docs/DEPLOYMENT.md › Backups for the founder-owned Apps Script alternative.
 */
export interface BackupDrivePort {
  copy(fileId: string, name: string, folderId: string): Promise<DriveFile>;
  list(folderId: string): Promise<DriveFile[]>;
  trash(fileId: string): Promise<void>;
}

const FIELDS = "id,name,mimeType,modifiedTime,webViewLink,parents";

export class GoogleBackupDrive implements BackupDrivePort {
  constructor(private readonly http: GoogleHttp) {}

  async copy(fileId: string, name: string, folderId: string): Promise<DriveFile> {
    // Not retried (not idempotent): a retried copy could make two files. The next trigger retries the day instead.
    const r = await this.http.request<DriveFile>("POST", `/drive/v3/files/${encodeURIComponent(fileId)}/copy`, {
      query: { supportsAllDrives: "true", fields: FIELDS },
      body: { name, parents: [folderId], appProperties: { valemont_backup: "1" } },
      idempotent: false,
    });
    return r.data!;
  }

  async list(folderId: string): Promise<DriveFile[]> {
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(folderId)) return [];
    const r = await this.http.request<{ files?: DriveFile[] }>("GET", "/drive/v3/files", {
      query: { q: `'${folderId}' in parents and trashed = false`, fields: `files(${FIELDS})`, pageSize: "200", orderBy: "name desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true" },
      idempotent: true,
    });
    return r.data?.files ?? [];
  }

  async trash(fileId: string): Promise<void> {
    await this.http.request("PATCH", `/drive/v3/files/${encodeURIComponent(fileId)}`, { query: { supportsAllDrives: "true" }, body: { trashed: true }, idempotent: true, allow404: true });
  }
}
