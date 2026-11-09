import type { DataRepository } from "@/data/repository";
import type { BankPort } from "@/data/bank/wise";
import type { StripePort } from "@/data/bank/stripe";
import type { InstagramAccount } from "@/data/instagram/graph";
import type { BackupEnv } from "@/server/services/backups";
import type { CalendarPort, DrivePort, DriveUploader, MailSender } from "@/data/google/ports";

/** Everything a service needs, independent of mode (LIVE, DEMO memory, DEMO fake Sheets, browser preview). */
export interface AppContext {
  repo: DataRepository;
  /** The founder's own private spreadsheet, or null when PRIVATE_SHEET_ID_* is not configured. */
  privateRepo: (founder: string) => DataRepository | null;
  calendar: CalendarPort | null;
  drive: DrivePort | null;
  /** Uploader acting as the founder (drive.file grant), or null when the founder has not granted it. */
  uploaderFor: (founder: string, grantToken: string | null) => DriveUploader | null;
  /** Gmail sender acting as the founder (gmail.send grant), or null when not connected. */
  mailerFor: (founder: string, grantToken: string | null) => MailSender | null;
  /** Wise (read-only) when configured; null otherwise. */
  bank?: BankPort | null;
  /** Stripe (read-only) when configured; null otherwise. */
  payments?: StripePort | null;
  /** Instagram Graph accounts (read-only) when configured in env; null/absent = manual entry (D079). */
  instagram?: InstagramAccount[] | null;
  /** Daily Drive copy of the live spreadsheet (Stage 4B, D084); null/absent in DEMO or without BACKUP_DRIVE_FOLDER_ID. */
  backup?: BackupEnv | null;
  baseUrl: string;
  mode: "live" | "demo";
}
