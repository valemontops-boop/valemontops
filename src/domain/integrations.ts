/**
 * Integrations Hub (spec 7, Stage 4A, D083): the honest capability matrix. Pure data and the status mapping;
 * the server reads env presence (names only, never values), IntegrationStatuses rows and grants, then maps here.
 */

export const INTEGRATION_KEYS = [
  "sheets", "signin", "drive", "calendar", "gmail", "wise", "stripe", "instagram", "linkedin", "ga4", "search_console", "website", "inbox", "tracker", "snapshot", "backup",
] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

/** How data moves: what the app is allowed to do with the provider. */
export type IntegrationMode = "two_way" | "sign_in" | "read_only" | "send_only" | "import" | "webhook_in" | "webhook_out" | "scheduler";
/** Statuses shown to founders. No "connected" without a real credential in LIVE (spec 7: no false indicators). */
export const HUB_STATUSES = ["connected", "not_configured", "error", "needs_renewal", "import_only", "pending_approval", "demo"] as const;
export type HubStatus = (typeof HUB_STATUSES)[number];
export type HubAction = "test" | "sync" | "reauthorize";

export interface EnvVarSpec { name: string; required: boolean }
export interface IntegrationSpec {
  key: IntegrationKey;
  name: string;
  /** One sentence (English source, translated by t()): what it does. */
  does: string;
  mode: IntegrationMode;
  /** "import" = files only; "approval" = API not allowed before a vetted approval (LinkedIn); "credential" = env or grant. */
  kind: "credential" | "import" | "approval";
  env: EnvVarSpec[];
  /** OAuth scopes requested (least privilege), when any. */
  scopes: string[];
  actions: HubAction[];
  /** Anchor in docs/INTEGRATIONS.md. */
  docs: string;
  /** In-app place where the founder uses it. */
  href: string | null;
  /** Sentence shown under the card (English source), e.g. the weekly re-consent of an External app in Testing. */
  note: string;
}

const env = (required: string[], optional: string[] = []): EnvVarSpec[] => [...required.map((name) => ({ name, required: true })), ...optional.map((name) => ({ name, required: false }))];

