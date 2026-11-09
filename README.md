# Valemont OS

Internal operating system for Valemont Partners' two founders. Google Sheets is the only durable database.
Stages 1A + 1B: sign-in, LIVE/DEMO modes, simple CRM board, CSV import/export, one-tap activity logging, My Day
(modes, targets, meters, Next Best Action, tasks, streaks, end-of-day review), Command Center, tasks, sprints, weekly review
and reports, notifications, Agenda and Founder Points (shared calendars), Idea Box, Files (Drive), Audience with LinkedIn
import, private job search, opt-out hard block, WhatsApp daily report.

## Deploy (LIVE, no terminal)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvalemontops-boop%2Fvalemontops&project-name=valemont-os&repository-name=valemont-os&env=APP_MODE,SESSION_SECRET,FOUNDER_THEO_EMAIL,FOUNDER_PABLO_EMAIL,GOOGLE_OAUTH_CLIENT_ID,GOOGLE_OAUTH_CLIENT_SECRET,SHEETS_SPREADSHEET_ID,GOOGLE_SERVICE_ACCOUNT_KEY_BASE64&envDescription=Only%20the%20variables%20needed%20before%20the%20first%20sign-in.%20APP_MODE%3A%20live.%20SESSION_SECRET%3A%2032%2B%20random%20characters%20%28the%20%2Fsetup%20page%20of%20the%20deployed%20app%20can%20generate%20one%29.%20GOOGLE_SERVICE_ACCOUNT_KEY_BASE64%3A%20the%20JSON%20key%20file%20content%2C%20as-is%20or%20base64.%20After%20deploying%2C%20open%20%2Fsetup%20on%20the%20app%20to%20see%20what%20is%20still%20missing.&envLink=https%3A%2F%2Fgithub.com%2Fvalemontops-boop%2Fvalemontops%2Fblob%2Fmain%2Fdocs%2FSETUP_GUIDE.md)

The button asks only for the variables needed before the first sign-in (D086): `APP_MODE` (`live`), `SESSION_SECRET`,
`FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` (the JSON key file, pasted as-is or in base64).
`APP_BASE_URL` defaults to the Vercel address of the deployment, and the time zones to `Europe/Paris` /
`Europe/Madrid`. Vercel's clone flow copies the repository into your Git account; for an existing Vercel project,
add the same variables in Settings › Environment Variables instead.

After deploying:

1. Open `https://<your-app>/setup`: it lists which of these variables are still missing or invalid (names only,
   never a value), where to find each one, generates a `SESSION_SECRET` in the browser, and shows the exact Google
   sign-in redirect URIs to paste in Google Cloud. Add what is missing in Vercel, redeploy, click "Check again".
2. Sign in with Google. The first founder lands on **Installation** and clicks **Prepare the database**: the app
   creates the tabs and headers of the Sheet (the same idempotent logic as `npm run setup:sheets`, then
   `npm run doctor:sheets`), and the founder's private Sheet if `PRIVATE_SHEET_ID_*` is set. If the service account
   is not an Editor of the Sheet, the page says so and shows the address to share it with. Then My Day opens.
3. Later: Settings › Diagnostics › **Check** runs the doctor again. After an update that adds tabs or columns, the
   Installation page comes back once.

The CLI scripts below keep working for local use.

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

8. **Prepare the tabs** (idempotent, never overwrites data), then check everything. Deployed in LIVE, the app does
   this itself from the Installation page after the first sign-in (D086); locally:

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
