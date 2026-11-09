/** Ports for Google Calendar and Drive. HTTP adapters talk to Google (or the fake server); memory ports serve DEMO. */

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  start: string; // ISO
  end: string;
  status: "confirmed" | "cancelled";
  htmlLink: string;
}

export interface NewCalEvent {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  recurrence?: string[];
}

export interface CalendarPort {
  listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<CalEvent[]>;
  freeBusy(calendarIds: string[], timeMin: string, timeMax: string): Promise<Record<string, { start: string; end: string }[]>>;
  /** Idempotent: an existing id is returned with created=false. */
  insertEvent(calendarId: string, ev: NewCalEvent): Promise<{ created: boolean; event: CalEvent }>;
  getEvent(calendarId: string, eventId: string): Promise<CalEvent | null>;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  parents: string[];
  ownedByMe?: boolean;
  size?: string;
  iconLink?: string;
  /** Short-lived thumbnail URL served by Drive (images, videos, PDFs), when Drive has one. */
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number };
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string | number };
}

export interface DrivePort {
  list(folderId: string, search?: string): Promise<DriveFile[]>;
  get(fileId: string): Promise<DriveFile | null>;
  /** Everything the service account can see (the shared folder tree): name search or most recent. */
  search(query: string): Promise<DriveFile[]>;
  recent(limit: number): Promise<DriveFile[]>;
}

/** Writes always use the signed-in founder's own drive.file grant, never the service account (spec 4.8). */
export interface DriveUploader {
  upload(name: string, mimeType: string, bytes: Uint8Array, parentId: string | null): Promise<DriveFile>;
  createFolder(name: string, parentId: string | null): Promise<DriveFile>;
}

export class ConsentRequiredError extends Error {
  readonly code = "consent_required";
  constructor(readonly scope: string, readonly url: string) {
    super("Google permission needed for this action");
  }
}

/** Sends one plain-text email as the founder (gmail.send only: no inbox read, spec 4.15). */
export interface MailSender {
  /** `from` (D090): the Valemont sending address; Gmail only honours it for the account itself or one of its aliases. */
  send(msg: { to: string; subject: string; body: string; from?: string }): Promise<{ id: string; threadId: string }>;
}
