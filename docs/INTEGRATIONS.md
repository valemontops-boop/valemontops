# Integrations — honest status (updated Stage 4A)

The live view of this table is **Settings › Integrations** (Integration Hub, D083): every integration with what it does, its mode, its status from IntegrationStatuses (connected / not configured / error with last error and time / needs renewal with days left), the env variable **names** it needs (set / missing, never values), last sync or import, and actions (test connection, sync now, authorize again). DEMO shows "Demo, simulated" everywhere: nothing claims a real connection.

| Integration | Status | Notes |
|---|---|---|
| Google Sheets | Needs setup | Service account + shared Sheet (+ one private Sheet per founder). Verified against the fake server only. |
| Google Sign-In | Needs setup | OAuth client, two allowlisted founders, basic scopes only. |
| Google Calendar | Needs setup | Shared "Valemont" calendar + personal calendars shared with the service account; ids in Settings › Calendars. Other founder's calendar read as free/busy only. |
| Google Drive | Needs setup | Read: folder shared with the service account (Viewer). Write: each founder's own `drive.file` grant, asked at first upload. Picker not wired yet. |
| LinkedIn statistics | Import-only | Page export (.xls) and creator export (.xlsx) through Marketing › Import. API adapter only after Community Management API approval. |
| LinkedIn / Sales Navigator outreach | Manual logging | Logger + click-to-open. No scraping, no automated messaging. |
| Instagram statistics | VERIFIED_FAKE (Needs setup in LIVE) | Read-only Instagram Graph API for the founders' own professional accounts: followers, account day insights (views, reach, profile views, website clicks), media list, media insights (Reels/posts at 24 h, 72 h, 7 d, 30 d; stories every 6 h while live). Content Studio (Growth › Content › Open the Content Studio, `/marketing/content`). Without credentials or in DEMO: manual entry, labelled “entered by hand”. See “Instagram and the snapshot job” below. |
| Gmail (send only) | VERIFIED_FAKE | Opt-in per founder from Call mode or Marketing › Email. Scope `gmail.send` only (no inbox read). Add the scope to the OAuth consent screen and `{APP_BASE_URL}/api/auth/google/gmail/callback` to the client's redirect URIs. With an External app in Testing, consent is re-asked often (tokens are online, about 1 h) and the scope needs Google verification for Production; a Workspace Internal app avoids both. |
| Wise (bank, read-only) | VERIFIED_FAKE | Money page and Command Center cash. Env: `WISE_API_TOKEN` (personal API token of the business account, read-only), optional `WISE_PROFILE_ID`, optional `WISE_SCA_PRIVATE_KEY_BASE64` (RSA ≥2048 PEM, its public key uploaded in Wise › Settings › API tokens › Manage public keys) for statements under strong authentication, `WISE_WEBHOOK_PUBLIC_KEY_BASE64` (Wise's production webhook public key, from Wise's webhook docs). Webhook: subscribe `balances#update` to `{APP_BASE_URL}/api/webhooks/wise`. If Wise refuses key signing for the account, balances and live webhooks still work and history comes from a CSV statement export (Money › Import Wise CSV). The token can never move money. Also gives the USD→EUR rate of the day for contractor payments (`GET /v1/rates`, D085, see below). |
| Stripe (read-only) | VERIFIED_FAKE | Money page (Stripe balance, sales, fees, payouts) and MRR on Money and the Command Center. Env: `STRIPE_API_KEY` = restricted key with Read on Balance, Balance transactions, Subscriptions, Customers (Stripe › Developers › API keys › Create restricted key); `STRIPE_WEBHOOK_SECRET` of an endpoint `{APP_BASE_URL}/api/webhooks/stripe` listening to charge.*, payout.*, customer.subscription.*, invoice.paid, balance.available. The key cannot create charges or refunds. |
| "To reply" inbox | VERIFIED_FAKE | Relay webhook `{APP_BASE_URL}/api/inbox/webhook` (env `INBOX_WEBHOOK_SECRET`, HMAC-SHA256) and Instagram webhook `{APP_BASE_URL}/api/inbox/meta` (env `META_APP_SECRET`, `META_VERIFY_TOKEN`; needs a Meta app with Instagram messaging/comments permissions and app review). LinkedIn: no API for DMs — email-notification forwarding through a relay, or manual add. Never sends anything: replies are copied and sent by a founder. See docs/INBOX.md. |
| Founder's own tracker | VERIFIED_FAKE | Push every new activity (signed JSON, https only) to `TRACKER_WEBHOOK_URL_<F>` with `TRACKER_WEBHOOK_SECRET_<F>`; pull feed `GET {APP_BASE_URL}/api/tracker/feed` with a bearer `TRACKER_FEED_TOKEN_<F>`; optional `TRACKER_DAILY_SUMMARY_<F>=1`. LIVE only. Settings › My tracker. See docs/TRACKER.md. |
| Website forms (FR/ES sites) | VERIFIED_FAKE (Needs setup in LIVE) | Signed webhook `POST {APP_BASE_URL}/api/webhooks/website` (env `WEBSITE_WEBHOOK_SECRET`). Contact / lead / booking form → inbound lead + item to reply to. See "Website forms webhook" below (Stage 4A, D083). |
| GA4 / Search Console | Import-only | CSV exports imported in Growth (GA4 traffic) and Growth › SEO (Search Console). No API adapter: optional per spec 7, not built (no credentials). |
| ECB FX | Dropped (D082) | The founders removed EUR/USD and ECB rates: everything is EUR, nothing is downloaded. |