/** Tracker env names are per founder: `{F}` is replaced by THEO or PABLO. */
export const INTEGRATIONS: readonly IntegrationSpec[] = [
  { key: "sheets", name: "Google Sheets", does: "The only business database: every record is read from and written to the shared Sheet.", mode: "two_way", kind: "credential", env: env(["SHEETS_SPREADSHEET_ID", "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64"], ["PRIVATE_SHEET_ID_THEO", "PRIVATE_SHEET_ID_PABLO"]), scopes: ["spreadsheets (service account)"], actions: ["test"], docs: "google-sheets", href: null, note: "" },
  { key: "signin", name: "Google Sign-In", does: "Sign-in restricted to the two founders' Google addresses, basic scopes only.", mode: "sign_in", kind: "credential", env: env(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "FOUNDER_THEO_EMAIL", "FOUNDER_PABLO_EMAIL", "APP_BASE_URL"]), scopes: ["openid", "email", "profile"], actions: [], docs: "google-sign-in", href: null, note: "" },
  { key: "drive", name: "Google Drive", does: "Reads the shared Valemont folder (service account) and saves files with your own drive.file permission.", mode: "read_only", kind: "credential", env: env(["GOOGLE_SERVICE_ACCOUNT_KEY_BASE64"]), scopes: ["drive.readonly (service account)", "drive.file (each founder)"], actions: ["test", "reauthorize"], docs: "google-drive", href: "/files", note: "drive.file access lasts about an hour and is asked again with one click; nothing is stored in Sheets." },
  { key: "calendar", name: "Google Calendar", does: "Reads the calendars shared with the service account; the other founder's calendar as free/busy only.", mode: "read_only", kind: "credential", env: env(["GOOGLE_SERVICE_ACCOUNT_KEY_BASE64"]), scopes: ["calendar.events (service account)", "calendar.freebusy (service account)"], actions: ["test"], docs: "google-calendar", href: "/agenda", note: "Personal Calendar OAuth (invitations, Meet links) is off by default and not enabled." },
  { key: "gmail", name: "Gmail", does: "Sends approved emails from your own Gmail after a click. Never reads your inbox.", mode: "send_only", kind: "credential", env: env(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]), scopes: ["gmail.send"], actions: ["reauthorize"], docs: "gmail", href: "/call", note: "With an External app in Testing, Google asks for consent again at least every 7 days; a Workspace Internal app avoids it." },
  { key: "wise", name: "Wise", does: "Balances and statements of the business account, read-only. Cannot move money.", mode: "read_only", kind: "credential", env: env(["WISE_API_TOKEN"], ["WISE_PROFILE_ID", "WISE_SCA_PRIVATE_KEY_BASE64", "WISE_WEBHOOK_PUBLIC_KEY_BASE64"]), scopes: ["read-only token"], actions: ["test", "sync"], docs: "wise", href: "/money", note: "" },
  { key: "stripe", name: "Stripe", does: "Balance, sales, fees, payouts and MRR, read-only. Cannot charge or refund.", mode: "read_only", kind: "credential", env: env(["STRIPE_API_KEY"], ["STRIPE_WEBHOOK_SECRET"]), scopes: ["restricted key: Read"], actions: ["test", "sync"], docs: "stripe", href: "/money", note: "" },
  { key: "instagram", name: "Instagram", does: "Account and post statistics of our own professional accounts, read-only.", mode: "read_only", kind: "credential", env: env(["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"], ["INSTAGRAM_ACCOUNTS_JSON", "INSTAGRAM_TOKEN_EXPIRES_AT", "INSTAGRAM_ACCOUNT_KEY"]), scopes: ["instagram_basic", "instagram_manage_insights"], actions: ["test", "sync"], docs: "instagram-and-the-snapshot-job", href: "/marketing/content", note: "" },
  { key: "linkedin", name: "LinkedIn", does: "Page and creator statistics from LinkedIn's export files. Outreach stays manual.", mode: "import", kind: "approval", env: [], scopes: [], actions: [], docs: "linkedin", href: "/marketing", note: "API adapter only after Community Management API approval. No scraping, no automated messages." },
  { key: "ga4", name: "Google Analytics 4", does: "Website sessions and leads by source, from a GA4 CSV export.", mode: "import", kind: "import", env: [], scopes: [], actions: [], docs: "ga4-and-search-console", href: "/marketing", note: "" },
  { key: "search_console", name: "Search Console", does: "Queries and pages (clicks, impressions, position), from a Search Console CSV export.", mode: "import", kind: "import", env: [], scopes: [], actions: [], docs: "ga4-and-search-console", href: "/marketing", note: "" },
  { key: "website", name: "Website forms", does: "Contact, lead and booking forms of the FR/ES sites become an inbound lead and an item to reply to.", mode: "webhook_in", kind: "credential", env: env(["WEBSITE_WEBHOOK_SECRET"]), scopes: [], actions: ["test"], docs: "website-forms-webhook", href: null, note: "Signed (HMAC-SHA256), 5-minute window, one event id counted once." },
  { key: "inbox", name: "To reply inbox", does: "Comments and messages pushed by a relay (Make, Zapier, n8n) or by Meta, to reply by hand.", mode: "webhook_in", kind: "credential", env: env(["INBOX_WEBHOOK_SECRET"], ["META_APP_SECRET", "META_VERIFY_TOKEN"]), scopes: [], actions: ["test"], docs: "inbox", href: "/my-day", note: "Nothing is ever sent automatically." },
  { key: "tracker", name: "My tracker", does: "Sends each of your activities to your personal tracker (signed), and a pull feed.", mode: "webhook_out", kind: "credential", env: env(["TRACKER_WEBHOOK_URL_{F}", "TRACKER_WEBHOOK_SECRET_{F}"], ["TRACKER_FEED_TOKEN_{F}", "TRACKER_DAILY_SUMMARY_{F}"]), scopes: [], actions: ["test"], docs: "my-tracker", href: null, note: "" },
  { key: "snapshot", name: "Snapshot job", does: "Captures Instagram numbers every 6 hours when an external scheduler calls the job.", mode: "scheduler", kind: "credential", env: env([], ["SNAPSHOT_JOB_SECRET", "SNAPSHOT_JOB_TOKEN"]), scopes: [], actions: ["sync"], docs: "instagram-and-the-snapshot-job", href: "/marketing/content", note: "Without a scheduler, the first visit of each 6-hour slot starts the capture." },
  { key: "backup", name: "Backups", does: "Copies the spreadsheet every day into a Drive folder and checks the copy.", mode: "scheduler", kind: "credential", env: env(["BACKUP_DRIVE_FOLDER_ID"], ["BACKUP_RETENTION_DAYS", "BACKUP_JOB_TOKEN", "BACKUP_JOB_SECRET"]), scopes: ["drive (service account, backups folder only)"], actions: ["test"], docs: "backups", href: null, note: "Without a scheduler, the first visit of the day starts the copy." },
];

export const RENEW_BEFORE_DAYS = 14;

export interface StatusRow { status: string; last_success_at: string | null; last_error: string; updated_at: string }

/**
 * Maps what we know to one honest status (spec 7):
 * import-only and approval-gated integrations never claim a connection; DEMO never claims a real one;
 * missing credentials → not configured; an expiry within 14 days → needs renewal (spec 4.12); a recorded error → error.
 */
export function hubStatus(i: { mode: "live" | "demo"; kind: IntegrationSpec["kind"]; configured: boolean; row: StatusRow | null; expiresAt?: string | null; now: Date }): { status: HubStatus; daysLeft: number | null } {
  const daysLeft = i.expiresAt && !Number.isNaN(Date.parse(i.expiresAt)) ? Math.floor((Date.parse(i.expiresAt) - i.now.getTime()) / 86_400_000) : null;
  if (i.kind === "import") return { status: "import_only", daysLeft: null };
  if (i.kind === "approval") return { status: "pending_approval", daysLeft: null };
  if (i.mode === "demo") return { status: "demo", daysLeft };
  if (!i.configured) return { status: "not_configured", daysLeft };
  if (daysLeft !== null && daysLeft <= RENEW_BEFORE_DAYS) return { status: "needs_renewal", daysLeft };
  if (i.row?.status === "error") return { status: "error", daysLeft };
  return { status: "connected", daysLeft };
}

/** Env presence by name only: values are never read into the response. `{F}` → founder suffix. */
export function envPresence(specs: EnvVarSpec[], env: Record<string, string | undefined>, founderSuffix: string): { name: string; required: boolean; set: boolean }[] {
  return specs.map((s) => {
    const name = s.name.replace("{F}", founderSuffix);
    return { name, required: s.required, set: Boolean(env[name]?.trim()) };
  });
}
