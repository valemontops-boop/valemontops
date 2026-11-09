/**
 * In-app connector setup (D087): what each "Configurer" form asks for, in plain words, and how a pasted value is
 * checked. Pure data + pure functions, shared by the server (validation, vault) and the browser (form, light checks).
 *
 * Every field is named after the environment variable it replaces: the resolver reads the environment first, then
 * the encrypted vault (secrets) or SystemSettings (plain settings). `{F}` = the signed-in founder (THEO / PABLO).
 * Strings are English source keys translated by t() (D048).
 */
import type { IntegrationKey } from "./integrations";

export type ConnectorKey = Extract<IntegrationKey, "wise" | "stripe" | "instagram" | "inbox" | "website" | "tracker" | "snapshot" | "backup">;
export const CONNECTOR_KEYS = ["wise", "stripe", "instagram", "inbox", "website", "tracker", "snapshot", "backup"] as const satisfies readonly ConnectorKey[];

/** secret = AES-256-GCM ciphertext in IntegrationSecrets, never shown again; setting = plain text in SystemSettings. */
export type FieldKind = "secret" | "setting";
export type FieldCheck =
  | "wise_token" | "digits" | "pem_public" | "pem_private" | "stripe_key" | "stripe_whsec" | "meta_token" | "ig_id" | "date" | "account_key"
  | "hex32" | "long_secret" | "medium_secret" | "feed_token" | "https_url" | "drive_folder" | "days";

export interface ConnectorField {
  /** Environment variable name; `{F}` → founder suffix. */
  name: string;
  kind: FieldKind;
  label: string;
  hint: string;
  check: FieldCheck;
  optional?: boolean;
  /** WE create this secret: "Generate" makes it on the server and shows it once to copy into the other service. */
  generate?: boolean;
  multiline?: boolean;
}

export interface ConnectorStep { text: string; link?: string }
export interface ConnectorForm {
  key: ConnectorKey;
  does: string;
  steps: ConnectorStep[];
  fields: ConnectorField[];
  /** Addresses to copy into the provider (path appended to APP_BASE_URL). */
  urls: { label: string; path: string }[];
  /** Whether "Save and test" can run the hub's test for this integration. */
  testable: boolean;
  /** Per founder (tracker): each founder sees and edits only their own values. */
  perFounder?: boolean;
}

const secret = (name: string, label: string, hint: string, check: FieldCheck, extra: Partial<ConnectorField> = {}): ConnectorField => ({ name, kind: "secret", label, hint, check, ...extra });
const setting = (name: string, label: string, hint: string, check: FieldCheck, extra: Partial<ConnectorField> = {}): ConnectorField => ({ name, kind: "setting", label, hint, check, ...extra });