## In-app connector setup (D087)
Settings › Integrations › **Configure** (Wise, Stripe, Instagram, inbox, website forms, my tracker, snapshot job, backups): one line of what it does, 3–6 numbered steps with a link to the provider's page, the webhook/job address to copy (APP_BASE_URL + path), the fields to paste (password inputs, light checks: Wise token = uuid, Stripe `rk_`/`sk_` (never `pk_`), `whsec_`, Meta app secret = 32 hex, https tracker URL, Drive folder address → id, PEM → base64), **Generate** for the secrets we create (inbox relay, Meta verify token, website, tracker secret and feed token, snapshot/backup job tokens: 64 hex characters, shown once), then **Save and test** = save + the hub's read-only test, green or red in plain words.
- **Where values go**: secrets → `IntegrationSecrets` tab as AES-256-GCM ciphertext only; non-secret ids (WISE_PROFILE_ID, INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_TOKEN_EXPIRES_AT, INSTAGRAM_ACCOUNT_KEY, BACKUP_DRIVE_FOLDER_ID, BACKUP_RETENTION_DAYS) → SystemSettings `connector:NAME`. Key: `CONNECTORS_ENCRYPTION_KEY` (`openssl rand -base64 32`), else derived from SESSION_SECRET (see docs/SECURITY.md §12b).
- **Precedence**: an environment variable always wins (same behaviour as before); the form shows it as "set in Vercel" and refuses to save over it. The hub's variable chips say "set in Vercel" or "saved in the app".
- **Resolution**: `resolveSecret` / `getSecret(integration, field)` (`src/server/connectors.ts`), cached 60 s per server instance, refreshed immediately on the instance that saved (others within a minute). Webhooks (Stripe, Wise, inbox, Meta, website), jobs (snapshot, backup), the tracker push/feed, the hub and Test connection all use it; Wise/Stripe/Instagram/backup ports are rebuilt when a value changes — no redeploy.
- **Write-only**: after saving, only "set · ends with 1234", who and when; replace by pasting/generating again; Delete clears the ciphertext. Every change audited (names only). Rotation of the encryption key: docs/SECURITY.md §12b.
- **Stays in Vercel** (needed before the app can open the Sheet; listed read-only under "Base settings"): APP_MODE, SESSION_SECRET, APP_BASE_URL, FOUNDER_*_EMAIL / _TIMEZONE, GOOGLE_OAUTH_CLIENT_ID/SECRET, SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, PRIVATE_SHEET_ID_*, CONNECTORS_ENCRYPTION_KEY(_PREVIOUS). Also env-only: INSTAGRAM_ACCOUNTS_JSON, *_API_BASE_URL, TRACKER_DAILY_SUMMARY_*, CRON_SECRET.
- Provider links were written 2026-11-09 without network access to the providers; menu names may differ slightly. Status: VERIFIED_FAKE (fake Sheets, fake Wise, DEMO); not run with real credentials.

