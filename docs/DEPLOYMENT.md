# Deployment, backups and restore (Stage 4B, D084)

Valemont OS is a standard Next.js 16 Node application. Google Sheets stays the only store: there is no database to
provision. Everything is configured by environment variables (`.env.example` lists every name; values only in the
host's settings, never in the repository or a chat). The Claude account that built the code has no role at runtime
(spec 3.15): every Google, Meta and hosting identity belongs to the founders.

## 1. Host: Vercel (recommended)

* **Plan.** Vercel's Hobby plan is for personal, non-commercial use only; Valemont is a business, so use **Pro**
  (about USD 20 per deploying member per month; one member is enough). Check the current terms and price before
  signing up. A host-agnostic alternative is any Node 20+ host (`npm run build && npm start`, port 3000) behind HTTPS
  with a scheduler that can call two URLs (Render, Railway, Fly.io, a VPS + systemd timer).
* **Runtime.** Node.js runtime (the default; never the Edge runtime: `google-auth-library`, `node:crypto` and
  `pdf-lib` need Node) with **Fluid Compute** on (default for new projects): one instance serves concurrent requests,
  which keeps the in-process caches, the Sheets revision cache and the audit batch effective. Region close to the
  founders (e.g. Paris `cdg1`).
* **Project.** Import the Git repository, framework preset Next.js, build `npm run build`, output default. Node 22.
* **Crons.** `vercel.json` declares two Vercel Cron jobs: the daily backup (`/api/jobs/backup`, 02:17 UTC) and the
  audience snapshot every 6 hours (`/api/jobs/snapshot`; sub-daily schedules need Pro). Vercel calls them with GET and
  `Authorization: Bearer <CRON_SECRET>`: set `CRON_SECRET` (24+ random characters) and both endpoints accept it.
* **Domain.** Add the domain in Vercel › Domains (e.g. `os.example.com`), wait for the certificate, then set
  `APP_BASE_URL=https://os.example.com` (no trailing slash). HSTS is sent by the app; only use HTTPS URLs.

## 2. Google Cloud setup (once, by a founder, with a founder's Google account)

1. **Project.** console.cloud.google.com › New project "Valemont OS".
2. **APIs.** Enable Google Sheets API, Google Drive API, Google Calendar API and Gmail API (send only).
3. **Service account.** IAM › Service accounts › Create ("valemont-os"), no role needed. Keys › Add key › JSON.
   Encode it: `base64 -w0 key.json` (macOS `base64 -i key.json`) → `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`. Delete the
   downloaded file afterwards. Its address looks like `valemont-os@<project>.iam.gserviceaccount.com`.
4. **Sharing** (the app never creates the spreadsheet, spec 4.8):
   * the main Sheet (a founder creates an empty Google Sheet) → share with the service account as **Editor** →
     `SHEETS_SPREADSHEET_ID` = the id in its URL;
   * each founder's private Sheet → owned by that founder, shared with the service account as Editor →
     `PRIVATE_SHEET_ID_THEO`, `PRIVATE_SHEET_ID_PABLO`;
   * the `Valemont OS` Drive folder → service account as **Viewer** (Files read path);
   * the shared calendar and each founder's calendar → service account ("See only free/busy" for personal calendars,
     "Make changes to events" for the shared one);
   * the **backups folder** → service account as **Editor** → `BACKUP_DRIVE_FOLDER_ID` (see §5).
5. **OAuth consent screen.** User type External, app name "Valemont OS", support address of a founder, scopes:
   `openid`, `email`, `profile` (sign-in), `drive.file` and `gmail.send` (asked later, only when used). While the app
   is in "Testing", add the two founders as test users (no Google verification needed for two users).