export const CONNECTOR_FORMS: readonly ConnectorForm[] = [
  {
    key: "wise", does: "Reads the balances and movements of the Wise business account. It cannot move money.", testable: true,
    steps: [
      { text: "Sign in to Wise with the business account and open Settings › API tokens.", link: "https://wise.com/settings/api-tokens" },
      { text: "Click “Add new token”, choose “Read only”, name it Valemont OS and confirm." },
      { text: "Copy the token (it looks like 8-4-4-4-12 letters and digits) and paste it below." },
      { text: "Optional, for live movements: in Wise, add a webhook “Balance update” with the address below, and paste Wise's webhook public key (Wise developer docs › Webhooks).", link: "https://docs.wise.com/" },
      { text: "Click “Save and test”: the app reads your balances once." },
    ],
    fields: [
      secret("WISE_API_TOKEN", "Read-only API token", "Wise › Settings › API tokens › Read only.", "wise_token"),
      setting("WISE_PROFILE_ID", "Business profile id", "Optional: leave empty and the app finds the business profile.", "digits", { optional: true }),
      secret("WISE_WEBHOOK_PUBLIC_KEY_BASE64", "Wise webhook public key", "Optional. Paste the whole key, including the BEGIN and END lines.", "pem_public", { optional: true, multiline: true }),
      secret("WISE_SCA_PRIVATE_KEY_BASE64", "Private key for statements (SCA)", "Optional, only if Wise asks for strong authentication on statements.", "pem_private", { optional: true, multiline: true }),
    ],
    urls: [{ label: "Webhook address for Wise", path: "/api/webhooks/wise" }],
  },
  {
    key: "stripe", does: "Reads the Stripe balance, sales, fees, payouts and MRR. It cannot charge or refund.", testable: true,
    steps: [
      { text: "Open Stripe › Developers › API keys and click “Create restricted key”.", link: "https://dashboard.stripe.com/apikeys/create" },
      { text: "Give Read access to Balance, Balance transactions, Subscriptions and Customers only, then create the key (it starts with rk_live_)." },
      { text: "Paste the key below." },
      { text: "Open Stripe › Developers › Webhooks › Add endpoint, paste the address below and choose the events charge.*, payout.*, customer.subscription.*, invoice.paid, balance.available.", link: "https://dashboard.stripe.com/webhooks/create" },
      { text: "Reveal the endpoint's signing secret (it starts with whsec_), paste it below, then click “Save and test”." },
    ],
    fields: [
      secret("STRIPE_API_KEY", "Restricted key (read-only)", "Starts with rk_live_ (or rk_test_ for a test account).", "stripe_key"),
      secret("STRIPE_WEBHOOK_SECRET", "Webhook signing secret", "Starts with whsec_. Optional, for instant updates.", "stripe_whsec", { optional: true }),
    ],
    urls: [{ label: "Webhook address for Stripe", path: "/api/webhooks/stripe" }],
  },
  {
    key: "instagram", does: "Reads the statistics of our own Instagram professional account. It never posts.", testable: true,
    steps: [
      { text: "Open Meta for Developers › My apps and create (or open) the Valemont app with Facebook Login.", link: "https://developers.facebook.com/apps" },
      { text: "In Meta Business Settings › System users, create a system user, give it the Instagram account and the Facebook Page, and generate a token with instagram_basic, instagram_manage_insights, pages_show_list and pages_read_engagement.", link: "https://business.facebook.com/settings/system-users" },
      { text: "Paste the token below." },
      { text: "Find the Instagram account id: in the Graph API Explorer, run me/accounts?fields=instagram_business_account and copy the number.", link: "https://developers.facebook.com/tools/explorer/" },
      { text: "Click “Save and test”: the app reads the account profile once." },
    ],
    fields: [
      secret("INSTAGRAM_ACCESS_TOKEN", "Access token", "A system user token does not expire.", "meta_token"),
      setting("INSTAGRAM_BUSINESS_ACCOUNT_ID", "Instagram account id", "Digits only, for example 17841400000000000.", "ig_id"),
      setting("INSTAGRAM_TOKEN_EXPIRES_AT", "Token expiry date", "Only for a token that expires (YYYY-MM-DD); leave empty for a system user token.", "date", { optional: true }),
      setting("INSTAGRAM_ACCOUNT_KEY", "Which account", "ig-valemont (default) or ig-thirty for 30/30.", "account_key", { optional: true }),
    ],
    urls: [],
  },
  {
    key: "inbox", does: "Receives comments and messages to reply to, from a relay (Make, Zapier, n8n) or from Meta. Nothing is sent automatically.", testable: true,
    steps: [
      { text: "Click “Generate” next to the relay secret, copy it once and paste it in your relay (Make, Zapier or n8n) as the signing secret." },
      { text: "In the relay, send each new comment or message to the relay address below, signed with that secret (docs/INBOX.md)." },
      { text: "For Instagram directly: in your Meta app › Webhooks, use the Meta address below, click “Generate” for the verify token and paste it in Meta.", link: "https://developers.facebook.com/apps" },
      { text: "Copy the app secret from Meta › App settings › Basic and paste it below." },
      { text: "Click “Save and test”." },
    ],
    fields: [
      secret("INBOX_WEBHOOK_SECRET", "Relay signing secret", "Created here: 64 random characters.", "long_secret", { generate: true }),
      secret("META_APP_SECRET", "Meta app secret", "32 letters and digits, from App settings › Basic.", "hex32", { optional: true }),
      secret("META_VERIFY_TOKEN", "Meta verify token", "Created here; paste it in Meta when you add the webhook.", "medium_secret", { optional: true, generate: true }),
    ],
    urls: [{ label: "Relay address", path: "/api/inbox/webhook" }, { label: "Meta address", path: "/api/inbox/meta" }],
  },
  {
    key: "website", does: "Turns the FR/ES website forms into an inbound lead and an item to reply to.", testable: true,
    steps: [
      { text: "Click “Generate”: the secret is shown once. Copy it." },
      { text: "In your site host (for example Netlify › Site configuration › Environment variables), add WEBSITE_WEBHOOK_SECRET with that value and VALEMONT_WEBHOOK_URL with the address below.", link: "https://app.netlify.com/" },
      { text: "Add the small form function from docs/INTEGRATIONS.md › Website forms webhook to the site and publish it." },
      { text: "Click “Save and test”, then send one real test form and check My Day › To reply." },
    ],
    fields: [secret("WEBSITE_WEBHOOK_SECRET", "Form signing secret", "Created here: 64 random characters.", "long_secret", { generate: true })],
    urls: [{ label: "Form webhook address", path: "/api/webhooks/website" }],
  },
  {
    key: "tracker", does: "Sends each of your activities to your personal tracker, signed. Yours only.", testable: true, perFounder: true,
    steps: [
      { text: "In your tracker, create an incoming webhook that accepts JSON and copy its https address." },
      { text: "Paste the address below and click “Generate” for the signing secret; paste that secret in your tracker." },
      { text: "Optional: click “Generate” for the feed token if your tracker pulls the feed address below." },
      { text: "Click “Save and test”: one signed test event is sent to your tracker." },
    ],
    fields: [
      secret("TRACKER_WEBHOOK_URL_{F}", "Tracker address", "Must start with https://.", "https_url"),
      secret("TRACKER_WEBHOOK_SECRET_{F}", "Signing secret", "Created here: 64 random characters.", "medium_secret", { generate: true }),
      secret("TRACKER_FEED_TOKEN_{F}", "Feed token", "Optional, for the pull feed. Created here.", "feed_token", { optional: true, generate: true }),
    ],
    urls: [{ label: "Feed address (pull)", path: "/api/tracker/feed" }],
  },
  {
    key: "snapshot", does: "Lets an outside scheduler start the Instagram capture every 6 hours.", testable: false,
    steps: [
      { text: "Click “Generate” for the job token and copy it once." },
      { text: "In your scheduler (Apps Script trigger, GitHub Actions, cron-job.org), call the address below every 6 hours with the header Authorization: Bearer and the token." },
      { text: "Or, if the scheduler can sign, generate the job secret instead (docs/INTEGRATIONS.md › Snapshot job)." },
      { text: "Click “Save”." },
    ],
    fields: [
      secret("SNAPSHOT_JOB_TOKEN", "Job token", "Created here: 64 random characters.", "feed_token", { optional: true, generate: true }),
      secret("SNAPSHOT_JOB_SECRET", "Job signing secret", "Created here, for schedulers that sign.", "long_secret", { optional: true, generate: true }),
    ],
    urls: [{ label: "Job address", path: "/api/jobs/snapshot" }],
  },
  {
    key: "backup", does: "Copies the spreadsheet every day into a Drive folder and checks the copy.", testable: true,
    steps: [
      { text: "In Google Drive (a Shared Drive is best), create a folder “Valemont OS backups”.", link: "https://drive.google.com/drive/shared-drives" },
      { text: "Share the folder with the service account's address as Editor." },
      { text: "Open the folder and paste its address (or only the id at the end) below." },
      { text: "Optional: choose how many days to keep, and generate a job token for an outside scheduler (Vercel Cron already works without it)." },
      { text: "Click “Save and test”: the app lists the folder once." },
    ],
    fields: [
      setting("BACKUP_DRIVE_FOLDER_ID", "Backups folder", "The folder's address or its id.", "drive_folder"),
      setting("BACKUP_RETENTION_DAYS", "Days to keep", "From 1 to 365; 30 when empty.", "days", { optional: true }),
      secret("BACKUP_JOB_TOKEN", "Job token", "Optional. Created here: 64 random characters.", "feed_token", { optional: true, generate: true }),
    ],
    urls: [{ label: "Job address", path: "/api/jobs/backup" }],
  },
];