## Backups
Hub row "Backups" (D087): BACKUP_DRIVE_FOLDER_ID (required), BACKUP_RETENTION_DAYS, BACKUP_JOB_TOKEN / BACKUP_JOB_SECRET. Test = list the backups folder (read-only). Details: docs/DEPLOYMENT.md › Backups.

## Expiring credentials
`drive.file` access tokens last about an hour and live only in an encrypted cookie; expiry means one more consent click.
No token is stored in clear in Sheets (connector keys: ciphertext only, D087). The builder's Claude account is never used at runtime.

## Instagram and the snapshot job (Stage 3, D079)
**Credentials (env only, never Sheets).** Preferred path (spec 7): a Meta app with Facebook Login, the Instagram professional account linked to a Facebook Page, and a **System User** token from Business Settings (does not expire) with `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`. Standard Access on the founders' own accounts needs no App Review; Advanced Access (and Meta business verification) is only needed to read accounts the app's business does not own. Fallback: Instagram Login with `instagram_business_basic` + `instagram_business_manage_insights` (60-day long-lived token, refreshed with `GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` before expiry; set `INSTAGRAM_API_BASE_URL=https://graph.instagram.com/v21.0` and `INSTAGRAM_TOKEN_EXPIRES_AT`).
- One account: `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_ACCESS_TOKEN`, optional `INSTAGRAM_ACCOUNT_KEY` (our social account key, default `ig-valemont`; `ig-thirty` for 30/30) and `INSTAGRAM_TOKEN_EXPIRES_AT` (YYYY-MM-DD).
- Several: `INSTAGRAM_ACCOUNTS_JSON=[{"account":"ig-valemont","ig_user_id":"…","token":"…","expires_at":""},{"account":"ig-thirty",…}]`.
- Active only in LIVE; DEMO never reads a real account. A token with an expiry date shows its days left in the Content Studio and creates a P1 task 14 days before (spec 4.12). Rotation: generate the new token, replace the env value, redeploy; nothing is stored elsewhere.