6. **OAuth client.** Credentials › Create OAuth client ID › Web application. Authorized redirect URIs:
   `<APP_BASE_URL>/api/auth/google/callback`, `<APP_BASE_URL>/api/auth/google/drive/callback`,
   `<APP_BASE_URL>/api/auth/google/gmail/callback` → `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

## 3. Environment variables (host settings, Production scope)

| Group | Variables |
|---|---|
| Required (LIVE) | `APP_MODE=live`, `SESSION_SECRET` (`openssl rand -base64 48`), `APP_BASE_URL`, `FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL`, `FOUNDER_THEO_TIMEZONE`, `FOUNDER_PABLO_TIMEZONE`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` |
| Optional Google | `PRIVATE_SHEET_ID_THEO`, `PRIVATE_SHEET_ID_PABLO` |
| Backups, jobs, logs | `BACKUP_DRIVE_FOLDER_ID`, `BACKUP_RETENTION_DAYS` (30), `BACKUP_JOB_SECRET` / `BACKUP_JOB_TOKEN`, `CRON_SECRET`, `SNAPSHOT_JOB_SECRET` / `SNAPSHOT_JOB_TOKEN`, `LOG_LEVEL` |
| Money | `WISE_API_TOKEN`, `WISE_PROFILE_ID`, `WISE_SCA_PRIVATE_KEY_BASE64`, `WISE_WEBHOOK_PUBLIC_KEY_BASE64`, `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Inbox, Instagram, website | `INBOX_WEBHOOK_SECRET`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `INSTAGRAM_*`, `WEBSITE_WEBHOOK_SECRET` |
| Trackers | `TRACKER_WEBHOOK_URL_*`, `TRACKER_WEBHOOK_SECRET_*`, `TRACKER_DAILY_SUMMARY_*`, `TRACKER_FEED_TOKEN_*` |
| Never in production | `SHEETS_API_BASE_URL`, `GOOGLE_API_BASE_URL`, `*_API_BASE_URL` (test fakes; LIVE refuses a fake Sheets URL in production), `DEMO_*`, `FAKE_*` |

A DEMO deployment (for review) uses `APP_MODE=demo` + `DEMO_ACCESS_CODE` (12+ chars) and no Google variables; it is
bannered and never touches live data. LIVE with missing credentials shows the setup page, never DEMO.

## 4. Webhook URLs to register

| Provider | URL | Secret |
|---|---|---|
| Stripe | `<APP_BASE_URL>/api/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` (whsec_…) |
| Wise | `<APP_BASE_URL>/api/webhooks/wise` (`balances#update`) | `WISE_WEBHOOK_PUBLIC_KEY_BASE64` |
| Meta (Instagram) | `<APP_BASE_URL>/api/inbox/meta` | `META_APP_SECRET`, `META_VERIFY_TOKEN` |
| Relay (Make/Zapier/n8n) | `<APP_BASE_URL>/api/inbox/webhook` | `INBOX_WEBHOOK_SECRET` |
| Website forms | `<APP_BASE_URL>/api/webhooks/website` | `WEBSITE_WEBHOOK_SECRET` |
| Scheduler | `<APP_BASE_URL>/api/jobs/backup` (daily), `/api/jobs/snapshot` (every 6 h) | `CRON_SECRET` or the job secrets/tokens |
| Uptime monitor | `<APP_BASE_URL>/api/health` (readiness) or `/api/health?probe=live` (liveness) | none (minimal answer, rate limited) |

Without Vercel Cron, any scheduler works: GitHub Actions (`curl -fsS -H "Authorization: Bearer $TOKEN" -X POST
<APP_BASE_URL>/api/jobs/backup`), a founder-owned Apps Script time trigger (`UrlFetchApp.fetch(url, {method: "post",
headers: {Authorization: "Bearer " + token}})`), or host cron. If none is set, the first request of the day starts the
backup and the first request of a 6-hour slot the snapshot (spec 4.6) — reliable only while someone uses the app.

## 5. First run (LIVE)

```bash
cp .env.example .env.local        # fill the LIVE values locally (never commit it)
npm ci
npm run setup:sheets              # creates tabs/headers, freezes headers, warning-only protection, schema hash
npm run doctor:sheets             # every required check ✓ (sharing, headers, duplicates, schema)
npm run build && npm start        # local check with the live Sheet, or deploy
```

Then sign in as each founder, open Settings › Diagnostics: Health "Ready", Storage requests, Backups state. Run
`npm run setup:sheets` again after each upgrade that adds tabs or columns (it is idempotent and never deletes data).

## 6. Backups

* **What.** A daily Drive copy of the live spreadsheet, named `Valemont OS backup YYYY-MM-DD`, in
  `BACKUP_DRIVE_FOLDER_ID`, made by the service account (`files.copy`). It is still a Google Sheet: no other database.
  After the copy the app reads both and compares every tab's header and row count (live may grow during the copy:
  the check is "before ≤ copy ≤ after"). Only a verified copy closes the day; otherwise the next trigger retries.
  Copies older than `BACKUP_RETENTION_DAYS` (default 30) that the app named are moved to the Drive trash; the newest
  copy is never deleted; files with other names are never touched.
* **When.** Vercel Cron (`/api/jobs/backup`) or another scheduler; else lazily on the first request of the day. Once per
  day: in-process lock, a lease row in `BackupRuns` (first writer wins across instances), a deterministic "done" row.
