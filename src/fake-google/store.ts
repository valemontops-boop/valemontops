import type { CalEvent, CalendarPort, DriveFile, DrivePort, DriveUploader, MailSender, NewCalEvent } from "../data/google/ports";

/**
 * In-memory Google Calendar + Drive used by DEMO (directly, via memory ports) and by tests
 * (through the HTTP fake server). Synthetic data only.
 */
export class FakeGoogleStore {
  calendars = new Map<string, CalEvent[]>();
  files: (DriveFile & { owner: string; trashed?: boolean })[] = [];
  /** Folders that live in a Shared Drive: there the service account can create files (D084 backups). */
  sharedDriveFolders = new Set<string>();
  /** who performed writes: "service-account" or a founder token label */
  writes: { kind: string; by: string }[] = [];
  /** Emails "sent" through the fake Gmail: they never leave the process. */
  sentMail: { id: string; threadId: string; to: string; subject: string; body: string; from?: string; by: string }[] = [];

  sendMail(m: { to: string; subject: string; body: string; from?: string }, by: string) {
    const id = `msg-${this.sentMail.length + 1}`;
    const rec = { id, threadId: `thr-${this.sentMail.length + 1}`, ...m, by };
    this.sentMail.push(rec);
    this.writes.push({ kind: "gmail.send", by });
    return { id: rec.id, threadId: rec.threadId };
  }

  addCalendar(id: string) {
    if (!this.calendars.has(id)) this.calendars.set(id, []);
  }
  addEvent(calendarId: string, e: Omit<CalEvent, "calendarId" | "status" | "htmlLink"> & { status?: CalEvent["status"] }) {
    this.addCalendar(calendarId);
    const ev: CalEvent = { status: "confirmed", htmlLink: `https://calendar.example.com/event?eid=${e.id}`, ...e, calendarId };
    this.calendars.get(calendarId)!.push(ev);
    return ev;
  }
  /** Simulates a founder moving or deleting an event directly in Google Calendar. */
  moveEvent(calendarId: string, id: string, start: string, end: string) {
    const ev = this.calendars.get(calendarId)?.find((e) => e.id === id);
    if (ev) Object.assign(ev, { start, end });
  }
  deleteEvent(calendarId: string, id: string) {
    const ev = this.calendars.get(calendarId)?.find((e) => e.id === id);
    if (ev) ev.status = "cancelled";
  }

  list(calendarId: string, timeMin: string, timeMax: string) {
    const evs = this.calendars.get(calendarId);
    if (!evs) throw Object.assign(new Error("Not Found"), { status: 404 });
    return evs.filter((e) => e.status === "confirmed" && e.end > timeMin && e.start < timeMax).sort((a, b) => a.start.localeCompare(b.start));
  }
  busy(calendarId: string, timeMin: string, timeMax: string) {
    return (this.calendars.get(calendarId) ?? []).filter((e) => e.status === "confirmed" && e.end > timeMin && e.start < timeMax).map((e) => ({ start: e.start, end: e.end }));
  }
  insert(calendarId: string, ev: NewCalEvent, by: string): { created: boolean; event: CalEvent } {
    this.addCalendar(calendarId);
    const existing = this.calendars.get(calendarId)!.find((e) => e.id === ev.id);
    if (existing) return { created: false, event: existing };
    this.writes.push({ kind: "calendar.insert", by });
    return { created: true, event: this.addEvent(calendarId, { id: ev.id, title: ev.title, description: ev.description, start: ev.start, end: ev.end }) };
  }
  get(calendarId: string, id: string) {
    return this.calendars.get(calendarId)?.find((e) => e.id === id) ?? null;
  }

  addFile(f: Partial<DriveFile> & { id: string; name: string; parents: string[] }, owner = "founder") {
    const file = { mimeType: "application/pdf", modifiedTime: new Date().toISOString(), webViewLink: `https://drive.example.com/file/${f.id}`, owner, ...f };
    this.files.push(file);
    return file;
  }
  listFiles(folderId: string, search?: string) {
    return this.files.filter((f) => !f.trashed && f.parents.includes(folderId) && (!search || f.name.toLowerCase().includes(search.toLowerCase())));
  }
  searchFiles(q: string) {
    return this.files.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  }
  recentFiles(limit: number) {
    return this.files.filter((f) => f.mimeType !== "application/vnd.google-apps.folder").sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)).slice(0, limit);
  }
}

export class MemoryCalendar implements CalendarPort {
  constructor(private readonly s: FakeGoogleStore) {}
  async listEvents(c: string, a: string, b: string) {
    return structuredClone(this.s.list(c, a, b));
  }
  async freeBusy(ids: string[], a: string, b: string) {
    return Object.fromEntries(ids.map((id) => [id, this.s.busy(id, a, b)]));
  }
  async insertEvent(c: string, ev: NewCalEvent) {
    return structuredClone(this.s.insert(c, ev, "service-account"));
  }
  async getEvent(c: string, id: string) {
    const e = this.s.get(c, id);
    return e ? structuredClone(e) : null;
  }
}
export class MemoryDrive implements DrivePort {
  constructor(private readonly s: FakeGoogleStore) {}
  async list(folderId: string, search?: string) {
    return structuredClone(this.s.listFiles(folderId, search));
  }
  async get(id: string) {
    return structuredClone(this.s.files.find((f) => f.id === id) ?? null);
  }
  async search(q: string) {
    return structuredClone(this.s.searchFiles(q));
  }
  async recent(limit: number) {
    return structuredClone(this.s.recentFiles(limit));
  }
}
export class MemoryDriveUploader implements DriveUploader {
  constructor(private readonly s: FakeGoogleStore, private readonly founder: string) {}
  async upload(name: string, mimeType: string, _bytes: Uint8Array, parentId: string | null) {
    this.s.writes.push({ kind: "drive.upload", by: this.founder });
    return this.s.addFile({ id: `upl-${crypto.randomUUID()}`, name, mimeType, parents: parentId ? [parentId] : [] }, this.founder);
  }
  async createFolder(name: string, parentId: string | null) {
    this.s.writes.push({ kind: "drive.folder", by: this.founder });
    return this.s.addFile({ id: `fld-${crypto.randomUUID()}`, name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : [] }, this.founder);
  }
}
export class MemoryMailer implements MailSender {
  constructor(private readonly s: FakeGoogleStore, private readonly founder: string) {}
  async send(m: { to: string; subject: string; body: string; from?: string }) {
    return this.s.sendMail(m, this.founder);
  }
}