export const connectorForm = (key: string): ConnectorForm | null => CONNECTOR_FORMS.find((f) => f.key === key) ?? null;
export const founderSuffix = (founder: string) => founder.toUpperCase();
/** `TRACKER_WEBHOOK_URL_{F}` → `TRACKER_WEBHOOK_URL_THEO`. */
export const resolveFieldName = (template: string, founder: string) => template.replace("{F}", founderSuffix(founder));
/** All variable names the vault may hold (both founders' tracker fields). */
export function allConnectorNames(): string[] {
  return CONNECTOR_FORMS.flatMap((f) => f.fields.flatMap((x) => (x.name.includes("{F}") ? ["THEO", "PABLO"].map((s) => x.name.replace("{F}", s)) : [x.name])));
}
/** The integration a variable belongs to (founder-specific names resolved). */
export function fieldOf(name: string): { form: ConnectorForm; field: ConnectorField } | null {
  for (const form of CONNECTOR_FORMS) for (const field of form.fields) {
    if (field.name === name || (field.name.includes("{F}") && ["THEO", "PABLO"].some((s) => field.name.replace("{F}", s) === name))) return { form, field };
  }
  return null;
}

/**
 * Bootstrap values the app needs before it can reach the Sheet (or to decrypt the vault): they stay in the host's
 * environment and are shown read-only ("set in Vercel").
 */