**Snapshot job (spec 4.11).** `POST {APP_BASE_URL}/api/jobs/snapshot`, every 6 hours, from a free scheduler (Apps Script time-driven trigger, GitHub Actions `schedule`, host cron). Authentication: `X-Valemont-Timestamp: <unix seconds>` + `X-Valemont-Signature: sha256=<hex HMAC-SHA256(SNAPSHOT_JOB_SECRET, "<timestamp>.<raw body>")>` (5-minute window), or `Authorization: Bearer <SNAPSHOT_JOB_TOKEN>` (24+ characters) for schedulers that cannot sign. Idempotent per 6-hour UTC slot: a repeat answers `{"status":"skipped"}`. Without a scheduler, the first request of each slot (the app's polling endpoint) starts the same capture in the background (spec 4.6); stories may then be missed at night, so an external scheduler is recommended. Example (cron): `ts=$(date +%s); sig=$(printf '%s.{}' "$ts" | openssl dgst -sha256 -hmac "$SNAPSHOT_JOB_SECRET" -hex | sed 's/^.* //'); curl -X POST -H "X-Valemont-Timestamp: $ts" -H "X-Valemont-Signature: sha256=$sig" -d '{}' https://<host>/api/jobs/snapshot`.
- Captures: account days (yesterday with the follower count read now; up to 7 missed days re-read for views/reach/profile visits/website clicks — followers of missed days stay unknown), posts and Reels at 24 h / 72 h / 7 d / 30 d (each once, with its real age; a checkpoint missed beyond its window is not faked), live stories once per slot. Limits handled: story insights exist for 24 h only and not under 5 viewers (stored “not available”, never 0), demographics need 100+ followers (not read), delayed data shown with its capture time, Meta's day boundary may differ from Paris time. A missed run leaves a visible gap (charts never interpolate). The last success and errors are in the Content Studio; an error sets IntegrationStatuses `instagram` → error, which raises a notification.
- LinkedIn post numbers stay hand-entered (or the Page/creator exports for account totals): no LinkedIn API before Community Management API approval.

## Integration Hub (Stage 4A, D083)
Settings › Integrations. One row per integration; each row's "Guide" points to a section of this file.
- **Statuses** (`src/domain/integrations.ts` `hubStatus`): *Import only* (GA4, Search Console) and *Awaiting approval* (LinkedIn API) never claim a connection; in DEMO every credential-based integration reads *Demo, simulated*; in LIVE: credential missing → *Not configured* (with the missing variable names and "set them in the host's environment, then redeploy"); expiry within 14 days (`*_EXPIRES_AT`, spec 4.12) → *Needs renewal* with days left; last recorded result an error → *Error* with the error text and its time; else *Connected*.
- **Actions** appear only where they can work: *Test connection* = one read-only call (Sheets revisions, Drive folder list, Calendar next 7 days, Wise balances, Stripe balance, Instagram profile) or a signature self-check for webhooks (website, inbox: the secret is set and 32+ characters); never sends an email or writes to a provider. *Sync now* (LIVE only): Wise, Stripe, Instagram capture (the same idempotent jobs). *Authorize / Authorize again*: Gmail (`gmail.send`) and Drive (`drive.file`) incremental consent — the existing paths, no new scope.
- Test results are written to IntegrationStatuses (best effort, at most every 15 minutes while it stays ok).

### Google Sheets
Mandatory, read and write, service account. Env `SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`, optional `PRIVATE_SHEET_ID_THEO` / `PRIVATE_SHEET_ID_PABLO`. `npm run setup:sheets`, `npm run doctor:sheets`.
### Google Sign-In
Env `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL`, `APP_BASE_URL`. Basic scopes only.
### Google Drive
Read: folder shared with the service account (id in Settings › Workspace). Write: each founder's `drive.file` grant (encrypted cookie, about one hour). The hub shows whether the grant is active in this browser.
### Google Calendar
Calendars shared with the service account (Settings › Calendars); the other founder's calendar as free/busy only. Per-founder Calendar OAuth (`calendar.events`, invitations, Meet links) stays **off** (spec 7: opt-in; not built).
### Gmail
`gmail.send` only, per founder, from Call mode, Marketing › Email or the hub's "Authorize" button. External app in Testing: consent again at least every 7 days and verification needed for Production; a Workspace Internal app avoids both.
### Wise
See the table above. Test = balances; Sync now = statements (or CSV import when Wise requires SCA).

**USD rate for contractor payments (D085)** — `GET https://api.wise.com/v1/rates?source=USD&target=EUR`, header `Authorization: Bearer <WISE_API_TOKEN>`, answer `[{ "rate": 0.92…, "source": "USD", "target": "EUR", "time": "…" }]`. Same read-only personal token, no new variable, no new scope: it reads a public mid-market rate and cannot move money. Called only in LIVE, at most once per day (cached in the `UsdRates` tab), and after a failure at most once per hour per server instance; the result or error is in IntegrationStatuses `wise_rates`. Any failure (token missing, 401/403, network) → the founders' manual rate (Money › Movements › "Prestataires payés en USD"), else "taux manquant" — never an invented rate.
Status: **PARTIAL** (VERIFIED_FAKE: mocked fetch + fake port in `tests/integration/usd.test.ts`; not called with real credentials here).
Sources checked (2026-11-09; docs.wise.com was not reachable from the build environment, so these come from search results, not a direct read):
- Wise docs list `GET /v1/rates` and `GET /v1/rates?source=EUR&target=USD` (https://docs.wise.com/api-docs/guides/affiliates). That guide says the endpoint supports only Basic authentication **for affiliate partners**, which is a different integration from ours.
- Personal API tokens are sent as `Authorization: Bearer` on every request and are created in Wise › Your account › Integrations and Tools › API tokens, with a Read only option for business accounts (https://docs.wise.com/guides/developer/auth-and-security/personal-api-token).
- A third-party open-source client reports that a read-only personal token is enough for profile, balances, activities and **rates** (https://www.raycast.com/jorgetoh/wise-lens). This is community evidence, not Wise's own statement.
To confirm on the first LIVE run: `curl -H "Authorization: Bearer $WISE_API_TOKEN" "https://api.wise.com/v1/rates?source=USD&target=EUR"` should answer 200 with one rate. If Wise answers 401/403 for this token, nothing breaks: the manual rate is used and the hub shows the error.

**USD side of a payment** — the statement (`statement.json`, COMPACT) gives the other currency of a cross-currency movement in `exchangeDetails` (e.g. `forAmount` in USD on a EUR debit) or, for conversions, `details.sourceAmount` / `targetAmount`. The adapter reads these defensively (the first amount in another currency) into `BankTransactions.fx_currency` / `fx_amount_minor`; the CSV export's "Exchange To" / "Exchange To Amount" columns do the same. Exact field names are confirmed against Wise's example only on the first real sync (PARTIAL).
### Stripe
See the table above. Test = balance; Sync now = balance transactions and subscriptions.
### LinkedIn
Statistics: *Awaiting approval*. Page export (.xls) and creator export (.xlsx) in Growth until the Community Management API is approved (dedicated app, verified Company Page, Standard-tier review). The adapter is built only after approval. Outreach stays manual (no scraping, no automated messages).
### GA4 and Search Console
CSV exports imported in Growth and Growth › SEO; last import date shown in the hub. No API adapter without credentials (spec 7: optional).
### Inbox
See docs/INBOX.md. Test = signature self-check of `INBOX_WEBHOOK_SECRET`.
### My tracker
See docs/TRACKER.md. Per founder; the hub shows only your own variables. Test = one signed test event (LIVE only).

## Website forms webhook
`POST {APP_BASE_URL}/api/webhooks/website` — Stage 4A (D083), spec 7 "Valemont and 30/30 websites". **Never assume the sites are wired**: the hub says *Not configured* until `WEBSITE_WEBHOOK_SECRET` is set, and *Connected* is backed by the last accepted call.

**Security.** The site's **server-side** form handler signs the call; the secret never goes to the browser.
- Headers: `X-Valemont-Timestamp: <unix seconds>`, `X-Valemont-Signature: sha256=<hex HMAC-SHA256(WEBSITE_WEBHOOK_SECRET, "<timestamp>.<raw body>")>` (same scheme as the snapshot job). Window ±5 minutes (else 401 `stale_timestamp`); wrong signature 401 `bad_signature`; secret unset 503.
- Idempotency: `event_id` (8–100 characters `A-Z a-z 0-9 . _ : -`, e.g. the form provider's submission id). A replay or retry answers `{"ok":true,"status":"duplicate"}` and adds nothing.
- Abuse limits: body ≤ 32 KB (413), 20 calls per minute per IP in this server's memory (429 + `Retry-After`; a restart resets it), honeypot field and minimum fill time (`honeypot` non-empty or `elapsed_ms` < 1500 → 202 `ignored`, nothing stored).
- Nothing is read from or written to Sheets before the signature is verified. Storage failure → 503 (retry with the same `event_id`).

**Payload** (JSON, validated with Zod; `+ - = @` kept as typed):
```json
{
  "event_id": "netlify-5f2c1e9a7b",
  "site": "valemont",                      // or "thirty"
  "form_type": "contact",                  // "contact" | "lead" | "booking"
  "language": "fr",                        // fr | es (FR/ES)
  "submitted_at": "2026-11-09T10:00:00Z",
  "name": "Claire Dupont", "company": "Boulangerie Exemple", "email": "claire@example.com", "phone": "06 12 34 56 78",
  "website": "https://boulangerie.example.com", "country": "FR", "city": "Lyon", "sector": "Boulangerie",
  "message": "Bonjour…", "booking_slot": "mardi 10 h",
  "page_url": "https://www.example.com/contact", "referrer": "https://www.google.com/",
  "utm": { "source": "google", "medium": "cpc", "campaign": "fr-boulangeries", "term": "", "content": "" },
  "consent": { "marketing": true, "text": "J'accepte d'être recontacté…", "version": "2026-11" },
  "honeypot": "", "elapsed_ms": 12000
}
```
Email or phone is required.

**What it creates.** Matching on contact email/phone, then business email/phone/domain (free-mail domains never match a business). New business → Account (`lead_type` inbound, `lead_source` website, brand Consulting or 30/30 by `site`, owner Théo for FR / Pablo for ES) + Contact; existing business → blanks filled only. One "To reply" item `website_form` (assigned by market; the derived "new website lead" item is the same item). One `WebsiteSubmissions` row (form type, UTM, page, referrer, consent checkbox + sentence + version, outcome); no name/email/phone in that tab. Consent: ticked → contact `consented` with the version as lawful basis; not ticked → basis "request sent through the website form (reply to it)".
**Suppression** (hard block): an opted-out contact or any suppression match → nothing created or updated and no item to reply to; the submission is kept with outcome `suppressed` (count shown in the hub) so a founder can decide by hand.

**Netlify Forms.** Netlify's outgoing webhook cannot sign with our scheme, so use a [submission-created](https://docs.netlify.com/functions/trigger-on-events/) function (runs on each verified submission; set `WEBSITE_WEBHOOK_SECRET` and `VALEMONT_WEBHOOK_URL` in Netlify's environment):
```js
// netlify/functions/submission-created.mjs
import { createHmac } from "node:crypto";
export default async (req) => {
  const { payload } = await req.json();               // Netlify Forms submission
  const d = payload.data ?? {};
  const body = JSON.stringify({
    event_id: `netlify-${payload.id}`, site: "valemont", form_type: payload.form_name === "booking" ? "booking" : "contact",
    language: d.lang ?? "fr", submitted_at: payload.created_at, name: d.name ?? "", company: d.company ?? "",
    email: d.email ?? "", phone: d.phone ?? "", message: d.message ?? "", booking_slot: d.slot ?? "",
    page_url: d.page ?? "", referrer: payload.referrer ?? "",
    utm: { source: d.utm_source ?? "", medium: d.utm_medium ?? "", campaign: d.utm_campaign ?? "", term: d.utm_term ?? "", content: d.utm_content ?? "" },
    consent: { marketing: d.consent === "on" || d.consent === "true", text: d.consent_text ?? "", version: d.consent_version ?? "" },
    honeypot: d["bot-field"] ?? "",
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", process.env.WEBSITE_WEBHOOK_SECRET).update(`${ts}.${body}`).digest("hex");
  const r = await fetch(process.env.VALEMONT_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json", "x-valemont-timestamp": ts, "x-valemont-signature": `sha256=${sig}` }, body });
  if (r.status >= 500) throw new Error(`Valemont OS ${r.status}`); // Netlify retries; same event_id = no duplicate
  return new Response("ok");
};
```
In the form: `data-netlify="true" netlify-honeypot="bot-field"`, hidden inputs for `lang`, `page`, the UTM values (copied from the URL by a small script) and `consent_version`, and a consent checkbox whose sentence is sent as `consent_text`.

**Generic form handler** (any Node server, Cloudflare Worker, Apps Script with `Utilities.computeHmacSha256Signature`): build the JSON above, then
```sh
ts=$(date +%s); sig=$(printf '%s.%s' "$ts" "$BODY" | openssl dgst -sha256 -hmac "$WEBSITE_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST -H 'content-type: application/json' -H "X-Valemont-Timestamp: $ts" -H "X-Valemont-Signature: sha256=$sig" -d "$BODY" https://<host>/api/webhooks/website
```
Check: Settings › Integrations › Website forms › Test connection (secret set, 32+ characters), then send one real test form and see it in My Day › To reply. Rotation: set a new secret on both sides, redeploy.

## CSV import / export (Stage 4A, D083)
- **Export** (`GET /api/csv/export?list=…&from=YYYY-MM-DD&to=YYYY-MM-DD`, signed-in founders only): accounts (CRM › Export), contacts (CRM › All businesses), deals and quotes (CRM › Pipeline), call log (Call mode › Log), tasks (Tasks; your own private tasks only), content posts (Content Studio), projects (Clients), bank movements (Money), Local usage (Clients › Local, same headers as its import). Free text starting with `= + - @`, tab or CR gets a leading apostrophe; phone columns keep `+33…` but neutralise anything that is not a phone. No dialled number in the call log.
- **Import with preview and dedupe**: accounts + contacts (CRM › Import list), Local usage (Clients › Local), tasks (Tasks › Import CSV: title, description, owner, priority, due, area, estimated minutes; duplicate = same title and due date as an existing task (any status) or earlier in the file), content ideas (Content Studio › Import CSV: title, format, brand, hook, persona → pieces at the idea stage; duplicate = same title). The server re-classifies at commit, writes only new rows, and ids derive from the import id: sending the same import twice adds nothing.
