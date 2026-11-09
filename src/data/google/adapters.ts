import { GoogleHttp } from "./http";
import type { CalEvent, CalendarPort, DriveFile, DrivePort, DriveUploader, MailSender, NewCalEvent } from "./ports";

type GEvent = { id: string; summary?: string; description?: string; status?: string; htmlLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };
const toEvent = (calendarId: string, e: GEvent): CalEvent => ({
  id: e.id,
  calendarId,
  title: e.summary ?? "",
  description: e.description ?? "",
  start: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00.000Z` : ""),
  end: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00.000Z` : ""),
  status: e.status === "cancelled" ? "cancelled" : "confirmed",
  htmlLink: e.htmlLink ?? "",
});

/** Google Calendar v3 through calendars shared with the service account (no per-user token). */
export class GoogleCalendarAdapter implements CalendarPort {
  constructor(private readonly http: GoogleHttp) {}
  private path(calendarId: string, rest = "") {
    return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${rest}`;
  }
  async listEvents(calendarId: string, timeMin: string, timeMax: string) {
    const r = await this.http.request<{ items?: GEvent[] }>("GET", this.path(calendarId), { idempotent: true, query: { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" } });
    return (r.data?.items ?? []).map((e) => toEvent(calendarId, e));
  }
  async freeBusy(calendarIds: string[], timeMin: string, timeMax: string) {
    const r = await this.http.request<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>("POST", "/calendar/v3/freeBusy", { idempotent: true, body: { timeMin, timeMax, items: calendarIds.map((id) => ({ id })) } });
    return Object.fromEntries(calendarIds.map((id) => [id, r.data?.calendars?.[id]?.busy ?? []]));
  }
  async insertEvent(calendarId: string, ev: NewCalEvent) {
    const body = { id: ev.id, summary: ev.title, description: ev.description, start: { dateTime: ev.start }, end: { dateTime: ev.end }, ...(ev.recurrence ? { recurrence: ev.recurrence } : {}) };
    // Client-supplied id makes the insert retry-safe: a 409 means it already exists (spec 4.13).
    const r = await this.http.request<GEvent>("POST", this.path(calendarId), { idempotent: true, body, allow409: true });
    if (r.status === 409) {
      const existing = await this.getEvent(calendarId, ev.id);
      if (!existing) throw new Error("Event id conflict but event not readable");
      return { created: false, event: existing };
    }
    return { created: true, event: toEvent(calendarId, r.data!) };
  }
  async getEvent(calendarId: string, eventId: string) {
    const r = await this.http.request<GEvent>("GET", this.path(calendarId, `/${encodeURIComponent(eventId)}`), { idempotent: true, allow404: true });
    return r.data ? toEvent(calendarId, r.data) : null;
  }
}

const FIELDS = "id,name,mimeType,modifiedTime,webViewLink,parents,ownedByMe,size,iconLink,thumbnailLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)";

/** Drive read path: the Valemont OS folder shared with the service account as Viewer. */
export class GoogleDriveAdapter implements DrivePort {
  constructor(private readonly http: GoogleHttp) {}
  async list(folderId: string, search?: string) {
    const safe = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = [`'${safe(folderId)}' in parents`, "trashed = false", ...(search ? [`name contains '${safe(search)}'`] : [])].join(" and ");
    const r = await this.http.request<{ files?: DriveFile[] }>("GET", "/drive/v3/files", { idempotent: true, query: { q, fields: `files(${FIELDS})`, pageSize: "200", orderBy: "folder,name", supportsAllDrives: "true", includeItemsFromAllDrives: "true" } });
    return r.data?.files ?? [];
  }
  async get(fileId: string) {
    const r = await this.http.request<DriveFile>("GET", `/drive/v3/files/${encodeURIComponent(fileId)}`, { idempotent: true, allow404: true, query: { fields: FIELDS, supportsAllDrives: "true" } });
    return r.data;
  }
  async search(query: string) {
    const q = `name contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
    const r = await this.http.request<{ files?: DriveFile[] }>("GET", "/drive/v3/files", { idempotent: true, query: { q, fields: `files(${FIELDS})`, pageSize: "50", orderBy: "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true" } });
    return r.data?.files ?? [];
  }
  async recent(limit: number) {
    const r = await this.http.request<{ files?: DriveFile[] }>("GET", "/drive/v3/files", { idempotent: true, query: { q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'", fields: `files(${FIELDS})`, pageSize: String(limit), orderBy: "modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true" } });
    return r.data?.files ?? [];
  }
}

/** Write path with the founder's own drive.file token (file owned by the founder, uses their quota). */
export class GoogleDriveUploader implements DriveUploader {
  constructor(private readonly http: GoogleHttp) {}
  async upload(name: string, mimeType: string, bytes: Uint8Array, parentId: string | null) {
    const boundary = `vos${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, mimeType, ...(parentId ? { parents: [parentId] } : {}) });
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const data = new Uint8Array(head.length + bytes.length + tail.length);
    data.set(head);
    data.set(bytes, head.length);
    data.set(tail, head.length + bytes.length);
    const r = await this.http.request<DriveFile>("POST", "/upload/drive/v3/files", { idempotent: false, query: { uploadType: "multipart", fields: FIELDS }, raw: { contentType: `multipart/related; boundary=${boundary}`, data } });
    return r.data!;
  }
  async createFolder(name: string, parentId: string | null) {
    const r = await this.http.request<DriveFile>("POST", "/drive/v3/files", { idempotent: false, query: { fields: FIELDS }, body: { name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) } });
    return r.data!;
  }
}

/** RFC 2822 message, UTF-8 subject (RFC 2047) and base64 body. CR/LF are stripped from headers (no header injection). */
export function buildRawEmail(to: string, subject: string, body: string, from = ""): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const subj = `=?UTF-8?B?${Buffer.from(clean(subject), "utf8").toString("base64")}?=`;
  const b64 = Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const msg = [...(clean(from) ? [`From: ${clean(from)}`] : []), `To: ${clean(to)}`, `Subject: ${subj}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64].join("\r\n");
  return Buffer.from(msg, "utf8").toString("base64url");
}

/** Gmail send with the founder's own short-lived gmail.send token. Never retried: a send is not idempotent. */
export class GmailSender implements MailSender {
  constructor(private readonly http: GoogleHttp) {}
  async send(msg: { to: string; subject: string; body: string; from?: string }) {
    const r = await this.http.request<{ id: string; threadId: string }>("POST", "/gmail/v1/users/me/messages/send", { idempotent: false, body: { raw: buildRawEmail(msg.to, msg.subject, msg.body, msg.from ?? "") } });
    return { id: r.data?.id ?? "", threadId: r.data?.threadId ?? "" };
  }
}
