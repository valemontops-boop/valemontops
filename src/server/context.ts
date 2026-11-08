import type { DataRepository } from "@/data/repository";
import type { CalendarPort, DrivePort, DriveUploader } from "@/data/google/ports";

/** Everything a service needs, independent of mode (LIVE, DEMO memory, DEMO fake Sheets, browser preview). */
export interface AppContext {
  repo: DataRepository;
  /** The founder's own private spreadsheet, or null when PRIVATE_SHEET_ID_* is not configured. */
  privateRepo: (founder: string) => DataRepository | null;
  calendar: CalendarPort | null;
  drive: DrivePort | null;
  /** Uploader acting as the founder (drive.file grant), or null when the founder has not granted it. */
  uploaderFor: (founder: string, grantToken: string | null) => DriveUploader | null;
  baseUrl: string;
  mode: "live" | "demo";
}