export const BOOTSTRAP_ENV: readonly { name: string; required: boolean }[] = [
  { name: "APP_MODE", required: true },
  { name: "SESSION_SECRET", required: true },
  { name: "APP_BASE_URL", required: true },
  { name: "FOUNDER_THEO_EMAIL", required: true },
  { name: "FOUNDER_PABLO_EMAIL", required: true },
  { name: "FOUNDER_THEO_TIMEZONE", required: false },
  { name: "FOUNDER_PABLO_TIMEZONE", required: false },
  { name: "GOOGLE_OAUTH_CLIENT_ID", required: true },
  { name: "GOOGLE_OAUTH_CLIENT_SECRET", required: true },
  { name: "SHEETS_SPREADSHEET_ID", required: true },
  { name: "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64", required: true },
  { name: "PRIVATE_SHEET_ID_THEO", required: false },
  { name: "PRIVATE_SHEET_ID_PABLO", required: false },
  { name: "CONNECTORS_ENCRYPTION_KEY", required: false },
];

/* ---------------- light validation (also run on the server before anything is stored) ---------------- */

const b64 = (s: string) => {
  try {
    return typeof atob === "function" ? atob(s) : "";
  } catch {
    return "";
  }
};
const toB64 = (s: string) => (typeof btoa === "function" ? btoa(s) : s);

