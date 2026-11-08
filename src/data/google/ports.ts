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
}

export interface DrivePort {
  list(folderId: string, search?: string): Promise<DriveFile[]>;
  get(fileId: string): Promise<DriveFile | null>;
}

/** Writes always use the signed-in founder's own drive.file grant, never the service account (spec 4.8). */
export interface DriveUploader {
  upload(name: string, mimeType: string, bytes: Uint8Array, parentId: string | null): Promise<DriveFile>;
}

export class ConsentRequiredError extends Error {
  readonly code = "consent_required";
  constructor(readonly scope: string, readonly url: string) {
    super("Google permission needed for this action");
  }
}