* **Personal Google accounts.** A service account owns no Drive storage, so the copy fails with
  `storageQuotaExceeded` (the app says so in Settings › Diagnostics › Backups). Two options:
  1. Google Workspace: put the backups folder in a **Shared Drive** and add the service account as Content manager;
  2. **Apps Script owned by a founder** (no Workspace): script.google.com › New project, paste
     ```js
     function backupValemont() {
       const id = "<SHEETS_SPREADSHEET_ID>", folder = DriveApp.getFolderById("<BACKUP_DRIVE_FOLDER_ID>");
       const day = Utilities.formatDate(new Date(), "Europe/Paris", "yyyy-MM-dd");
       if (!folder.getFilesByName("Valemont OS backup " + day).hasNext()) DriveApp.getFileById(id).makeCopy("Valemont OS backup " + day, folder);
     }
     ```
     and add a daily time-driven trigger. The copy is owned by the founder (their quota). Keep `BACKUP_DRIVE_FOLDER_ID`
     set (the app lists and verifies those copies: Diagnostics › Backups › Verify) but leave the job unscheduled.
* **JSON copy.** Settings › Diagnostics › Backups › "Download a copy (JSON)": every tab of the shared Sheet as text
  grids (private founder sheets are never included). The download is written to the audit log. Keep it somewhere
  private: it contains personal data.
* **Verify.** Diagnostics › Backups › Verify compares a copy with the live Sheet now (every live tab present, same
  header, copy rows ≤ live rows). From a terminal: `npm run restore:sheets -- --verify <backupSpreadsheetId>`.

## 7. Restore (tested: `tests/integration/backups.test.ts`)

Never overwrite the live spreadsheet. The procedure restores into a **new, empty** spreadsheet and switches the app to it:

1. Put the app in a quiet state (tell the other founder; optional: set `APP_MODE` to an invalid value to show the setup page).
2. A founder creates an empty Google Sheet "Valemont OS (restored YYYY-MM-DD)" and shares it with the service account as Editor.
3. Restore:
   ```bash
   # from a Drive copy (its id is in the copy's URL, or in Diagnostics › Backups › Open)
   npm run restore:sheets -- --from-sheet <backupSpreadsheetId> --to <newSpreadsheetId>
   # or from a JSON copy
   npm run restore:sheets -- --from-bundle ./valemont-os-backup-2026-11-09.json --to <newSpreadsheetId>
   ```
   The script refuses the live id (`SHEETS_SPREADSHEET_ID`) and any target that already holds data, creates the
   tabs (setup), writes every tab exactly as backed up (RAW: `+336…`, `-12.00`, `=SUM(A1)` stay text), adds columns
   that appeared since, re-applies protection, then verifies tabs, headers and row counts and prints ✓ or ✗.
4. `SHEETS_SPREADSHEET_ID=<newSpreadsheetId> npm run doctor:sheets` → all checks ✓.
5. Set `SHEETS_SPREADSHEET_ID=<newSpreadsheetId>` on the host and redeploy (Vercel: Settings › Environment
   Variables, then Deployments › Redeploy). Keep the old Sheet untouched until the founders have checked the app.

A Drive copy can also simply be opened and used: File › Make a copy (owned by a founder), share with the service
account, then steps 4–5.

## 8. Rollback

* **Code.** Vercel › Deployments › pick the previous production deployment › Instant Rollback (or `vercel rollback`).
  Schema changes are additive (setup only adds tabs/columns), so an older build reads a newer Sheet; unknown columns
  show as integrity warnings in Diagnostics, never as errors.
* **Data.** Restore from a backup (§7) into a new Sheet and point the app to it; nothing is overwritten.
* **Secrets.** Rotate `SESSION_SECRET` to sign everyone out; rotate a webhook secret at the provider and on the host
  together; Google key: create a new key, update the env var, redeploy, delete the old key.

## 9. Observability

* Structured JSON logs (Vercel › Logs): `{"level":"info","event":"request","correlationId":…,"method","path","status","ms","founder"}`;
  secrets, emails and phones are redacted. `LOG_LEVEL=debug` for more, `warn` for less.
* Every response of the API carries `x-request-id`; quote it when reporting a problem: it is in the log line, in the
  error message and in the AuditLog row.
* `GET /api/health` → 200 `{"status":"ok"|"degraded"}` or 503 `{"status":"fail"}`; `/api/health/details` (signed-in
  founder) gives reasons, Sheets latency, quota counters, integrations, audit queue. Point an uptime monitor at
  `/api/health` (at most one call per minute: Sheets is probed at most every 30 s).