/** Paste-friendly cleanup: trims, drops wrapping quotes, keeps line breaks only where a key needs them. */
export function cleanValue(field: ConnectorField, raw: string): string {
  let v = raw.replace(/\r\n?/g, "\n").trim();
  if (v.length >= 2 && /^["'`]/.test(v) && v[v.length - 1] === v[0]) v = v.slice(1, -1).trim();
  if (!field.multiline) v = v.replace(/\s+/g, "");
  return v;
}

/** Normalised value to store, or an error (English source key) when the paste does not look right. */
export function checkValue(field: ConnectorField, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = cleanValue(field, raw);
  if (!v) return { ok: false, error: "Paste a value first." };
  if (v.length > 10_000) return { ok: false, error: "This value is too long." };
  const bad = (error: string) => ({ ok: false as const, error });
  const good = (value: string) => ({ ok: true as const, value });
  switch (field.check) {
    case "wise_token":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? good(v) : bad("A Wise token looks like 8-4-4-4-12 letters and digits.");
    case "digits":
      return /^\d{1,20}$/.test(v) ? good(v) : bad("Digits only.");
    case "ig_id":
      return /^\d{8,25}$/.test(v) ? good(v) : bad("The Instagram account id is a long number (digits only).");
    case "pem_public":
    case "pem_private": {
      const want = field.check === "pem_public" ? /-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/ : /-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----/;
      if (want.test(v)) return good(toB64(v.match(want)![0] + "\n"));
      const decoded = b64(v.replace(/\s+/g, ""));
      return want.test(decoded) ? good(v.replace(/\s+/g, "")) : bad(field.check === "pem_public" ? "Paste the whole public key, from -----BEGIN PUBLIC KEY----- to -----END PUBLIC KEY-----." : "Paste the whole private key, from its BEGIN line to its END line.");
    }
    case "stripe_key":
      if (/^pk_/.test(v)) return bad("This is a publishable key (pk_): create a restricted key (rk_) instead.");
      return /^(rk|sk)_(live|test)_[A-Za-z0-9]{10,}$/.test(v) ? good(v) : bad("A Stripe key starts with rk_live_ (restricted, recommended).");
    case "stripe_whsec":
      return /^whsec_[A-Za-z0-9+/=]{10,}$/.test(v) ? good(v) : bad("A Stripe signing secret starts with whsec_.");
    case "meta_token":
      return /^[A-Za-z0-9_|.-]{40,}$/.test(v) ? good(v) : bad("This does not look like a Meta access token (long, letters and digits).");
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? good(v) : bad("Use the format YYYY-MM-DD.");
    case "account_key":
      return /^[a-z0-9][a-z0-9-]{1,39}$/.test(v) ? good(v) : bad("Lowercase letters, digits and dashes, for example ig-valemont.");
    case "hex32":
      return /^[0-9a-f]{32}$/i.test(v) ? good(v) : bad("The Meta app secret is 32 letters and digits.");
    case "long_secret":
      return v.length >= 32 ? good(v) : bad("Use at least 32 characters, or click Generate.");
    case "medium_secret":
      return v.length >= 16 ? good(v) : bad("Use at least 16 characters, or click Generate.");
    case "feed_token":
      return v.length >= 24 ? good(v) : bad("Use at least 24 characters, or click Generate.");
    case "https_url":
      try {
        const u = new URL(v);
        return u.protocol === "https:" ? good(u.toString()) : bad("The address must start with https://.");
      } catch {
        return bad("This is not a valid address.");
      }
    case "drive_folder": {
      const m = /\/folders\/([A-Za-z0-9_-]{10,100})/.exec(v) ?? /[?&]id=([A-Za-z0-9_-]{10,100})/.exec(v);
      const id = m ? m[1] : v;
      return /^[A-Za-z0-9_-]{10,100}$/.test(id) ? good(id) : bad("Paste the folder's address from Google Drive, or its id.");
    }
    case "days": {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 365 ? good(String(n)) : bad("A whole number of days between 1 and 365.");
    }
  }
}

/** Shown after saving: only the end of a long value, never a short one (a short value would be given away). */
export function last4Of(value: string): string {
  return value.length >= 16 ? value.slice(-4) : "";
}
