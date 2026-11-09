# Valemont OS

Internal operating system for Valemont Partners' two founders. Google Sheets is the only durable database.
Stages 1A + 1B: sign-in, LIVE/DEMO modes, simple CRM board, CSV import/export, one-tap activity logging, My Day
(modes, targets, meters, Next Best Action, tasks, streaks, end-of-day review), Command Center, tasks, sprints, weekly review
and reports, notifications, Agenda and Founder Points (shared calendars), Idea Box, Files (Drive), Audience with LinkedIn
import, private job search, opt-out hard block, WhatsApp daily report.

## Try it now (DEMO, no credentials)

```bash
npm install
```

```bash
cp .env.example .env.local
```

Set `SESSION_SECRET` in `.env.local` (e.g. `openssl rand -base64 48`), keep `APP_MODE=demo`, then:

```bash
npm run dev
```

Open http://localhost:3000 and choose "Continue as Théo (demo)". A black banner says DEMO on every screen.
To exercise the real Sheets code path without Google, run the fake Sheets API in a second terminal and set
`DEMO_BACKEND=fake-sheets` in `.env.local`:

```bash
npm run fake:sheets
```

## Connect your Google Sheet (LIVE)

Use Valemont's Google accounts for all of this, never a personal or builder account.

1. **Sheet.** A founder creates a private Google Sheet titled `Valemont OS — Production Data`. Copy its id from the URL
   (`https://docs.google.com/spreadsheets/d/<ID>/edit`). The app never creates it (service accounts have no Drive quota).
2. **Google Cloud project.** console.cloud.google.com → New project → *APIs & Services › Library* → enable **Google Sheets API**.
3. **Service account.** *IAM & Admin › Service accounts* → Create → no roles needed → *Keys › Add key › JSON*. Keep the file private.
4. **Share** the Sheet with the service account email (`…@….iam.gserviceaccount.com`) as **Editor**.
5. **OAuth consent screen.** *APIs & Services › OAuth consent screen*: User type External (or Internal if you use Google Workspace),
   scopes only `openid`, `email`, `profile`. With only these basic scopes, Testing status does not cause weekly re-consent.
   Add both founders as test users.
6. **OAuth client.** *Credentials › Create credentials › OAuth client ID › Web application*. Authorised redirect URIs:
   `http://localhost:3000/api/auth/google/callback` and `https://<your-domain>/api/auth/google/callback`.
7. **Environment variables** (in `.env.local` locally, in the host's secret settings in production; never in code or chat):

   | Variable | Value |
   |---|---|
   | `APP_MODE` | `live` |
   | `SESSION_SECRET` | 32+ random characters |
   | `APP_BASE_URL` | `http://localhost:3000` or your production URL |
   | `FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL` | the two Google sign-in addresses |
   | `FOUNDER_THEO_TIMEZONE`, `FOUNDER_PABLO_TIMEZONE` | `Europe/Paris`, `Europe/Madrid` |
   | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | from step 6 |
   | `SHEETS_SPREADSHEET_ID` | from step 1 |
   | `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | base64 of the JSON key (below) |

   Encode the key without line breaks (Linux):

   ```bash
   base64 -w0 service-account.json
   ```

   macOS:

   ```bash
   base64 -i service-account.json | tr -d '\n'
   ```

8. **Prepare the tabs** (idempotent, never overwrites data), then check everything:

   ```bash
   npm run setup:sheets
   ```

   ```bash
   npm run doctor:sheets
   ```

9. Start the app and sign in with Google:

   ```bash
   npm run dev
   ```

10. **Stage 1B (optional but recommended):**
   - *Private sheets:* each founder creates their own private Sheet, shares it with the service account (Editor), and you set
     `PRIVATE_SHEET_ID_THEO` / `PRIVATE_SHEET_ID_PABLO`. Run `npm run setup:sheets` again; it prepares those too.
   - *Calendar:* enable the **Google Calendar API**. Create a shared “Valemont” calendar, share it with the other founder and with
     the service account (“Make changes to events”). Each founder shares their own calendar with the service account
     (“See only free/busy”). Paste the calendar ids in **Settings › Calendars**.
   - *Drive:* enable the **Google Drive API**. Create a “Valemont OS” folder, share it with the service account as Viewer, paste
     its id in **Settings › Workspace**. Add `https://www.googleapis.com/auth/drive.file` to the OAuth consent screen scopes
     and `<APP_BASE_URL>/api/auth/google/drive/callback` to the OAuth client redirect URIs. Uploads ask each founder once.

If anything is missing, LIVE mode shows a **Setup required** page listing exactly what, and refuses every write. It never falls back to DEMO.

## Production hosting

Any Node 20.9+ host that keeps environment variables secret works (`npm run build && npm start`).
Vercel's Hobby plan is restricted to non-commercial personal use, so a business tool like this needs **Vercel Pro**
(about USD 20 per seat per month; check vercel.com/pricing). Render, Railway or Fly.io paid tiers are alternatives.
Set the variables from step 7, use the production URL as `APP_BASE_URL`, and add its callback to the OAuth client.
Keep `NODE_ENV=production`: the app then refuses a fake Sheets URL and requires `DEMO_ACCESS_CODE` for a public DEMO.

## Tests

```bash
npm run check
```

```bash
npm run build && npm run test:e2e
```

`npm run test:live` runs against a **separate test spreadsheet** (`LIVE_TEST_SPREADSHEET_ID` + service-account key in
`.env.live-test`) and prints `NOT RUN` without credentials.

## Docs
`docs/SPEC.md` (product specification), `CLAUDE.md` (rules), `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`,
`docs/DESIGN.md`, `docs/SECURITY.md`, `docs/INTEGRATIONS.md`, `docs/ACCEPTANCE.md`, `docs/TROUBLESHOOTING.md`.
