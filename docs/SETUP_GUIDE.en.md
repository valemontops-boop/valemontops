French version: docs/SETUP_GUIDE.md

# Valemont OS: the plan and the tutorial for every integration

For Théo and Pablo. This guide tells you **in what order** to connect each service, **where to click**, **what to
paste** and **how to check** that it works. It is based on the project documents (they are the reference):
`.env.example`, `docs/DEPLOYMENT.md`, `docs/INTEGRATIONS.md`, `docs/INBOX.md`, `docs/TRACKER.md`, `docs/SECURITY.md`,
`docs/ACCEPTANCE.md`, `docs/DECISIONS.md` (D086, D087). The steps at Google, Vercel, Wise, Stripe, Meta and LinkedIn
were checked against their official documentation in November 2026 (links in each section). These interfaces change
often: if a menu has a different name, search for the keyword given.

The app's interface is in French (Théo) and Spanish (Pablo); this guide quotes the French labels with the English
meaning in parentheses.

> **Three rules before you start**
> 1. **A key, token or password is pasted in one of two places only**: in the application (**Réglages ›
>    Intégrations › Configurer** (Settings › Integrations › Configure), where it is encrypted), or, for the few base
>    settings, in **Vercel › Settings › Environment Variables**. Never in a chat (including with Claude), never in an
>    email, never directly in the Google Sheet, never in the code.
> 2. **Every account belongs to Valemont** (your Google addresses, your Meta Business Manager, your Vercel
>    account). The Claude account that built the application is never used on your real resources.
> 3. **What you save in the application works immediately**: no redeploy. Only a change in Vercel needs
>    **Vercel › Deployments › ⋯ › Redeploy**.

In the application, everything is controlled from **Réglages › Intégrations**: one row per service (16 in total),
with its status (*Connecté* (Connected), *Non configuré* (Not configured), *Erreur* (Error), *À renouveler* (Needs
renewal), *Import uniquement* (Import only), *En attente d'approbation* (Awaiting approval), *Démo, simulé* (Demo,
simulated)), the **names** of the values (« défini dans Vercel » (set in Vercel), « enregistré dans l'app » (saved in
the app) or missing, never the value itself) and the buttons **Configurer** (Configure), **Tester la connexion** (Test
connection), **Synchroniser** (Sync), **Autoriser / Autoriser à nouveau** (Authorize / Authorize again) where they make
sense. At the bottom, **Réglages de base (définis dans Vercel)** (Base settings, set in Vercel) lists, read-only, what
stays in Vercel.

---

## 1. The plan

Tick the boxes as you go. "Who" is a suggestion: what matters is that the person has admin rights
on the account concerned.

> **Connecting a service is always the same (Phases 4 to 9)**
> 1. **Réglages › Intégrations** › the service's row › **Configurer** (Configure).
> 2. Follow the numbered steps (each has a link to the right page at the provider; the addresses to copy there are
>    shown with a Copy button).
> 3. **Paste** what the provider gives you, or click **Générer** (Generate) for a secret we create ourselves: it is
>    shown **only once**, copy it straight away into the other service.
> 4. **Enregistrer et tester** (Save and test): green = « Ça marche. » (It works.), red = the reason in plain words.
>    Nothing to redeploy.
>
> A variable with the same name in Vercel is still possible (the old way): **a variable in Vercel takes priority**,
> and the form then shows it as « défini dans Vercel » (set in Vercel) and cannot overwrite it.

### Phase 0 · Prerequisites and accounts (both of you · 30 min)

- [ ] Check that you have: a Google account each (ideally Google Workspace, same domain), a GitHub account, a Vercel
      account, admin access to Wise Business, Stripe, Meta Business (Facebook Page + Instagram professional accounts),
      the LinkedIn Pages, GA4, Search Console, the website hosting (Netlify or other), and Make, Zapier or n8n if you
      want the message relay.
- [ ] Nothing to install: no terminal, no Node.js. Everything happens in the browser.
- [ ] A shared password manager (1Password, Bitwarden…) to keep a copy of the base settings.

**Unlocks:** nothing yet, but it saves you from getting stuck halfway.

### Phase 1 · Google: project, Sheet, sign-in (Théo, or whoever holds the Google admin account · 1 h 30)

- [ ] Create the Google Cloud project and enable the 4 APIs (Sheets, Drive, Calendar, Gmail) (§2.2).
- [ ] Create the **service account** and download its JSON key (§2.2).
- [ ] Create the empty main Google Sheet and share it with the service account (§2.3).
- [ ] (Optional) Each of you creates a private Sheet and shares it (§2.3).
- [ ] Share the "Valemont OS" Drive folder (Viewer), prepare the backup folder, share the calendars (§2.5).
- [ ] OAuth consent screen + OAuth client (§2.4); the exact redirect addresses come in Phase 2.

**Unlocks:** the database (Sheet), Google sign-in for both founders, Files, Calendar.

### Phase 2 · Going live (Théo or Pablo · 30 min)

- [ ] Click the README's **Deploy with Vercel** button and fill in the form with **the base settings only**:
      `APP_MODE` = `live`, `SESSION_SECRET`, your two Google addresses, the OAuth client ID and secret, the Sheet ID,
      the service account JSON key (pasted as-is). **Pro** plan, Paris region (§2.7).
- [ ] Open `https://<your-app>/setup`: the page says what is still missing (names only, never a value) and shows
      the 3 redirect addresses to paste in Google Cloud (§2.4).
- [ ] On `/setup`, click « Générer un secret » (Generate a secret) to create `CONNECTORS_ENCRYPTION_KEY` (the key that
      encrypts what you will paste into the app) and, with another click, `CRON_SECRET`; add them in Vercel, keep a
      copy in the password manager, **Redeploy** once, then « Vérifier à nouveau » (Check again).

**Unlocks:** the application online in LIVE mode (without the base settings, it shows a configuration page,
never the demo). `APP_BASE_URL` sets itself on Vercel.

### Phase 3 · First start (both of you · 10 min)

- [ ] Sign in with Google: you land on the **Installation** page › « Préparer la base de données » (Prepare the
      database). The app creates the Sheet's tabs and headers, then checks everything. Then My Day opens (§2.8).
- [ ] Théo signs in, Pablo signs in from another browser; a non-founder account is refused.
- [ ] Réglages › Calendriers (Settings › Calendars) and Réglages › Espace de travail (Settings › Workspace): paste the
      calendar IDs and the Drive folder ID.

**Unlocks:** the whole core application (Ma journée (My Day), CRM, Appels (Calls), Tâches (Tasks), Agenda
(Calendar), Fichiers (Files)).

### Phase 4 · Money: Wise and Stripe (whoever administers the bank · 45 min)

- [ ] Wise › **Configurer**: read-only token (+ optional webhook) › **Enregistrer et tester** (§2.9).
- [ ] Stripe › **Configurer**: read-only restricted key + webhook secret › **Enregistrer et tester** (§2.10).

**Unlocks:** Finances (balances, transactions, sales, fees, payouts), MRR in Finances and the Command Center,
USD→EUR rate for supplier payments in dollars. The application can never move money.

### Phase 5 · Email (Gmail) and calendar (each for yourself · 10 min each, + possible Google delay)

- [ ] Set the client-email sending address (`EMAIL_SENDER_ADDRESS` in Vercel, or **Réglages › Espace de travail ›
      Adresse d'envoi des e-mails clients** (Settings › Workspace › Sending address)), then check that `gmail.send` is on
      the consent screen and each of you clicks **Autoriser** (Authorize) on the Gmail row **signing in with that sending
      address** (§2.6).
- [ ] Check that the Agenda merges the calendars properly (the other founder's personal calendar shows as « Occupé » (Busy)).

**Unlocks:** one-click email sending from Appels and Croissance › Messages (Growth › Messages) (always after your click).
⏳ With an "External" Google app, consent is requested again often, and publishing to production
requires **Google verification** (see §2.6).

### Phase 6 · Website and messages to handle (Pablo or whoever manages the websites · 1 h)

- [ ] Formulaires du site (Website forms) › **Configurer** › **Générer** › copy the secret to the website host (§2.11).
- [ ] Messages à traiter (To reply inbox) › **Configurer** › **Générer** › copy the secret into Make / Zapier / n8n (§2.12).

**Unlocks:** every website form becomes an inbound lead + an « À répondre » (To answer) item; comments
and messages arrive in Ma journée.

### Phase 7 · Social: Instagram, LinkedIn, GA4, Search Console (Théo or Pablo · 2 h + Meta/LinkedIn delays)

- [ ] Instagram › **Configurer**: token (system user) + account ID › **Enregistrer et tester** (§2.13).
- [ ] Instagram: comments/messages webhook → Messages à traiter (§2.12 B). ⏳ **Meta App Review** for accounts that
      have no role in the app.
- [ ] LinkedIn: export imports (.xls Page, .xlsx creator). ⏳ Community Management API: optional **access
      request**, long and not guaranteed.
- [ ] GA4 and Search Console: CSV exports imported every week.

**Unlocks:** Croissance (Growth: channels, costs, funnels), Studio contenu (Content Studio: numbers per post), Croissance › SEO.

### Phase 8 · Personal tracker (each for yourself · 15 min)

- [ ] Mon tracker (My tracker) › **Configurer**: paste your tracker's address, **Générer** the secret (and the feed
      token), copy them into your tracker › **Enregistrer et tester** (§2.16).

**Unlocks:** each of your activities sent to your personal tracker, and a feed it can read.

### Phase 9 · Backups and restore test (Théo · 30 min)

- [ ] Sauvegardes (Backups) › **Configurer**: paste the backup Drive folder's address › **Enregistrer et tester** (§2.17).
- [ ] (Optional) Capture planifiée (Snapshot job) › **Configurer**, only if a scheduler other than Vercel calls it.
- [ ] The next day: Réglages › Diagnostic › Sauvegardes › « Vérifier » (Verify) on the day's copy (restore drill).

**Unlocks:** verified daily copy of the Sheet, Instagram snapshot every 6 h, a plan B if something goes wrong.

### Phase 10 · Final checks (both of you · 45 min)

- [ ] Réglages › Intégrations: every configured row is **Connecté** after **Tester la connexion**; GA4 and
      Search Console = *Import uniquement* (normal); LinkedIn = *En attente d'approbation* (normal).
- [ ] Réglages › Diagnostic (Settings › Diagnostics): health « prête » (ready), backups « vérifiée » (verified).
- [ ] Go through the "Stage 4 gate: live validation" list in `docs/ACCEPTANCE.md` and record the date of each box in
      `docs/STATUS.md` (nothing is VERIFIED_LIVE before that).

---

## 2. The tutorial

### 2.1 Secrets: who creates them, where they go

You no longer need a terminal to make a secret:

| Secret | How to get it | Where it goes |
|---|---|---|
| `SESSION_SECRET` | Your password manager's generator (48+ characters), or the « Générer un secret » (Generate a secret) button on the `/setup` page | Vercel (Deploy button form) |
| `CONNECTORS_ENCRYPTION_KEY`, `CRON_SECRET` | « Générer un secret » on `/setup` (one click per variable, a different value each time; made in your browser, sent nowhere) | Vercel + a copy in the password manager |
| Service secrets (messages, website, tracker, jobs) | **Générer** (Generate) button in **Configurer**: made on the server, saved encrypted, shown **only once** | Copy it straight away into the other service (relay, website host, tracker, scheduler) |
| Keys given by a provider (Wise, Stripe, Meta) | At the provider (steps in each section) | Paste them in **Configurer** |

One secret per use: never reuse the same one for two variables. Keep `CONNECTORS_ENCRYPTION_KEY` in the password
manager: without it, the keys saved in the app become unreadable (you would have to paste them again).

*Advanced (optional):* in a terminal, `openssl rand -base64 48` (`SESSION_SECRET`), `openssl rand -base64 32`
(`CONNECTORS_ENCRYPTION_KEY`), `openssl rand -hex 32` (other secrets) give the same result.

### 2.2 Google Cloud: project, APIs, service account

**What it's for:** the service account is the "robot" that reads and writes the Google Sheet (the only
database), reads the shared Drive folder, reads the calendars and makes the backups.

**What you need:** your Google account (preferably Workspace), 30 minutes.

**Steps**
1. Go to https://console.cloud.google.com › project picker › **New Project** › name "Valemont OS".
   (Docs: https://developers.google.com/workspace/guides/create-project)
2. **APIs & Services › Library**: enable **Google Sheets API**, **Google Drive API**, **Google Calendar API**,
   **Gmail API**. (Docs: https://developers.google.com/workspace/guides/enable-apis)
3. **IAM & Admin › Service Accounts › Create service account**: name `valemont-os`, **no role**
   (its rights come only from the shares you make). Note its address:
   `valemont-os@<project>.iam.gserviceaccount.com`. (Docs: https://cloud.google.com/iam/docs/service-accounts-create)
4. Open the service account › **Keys** tab › **Add key › Create new key › JSON**. A file downloads.
   (Docs: https://cloud.google.com/iam/docs/keys-create-delete)
5. Open the file with a text editor (Notepad, TextEdit), copy **all** of its content.
6. Paste it as-is into the Deploy button form (Phase 2) as `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` (the file in base64
   also works), then **delete the file** (and empty the trash).

**Where it goes:** Vercel (base setting): `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`.

**Common problems**
- *"Service account key creation is disabled"*: recent Google Cloud organizations block keys
  by default (policy `iam.disableServiceAccountKeyCreation`). The Workspace admin must lift this policy
  **for this project only** (IAM › Organization policies), create the key, then put the policy back.
- Lost or leaked key: create a new key, replace the variable in Vercel, Redeploy, **then** delete the old key.

### 2.3 Google Sheets (database) and private Sheets

**What it's for:** everything you enter is read and written here. The private Sheets hold each founder's private
tasks and applications, invisible to the other.

**Steps**
1. On https://sheets.google.com, create an **empty** spreadsheet "Valemont OS" (the application never creates it).
2. **Share** › paste the service account's address › role **Editor** › untick "Notify people".
3. Copy the ID from the URL: `https://docs.google.com/spreadsheets/d/<THIS-ID>/edit` →
   `SHEETS_SPREADSHEET_ID`.
4. (Optional) **Each of you** creates, **from your own account**, a spreadsheet "Valemont OS – privé <first name>",
   shares it with the service account as **Editor** (and with no one else) → `PRIVATE_SHEET_ID_THEO`,
   `PRIVATE_SHEET_ID_PABLO` (add them in Vercel, then Redeploy).
5. The tabs and headers are created in Phase 3 by the app's « Préparer la base de données » button.

**Where it goes:** Vercel (base settings): `SHEETS_SPREADSHEET_ID` (required), `PRIVATE_SHEET_ID_THEO`,
`PRIVATE_SHEET_ID_PABLO` (optional).

**Check:** Réglages › Diagnostic › « Vérifier » (database check): everything « OK ».

**Common problems**
- *Permission denied*: the share was made with a different address, or as Viewer instead of Editor.
- Don't rename or delete tabs/columns by hand: the application finds columns by their
  name. Adding formatting rows or formulas in the Sheet breaks reading (Diagnostic reports it).
- The `IntegrationSecrets` tab holds only unreadable encrypted text: don't touch it (an edited or moved cell no
  longer decrypts, and the key would have to be pasted again in **Configurer**).

### 2.4 Google Sign-In (sign-in for both founders)

**What it's for:** only your two Google addresses can sign in. The same OAuth client is also used for the
Drive (`drive.file`) and Gmail (`gmail.send`) permissions, requested later, one at a time.

**Steps** (the menu is now called **Google Auth Platform** in the console)
1. **Google Auth Platform › Branding**: name "Valemont OS", support email = a founder's address,
   authorized domain = your domain. (Docs: https://developers.google.com/workspace/guides/configure-oauth-consent)
2. **Audience**:
   - if you are **both in the same Google Workspace**: type **Internal** (the simplest: no
     verification, no test users);
   - otherwise: type **External**, status **Testing**, and add both your addresses under **Test users**.
3. **Data access › Add or remove scopes**: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`, `.../auth/drive.file`, `.../auth/gmail.send`. (The last two are only requested
   when you use them: this is incremental authorization,
   https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth)
4. **Clients › Create client** › type **Web application** › name "Valemont OS". **Authorized redirect URIs**: copy
   the three exact addresses shown on the app's `/setup` page (Phase 2). They look like this (no trailing `/`):
   - `https://<your-app>/api/auth/google/callback`
   - `https://<your-app>/api/auth/google/drive/callback`
   - `https://<your-app>/api/auth/google/gmail/callback`
   If you create the client before deploying, come back and add these addresses afterwards.
5. Copy the **Client ID** → `GOOGLE_OAUTH_CLIENT_ID` and the **Client secret** → `GOOGLE_OAUTH_CLIENT_SECRET`
   (straight into the Deploy button form).

**Where it goes:** Vercel (base settings): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL`; optional: `FOUNDER_THEO_TIMEZONE` (default `Europe/Paris`),
`FOUNDER_PABLO_TIMEZONE` (default `Europe/Madrid`), `APP_BASE_URL` (automatic on Vercel).

**Check:** open the application, « Se connecter avec Google » (Sign in with Google): Théo and Pablo get in, a third
address is refused.

**Common problems**
- `redirect_uri_mismatch`: the registered URI doesn't exactly match the app's address (https, no trailing `/`, same
  subdomain). If you change domain, add the 3 new URIs (the `/setup` page gives them).
- *"Access blocked: app has not completed the Google verification process"*: in External/Testing, the address is
  not among the test users.

### 2.5 Google Drive and Google Calendar

**What it's for:** Fichiers (Files) lists the "Valemont OS" folder; uploading a file uses **your** `drive.file`
permission (the file belongs to you). Agenda (Calendar) merges the shared "Valemont" calendar and your calendars; the other
founder's personal calendar only shows as « Occupé » (Busy). Founder meetings are written to the shared calendar.

**Drive steps**
1. In Google Drive, "Valemont OS" folder › **Share** › service account as **Viewer**.
2. Copy the ID from the URL `https://drive.google.com/drive/folders/<ID>` and paste it into the application:
   **Réglages › Espace de travail › Identifiant du dossier Drive** (Settings › Workspace › Drive folder ID).

**Calendar steps** (Docs: https://support.google.com/calendar/answer/37082)
1. Google Calendar › ⚙ **Settings** › choose the shared "Valemont" calendar › **Share with specific people or
   groups** › add the service account with **Make changes to events**.
2. Each of you, for your personal calendar: same path, but with **See only free/busy (hide details)**.
3. In each calendar › **Integrate calendar › Calendar ID**: copy it into **Réglages › Calendriers**.

**Where it goes:** in the application (Réglages › Espace de travail, Réglages › Calendriers); no variable.

**Check:** Réglages › Intégrations › Google Drive and Google Calendar › **Tester la connexion**; open Fichiers
and Agenda. First file upload: Google asks you for the Drive permission once (it lasts about 1 h, then one
click on **Autoriser à nouveau**).

**Common problems:** empty calendar = wrong ID or forgotten share; invisible file = it isn't in the
shared folder.

### 2.6 Gmail (send only)

**What it's for:** the emails prepared by the application (after a call, follow-ups, Croissance › Messages)
are sent **when you click**, and **all from Valemont's sending address** (the same for both of you; each keeps their
own signature, D090). The application never reads the inbox. Without Gmail connected, it opens a pre-filled Gmail
draft **on the sending address's mailbox** (`authuser`): nothing is blocked.

**Steps**
1. Set the sending address: variable `EMAIL_SENDER_ADDRESS` in Vercel (default value), or **Réglages › Espace de
   travail › Adresse d'envoi des e-mails clients** (Settings › Workspace, takes priority). It must be a **real Google
   mailbox** (Gmail or Google Workspace) you can sign in to, not just an alias.
2. Check (step 3 of §2.4) that the Gmail API is enabled, that `openid`, `.../auth/userinfo.email` and `gmail.send`
   are in Data access, and that the **third** redirect URI `https://<your-app>/api/auth/google/gmail/callback` is
   registered on the OAuth client (it is one of the three addresses of §2.4).
3. **External app in Testing**: also add the sending address under **Test users**. **Internal** app: the sending
   address must belong to the same Google Workspace.
4. Each of you, in the application: **Réglages › Intégrations › Gmail › Autoriser** (or « Connecter Gmail » (Connect
   Gmail) in Appels). Google suggests the sending address (`login_hint`): **pick that account**, then accept. The app
   asks for `gmail.send` + `openid email` to read the verified address of the chosen account: **any other address is
   refused** with the message « Connecte-toi avec … (l'adresse d'envoi de Valemont) » (Sign in with … (Valemont's
   sending address)), and nothing is stored.

**Where it goes:** nothing to paste (same OAuth client). The authorization stays in an encrypted cookie in your
browser; if the sending address changes, connect Gmail again.

**Check:** the Gmail row shows the authorization as active in this browser. There is **no** « Tester la
connexion » for Gmail (a test would send a real email): send yourself a test email from a contact record to your
address.

**⏳ Google delays and limits** (Docs: https://developers.google.com/workspace/gmail/api/auth/scopes,
https://support.google.com/cloud/answer/13463073)
- `gmail.send` is a **sensitive** scope.
- **Internal** app (Workspace): no verification, nothing to wait for. This is the recommended choice.
- **External app in Testing**: works for your two addresses ("unverified app" screen to accept),
  but Google asks for consent again often (at least every 7 days).
- Moving an **External app to production** with `gmail.send` requires **Google verification** (demo
  video, privacy policy, verified domain): allow **several days to a few weeks**.

### 2.7 Vercel: going live

**What it's for:** hosting the application, keeping the base settings, running the two scheduled jobs.

**Steps**
1. Click the **Deploy with Vercel** button at the top of `README.md` ("Deploy (LIVE, no terminal)" section). Vercel
   copies the repository into your GitHub account and shows a form that asks only for the base settings:
   `APP_MODE` (`live`), `SESSION_SECRET` (§2.1), `FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL`,
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (§2.4), `SHEETS_SPREADSHEET_ID` (§2.3),
   `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` (the JSON file pasted as-is, §2.2). Click **Deploy**.
   If the Vercel project already exists, add these variables in **Settings › Environment Variables** instead.
   (Docs: https://vercel.com/docs/getting-started-with-vercel/import)
2. **Pro plan**: the Hobby plan is restricted to personal non-commercial use and doesn't allow a job every
   6 h. A single paying member is enough. (Docs: https://vercel.com/docs/limits/fair-use-guidelines,
   https://vercel.com/docs/cron-jobs/usage-and-pricing)
3. **Settings › Functions**: region **Paris (cdg1)**; leave the Node.js runtime and Fluid Compute (default).
4. Open **`https://<your-app>/setup`**. For each base setting, the page says whether it is set, missing, to fix,
   automatic or default (never its value), and where to find it. It shows the three exact **redirect URIs** to paste
   in Google Auth Platform › Clients (§2.4).
5. Still on `/setup`, « Générer un secret » (Generate a secret) → add the value in Vercel as
   `CONNECTORS_ENCRYPTION_KEY`; « Générer un secret » a second time → `CRON_SECRET`. In **Settings › Environment
   Variables**, environment **Production**, tick **Sensitive** (the value then becomes unreadable, even for you) and
   keep a copy in the password manager. (Docs: https://vercel.com/docs/environment-variables)
6. **Deployments › ⋯ › Redeploy**, then « Vérifier à nouveau » (Check again) on `/setup`: everything should be green.
7. (Optional) **Settings › Domains** › add `os.<domain>` › create the DNS record shown (CNAME) at your registrar ›
   wait for the certificate. `APP_BASE_URL` follows Vercel's production address automatically; you can also set it
   (`https://os.<domain>`, no trailing `/`, then Redeploy). Add the 3 new redirect URIs at Google.
   (Docs: https://vercel.com/docs/domains/working-with-domains/add-a-domain)
8. Scheduled jobs: nothing to create, `vercel.json` declares the daily backup (02:17 UTC) and the Instagram
   snapshot (every 6 h). Vercel calls them with `CRON_SECRET`. They only run on the production deployment. Visible in
   **Settings › Cron Jobs**. (Docs: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)

**Where it goes:** Vercel. This is the only step where you fill in Vercel; everything else happens in the app.

**Never put in production:** `SHEETS_API_BASE_URL`, `GOOGLE_API_BASE_URL`, `WISE_API_BASE_URL`,
`STRIPE_API_BASE_URL`, `DEMO_BACKEND`, `FAKE_SHEETS_URL`, `FAKE_SHEETS_SPREADSHEET_ID`, `DEMO_ACCESS_CODE` (test
and demo tools). `INSTAGRAM_API_BASE_URL` only in the Instagram Login case (§2.13).

**Check:** `https://<your-app>/api/health` answers `{"status":"ok"}` or `"degraded"` (`fail` = a base setting is
missing or the Sheet is unreachable).

**Common problems:** « configuration requise » (configuration required) page (`/setup`) = a base setting is missing
(its name is shown); variable added in Vercel but nothing changes = not redeployed.

### 2.8 First start (Phase 3)

No terminal: the database is prepared from the app.

1. Open the app and click « Se connecter avec Google » (Théo or Pablo, whoever starts).
2. While the Sheet is not ready, you land on the **Installation** page. Click « Préparer la base de données »
   (Prepare the database): the app creates tabs and headers, freezes headers, adds a warning-only protection and the
   starting settings, then runs the check. Progress and a per-tab result are shown. Safe to click again: it never
   deletes or overwrites anything.
3. If the service account lacks **Editor** access, the page says so and shows the exact service account address:
   Share › paste the address › Editor › untick notification › Share, then click again.
4. Your private Sheet (if `PRIVATE_SHEET_ID_<name>` is set) is prepared at the same time; each founder prepares
   their own at first sign-in (the app never touches the other founder's private Sheet).
5. Then My Day opens. Pablo signs in from another browser; a non-founder account is refused. Fill in Réglages ›
   Calendriers and Réglages › Espace de travail. **Réglages › Diagnostic**: health « prête », and « Vérifier » (the
   database check) whenever you want.
6. After an update that adds tabs or columns, the Installation page comes back once: one click.

*Advanced (optional):* `npm run setup:sheets` and `npm run doctor:sheets` do the same from a terminal
(`docs/DEPLOYMENT.md` §5).

### 2.9 Wise (bank, read-only)

**What it's for:** the Finances page and the Command Center's cash position: balances, statements, live transactions
via webhook. The same read-only token also provides **Wise's USD→EUR rates** used for **supplier payments in
dollars**. **The token can never move money.**

**What you need:** admin access to the **Wise Business** account, your phone (two-factor authentication).

**Steps** (Docs: https://docs.wise.com/guides/developer/auth-and-security/personal-api-token)
1. In the application: **Réglages › Intégrations › Wise › Configurer**. Keep the window open.
2. wise.com › Business account › **Settings › API tokens** (depending on the version: *Connect and manage apps › API
   tokens* or *Integrations and Tools › API tokens*) › **Add new token** › name "Valemont OS" › access **Read only** ›
   confirm two-factor authentication. The token is shown **only once**: paste it straight into the field « Jeton
   d'API en lecture seule » (Read-only API token, `WISE_API_TOKEN`, shaped 8-4-4-4-12 letters and digits).
3. « Identifiant du profil entreprise » (Business profile id): leave empty, the app finds the Business profile itself.
4. (Optional, live transactions) At Wise, add a **`balances#update`** webhook with the **webhook address** shown in
   the form (`https://<your-app>/api/webhooks/wise`), in Wise › Settings › **Webhooks** if the menu exists on your
   account (Docs: https://docs.wise.com/guides/developer/webhooks/subscribe-to-webhooks). Then copy Wise's
   **production public key** for webhooks ("Event handling" page:
   https://docs.wise.com/guides/developer/webhooks/event-handling) and paste it **whole** (BEGIN and END lines
   included) into « Clé publique des webhooks Wise » (Wise webhook public key). No need to convert it: the app does
   it. If the Webhooks menu doesn't exist, skip this step: the **Synchroniser** button catches up on transactions.
5. **Enregistrer et tester**: the app reads your balances once. Green = connected.

*Advanced (optional):* **SCA key** to read statements when Wise requires strong authentication. It is made in a
terminal (`openssl genrsa -out wise-private.pem 2048`, then
`openssl rsa -pubout -in wise-private.pem -out wise-public.pem`); upload `wise-public.pem` in Wise › API tokens ›
**Manage public keys**, paste the content of `wise-private.pem` into « Clé privée pour les relevés (SCA) » (Private
key for statements), then delete the files. In the EU/UK (PSD2), Wise may refuse statements through a personal token,
even with the key: balances and the webhook still work, and the history comes from a **Wise statement CSV export**
(Finances › « Importer un CSV Wise » (Import a Wise CSV)). Creating the webhook subscription through the API is also
possible (see `docs/INTEGRATIONS.md`).

**Where it goes:** in the app (Configurer): `WISE_API_TOKEN` (required for Wise), `WISE_PROFILE_ID`,
`WISE_WEBHOOK_PUBLIC_KEY_BASE64`, `WISE_SCA_PRIVATE_KEY_BASE64` (optional).

**Check:** green after **Enregistrer et tester**, then **Synchroniser** (statements). Balances appear in Finances. A
credit automatically classified as revenue stays « à vérifier » (to review) until a founder has confirmed it.

**Common problems:** red 401 = token revoked or copied wrong (paste it again); "SCA required" = SCA key missing or
rejected → CSV import; wrong profile = fill in the business profile id in the form.

### 2.10 Stripe (read-only)

**What it's for:** Stripe balance, sales, fees, payouts, MRR (Finances and Command Center). The key can neither
charge nor refund. Stripe → Wise payouts are internal transfers: a sale is never counted twice.

**Steps** (Docs: https://docs.stripe.com/keys/restricted-api-keys, https://docs.stripe.com/webhooks)
1. In the application: **Réglages › Intégrations › Stripe › Configurer**.
2. Stripe Dashboard (**live** mode) › **Developers › API keys › Create restricted key** › name "Valemont OS".
   Set **Read** on: *Balance*, *Balance transactions*, *Subscriptions*, *Customers*. Everything else: **None**.
   Paste the key (`rk_live_…`) into « Clé restreinte (lecture seule) » (Restricted key, read-only). A `pk_` key is
   refused.
3. **Developers › Webhooks** (in Workbench: *Event destinations*) › **Add destination** › paste the **webhook
   address** shown in the form (`https://<your-app>/api/webhooks/stripe`) › events: `charge.*`, `payout.*`,
   `customer.subscription.*`, `invoice.paid`, `balance.available`.
4. Open the destination › **Signing secret** › Reveal (`whsec_…`) › paste it into « Secret de signature du webhook »
   (Webhook signing secret).
5. **Enregistrer et tester**: the app reads the balance once.

**Where it goes:** in the app (Configurer): `STRIPE_API_KEY` (required for Stripe), `STRIPE_WEBHOOK_SECRET`
(optional but recommended).

**Check:** green after **Enregistrer et tester**, then **Synchroniser**; in Stripe, *Send test event* on the
destination must answer 200.

**Common problems:** 403 "missing permission" = a resource isn't set to Read (the message says which one);
400 on the webhook = secret from another destination or from test mode.

### 2.11 Website: forms → signed webhook

**What it's for:** every form (contact, lead, booking) on the FR/ES websites creates an inbound lead
(owner Théo for FR, Pablo for ES) and an « À répondre » item. An unsubscribed contact is blocked: nothing
is created.

**Steps**
1. In the application: **Réglages › Intégrations › Formulaires du site › Configurer** › **Générer** next to
   « Secret de signature des formulaires » (Form signing secret). The secret (`WEBSITE_WEBHOOK_SECRET`) is saved
   encrypted and shown **only once**: copy it.
2. At the website host (Netlify › Site configuration › Environment variables), add `WEBSITE_WEBHOOK_SECRET` with that
   value and `VALEMONT_WEBHOOK_URL` with the **form webhook address** shown in the form
   (`https://<your-app>/api/webhooks/website`).
3. Netlify Forms: Netlify's outgoing webhook can't sign, so you need a small **submission-created** function
   (ready-to-copy code in `docs/INTEGRATIONS.md` › "Netlify Forms"). Docs:
   https://docs.netlify.com/functions/trigger-on-events/. Other host: any server-side code
   (Cloudflare Worker, Apps Script…) that signs the same way (`docs/INTEGRATIONS.md` › "Generic form handler").
   This is the only "code" step: whoever manages the website does it once. **The secret must never be in browser
   code.**
4. In the form: honeypot field `bot-field`, hidden fields `lang`, `page`, UTM, `consent_version`, and a
   consent checkbox whose sentence is sent as `consent_text`.
5. **Enregistrer et tester**, then send a real test form.

**Where it goes:** in the app (Configurer): `WEBSITE_WEBHOOK_SECRET`; on the website side (not in Valemont OS): the
same value + `VALEMONT_WEBHOOK_URL`.

**Check:** green after **Enregistrer et tester** (the secret is present and long enough); the test form appears in
Ma journée › À répondre (My Day › To answer).

**Common problems:** 401 `stale_timestamp` = server clock off by more than 5 min; 401 `bad_signature` =
different secrets (after a new **Générer**, copy it to the host again) or signature computed on reformatted JSON (you
must sign the exact text sent).

### 2.12 Messages to handle: Make / Zapier / n8n relay and Instagram

**What it's for:** gathering what's waiting for a reply (comments, DMs, LinkedIn notifications…) with a suggested
reply in your language. **Nothing is ever sent automatically**: « Copier une réponse » (Copy a reply) opens the
conversation and you paste it yourself. Flagged email/WhatsApp replies and website leads already arrive without
connecting anything.

Everything is set in **Réglages › Intégrations › Messages à traiter (To reply inbox) › Configurer**.

**A. Relay (Make, Zapier or n8n)**
1. **Générer** next to « Secret de signature du relais » (Relay signing secret, `INBOX_WEBHOOK_SECRET`): copy the
   value shown only once and paste it in the relay (variable / protected connection).
2. Trigger of your choice: "Instagram for Business › Watch comments", the relay's mailbox (Make *Mailhook*,
   *Email by Zapier*) fed by a **Gmail filter** that forwards LinkedIn notifications, etc.
3. Action: HTTP POST to the **relay address** shown in the form (`https://<your-app>/api/inbox/webhook`), JSON body
   (format in `docs/INBOX.md`), header `X-Valemont-Signature: sha256=<HMAC-SHA256 of the exact body with the
   secret>`: Make = function `sha256(body; "hex"; secret)` in HMAC mode; Zapier = *Code by Zapier* step; n8n =
   *Crypto* node (HMAC, SHA256, hex). `external_id` must be stable (it's the duplicate guard).

**B. Instagram via the Meta app** (see also §2.13 for the app itself)
1. In the form, **Générer** next to « Jeton de vérification Meta » (Meta verify token, `META_VERIFY_TOKEN`): it is
   already saved; copy it.
2. In the Meta app › **Webhooks** (or Instagram › *API setup* › *Configure webhooks*): callback URL = the **Meta
   address** from the form (`https://<your-app>/api/inbox/meta`), verify token = the copied value › **Verify and
   save**. (Docs: https://developers.facebook.com/docs/instagram-platform/webhooks)
3. Subscribe the **`comments`** and **`messages`** fields for both accounts (Valemont, 30/30).
4. **App settings › Basic › App secret** (32 letters and digits) › paste it into « Clé secrète de l'app Meta » (Meta
   app secret, `META_APP_SECRET`) › **Enregistrer et tester**.
5. (Optional) Name the accounts: setting `instagram_account_labels` (see `docs/INBOX.md`).
6. ⏳ Permissions `instagram_business_manage_comments`, `instagram_business_manage_messages` (or the equivalents
   `instagram_manage_comments` / `instagram_manage_messages`): to receive events from accounts that have
   no role in the app, Meta requires **App Review** (a few days to a few weeks, demo video,
   privacy policy). In the meantime, use the Make "Watch comments" relay.
   (Docs: https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review)

**Where it goes:** in the app (Configurer): `INBOX_WEBHOOK_SECRET`, `META_VERIFY_TOKEN` (generated here),
`META_APP_SECRET` (pasted from Meta).

**Check:** green after **Enregistrer et tester**; then a test comment on Instagram (or a call from the relay) appears
in Ma journée › À répondre.

**Common problems:** Meta can't "verify and save" the URL = the token pasted at Meta differs from the generated one
(generate it again and copy it again); 401 from the relay = signature computed on a different text than the body
sent, or the old secret still in the relay.

### 2.13 Instagram: statistics (read-only) and snapshot every 6 h

**What it's for:** followers, views, reach, profile visits, website clicks, and numbers for each post/Reel at
24 h, 72 h, 7 d, 30 d, stories every 6 h (Studio contenu, Croissance). Without a token: manual entry, marked
« saisi à la main » (entered by hand).

**What you need:** each Instagram account as a **professional account** (Business or Creator) **linked to a Facebook
Page** (Docs: https://developers.facebook.com/docs/instagram-platform/overview), all within **Valemont's Meta business
portfolio**.

**Steps (recommended method: Facebook Login + system user, non-expiring token)**
1. In the application: **Réglages › Intégrations › Instagram › Configurer**.
2. https://developers.facebook.com › **My Apps › Create App** › type Business, attached to the Valemont portfolio
   (never a third party's personal account). Add the **Instagram** product (API with Facebook Login).
   (Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/)
3. **Business settings** (business.facebook.com/settings) › **Users › System users › Add**
   (admin role) › **Assign assets**: the app, the Page and the Instagram accounts.
   (Docs: https://developers.facebook.com/docs/marketing-api/system-users/)
4. **Generate token** › Valemont OS app › expiration **Never** › permissions `instagram_basic`,
   `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement` › paste it into « Jeton d'accès » (Access
   token, `INSTAGRAM_ACCESS_TOKEN`).
5. Account ID: in the Graph API Explorer, `me/accounts?fields=instagram_business_account` → the number
   `instagram_business_account.id` › paste it into « Identifiant du compte Instagram » (Instagram account id,
   `INSTAGRAM_BUSINESS_ACCOUNT_ID`).
6. « Quel compte » (Which account): leave empty for `ig-valemont`, or enter `ig-thirty` for 30/30. « Date
   d'expiration du jeton » (Token expiry date): empty for a system user token.
7. **Enregistrer et tester**: the app reads the profile once. Standard Access on your own accounts: **no App Review
   needed** for statistics.

*Advanced (optional):* **two accounts at once** = variable `INSTAGRAM_ACCOUNTS_JSON` in Vercel (exact format in
`.env.example`, then Redeploy), instead of the form. **Fallback method (Instagram Login, 60-day token)**: permissions
`instagram_business_basic` + `instagram_business_manage_insights`, Vercel variable
`INSTAGRAM_API_BASE_URL=https://graph.instagram.com/v21.0`, and the expiry date in the form. The application shows
the days remaining and creates a task 14 days before; renewal:
https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token, then paste the new token in
**Configurer** (no redeploy).

**Snapshot every 6 h:** already scheduled by Vercel Cron (`CRON_SECRET`, Phase 2). The row **Capture planifiée
(Snapshot job) › Configurer** is only needed if another scheduler calls it (Apps Script, GitHub Actions,
cron-job.org): **Générer** the « Jeton de la tâche » (Job token), copy it once into the scheduler, which calls the
**job address** shown every 6 hours with the header `Authorization: Bearer <token>` (or generate the job signing
secret instead if the scheduler can sign, see `docs/INTEGRATIONS.md`) › **Enregistrer** (Save).

**Where it goes:** in the app (Configurer): `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`,
`INSTAGRAM_ACCOUNT_KEY`, `INSTAGRAM_TOKEN_EXPIRES_AT`, `SNAPSHOT_JOB_TOKEN`, `SNAPSHOT_JOB_SECRET`; Vercel (advanced):
`INSTAGRAM_ACCOUNTS_JSON`, `INSTAGRAM_API_BASE_URL`.

**Check:** green after **Enregistrer et tester**, then **Synchroniser**; the « Capture planifiée » row shows the last
run; Studio contenu shows the numbers.

**Common problems:** no `instagram_business_account` = account not professional or not linked to the Page;
story statistics "not available" under 5 viewers (this is normal, never 0); demographics missing under 100
followers.

### 2.14 LinkedIn (imports, and API later)

**What it's for:** impressions, followers and countries for the Valemont / 30/30 Pages and your creator profiles, in
Croissance. LinkedIn prospecting stays manual (log + opening the profile): no scraping, no automatic
messages.

**Now: the exports**
1. LinkedIn Page (as admin) › **Analytics** › tab (Content, Visitors, Followers) › **Export** › period ›
   **.xls** file.
2. Creator profile: your profile's **Analytics** › **Export** › **.xlsx** file.
3. In the application: Croissance › **Ajouter des chiffres** (Add numbers) › **Importer un export LinkedIn** (Import a
   LinkedIn export). Re-importing the same file adds no duplicates. Once a week is enough.

**Later (⏳ optional): Community Management API**
- Create a **new** dedicated LinkedIn Developers app (no other product), linked to Valemont's **verified Page**,
  request *Development tier* access, then *Standard tier* with a video of each use case. Long
  review, possible refusal (you then need a new app). The adapter will only be built after approval.
  (Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview,
  https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access)

**Where it goes:** nothing to paste. **Expected status:** *En attente d'approbation* (normal).

### 2.15 GA4 and Search Console (CSV imports)

**What it's for:** website visits and leads by source (including AI engines) in Croissance; queries and
pages (clicks, impressions, position) in Croissance › SEO and the Studio contenu optimizer.

**GA4** (Docs: https://support.google.com/analytics/answer/9317657)
1. analytics.google.com › **Reports** › Acquisition › Traffic acquisition › period (e.g. last 7 days).
2. **Share this report** (top right) › **Download File** › **CSV**.
3. Croissance › **Ajouter des chiffres** › import the GA4 CSV.

**Search Console** (Docs: https://support.google.com/webmasters/answer/7576553)
1. search.google.com/search-console › website property › **Performance** › period.
2. **Export** › **Download CSV**.
3. Croissance › SEO › **Ajouter des chiffres Search Console** (Add Search Console numbers).

**Where it goes:** nothing to paste. **Expected status:** *Import uniquement* with the date of the last import.
Suggested routine: on Monday, both exports.

### 2.16 Mon tracker (My tracker: your personal tracking app)

**What it's for:** each of your activities (calls, emails, visits…) is sent to your personal tracker, signed;
your tracker can also read your activities through a feed. LIVE only. Each of you configures **your own**, signed in
with your own account: the other founder neither sees nor changes your values.

**Steps** (in **Réglages › Intégrations › Mon tracker › Configurer**)
1. In your tracking app, create an **incoming webhook** that accepts JSON and copy its address (https required) ›
   paste it into « Adresse du tracker » (Tracker address, `TRACKER_WEBHOOK_URL_<name>`).
2. **Générer** next to « Secret de signature » (Signing secret, `TRACKER_WEBHOOK_SECRET_<name>`): copy the value shown
   only once and give it to your tracker so it can verify the `X-Valemont-Signature` header (verification code in
   `docs/TRACKER.md`).
3. (Optional) Feed: **Générer** the « Jeton du flux » (Feed token, `TRACKER_FEED_TOKEN_<name>`); your tracker calls
   the **feed address** shown (`https://<your-app>/api/tracker/feed?from=YYYY-MM-DD&to=YYYY-MM-DD`) with
   `Authorization: Bearer <token>`.
4. **Enregistrer et tester**: one signed test event goes to your tracker.

*Advanced (optional):* `TRACKER_DAILY_SUMMARY_THEO=1` (or `_PABLO`) in Vercel to also send the day's summary when the
daily review is saved.

**Where it goes:** in the app (Configurer, each your own): `TRACKER_WEBHOOK_URL_*`, `TRACKER_WEBHOOK_SECRET_*`,
`TRACKER_FEED_TOKEN_*`; Vercel (advanced): `TRACKER_DAILY_SUMMARY_*`.

**Check:** green after **Enregistrer et tester** (or Réglages › **Mon tracker** › **Envoyer un événement de test**
(Send a test event)); « Envoyer cette période » (Send this period) fills a gap without duplicates.

**Common problems:** `http://` address refused; the tracker must answer 2xx in under 5 s.

### 2.17 Backups, scheduled jobs, restore

**What it's for:** a daily Google Sheet copy, verified, kept 30 days; a tested restore.

**Steps**
1. Backup folder:
   - **Google Workspace**: create a **shared drive** "Valemont OS – sauvegardes", add the service account as
     **Content manager**;
   - **personal Google account**: a service account has no storage space. Create a normal folder, share it
     as Editor, and make the copy with your own small **Apps Script** (copy-paste code and daily trigger in
     `docs/DEPLOYMENT.md` › 6. Backups, all in the browser).
2. In the application: **Réglages › Intégrations › Sauvegardes › Configurer** › paste the **folder's address** (or
   only its ID) into « Dossier des sauvegardes » (Backups folder, `BACKUP_DRIVE_FOLDER_ID`). « Jours à conserver »
   (Days to keep): empty = 30 (1 to 365).
3. Scheduling: nothing to do, Vercel Cron runs the backup at 02:17 UTC with `CRON_SECRET` (Phase 2). Without a
   scheduler, the first visit of the day starts the copy. (Optional) For another scheduler: **Générer** the « Jeton
   de la tâche » (Job token) and copy it once into it.
4. **Enregistrer et tester**: the app lists the folder once.
5. **Restore drill** (the next day, then every quarter), no terminal: Réglages › Diagnostic › **Sauvegardes** ›
   « Vérifier » (Verify) on the day's copy (it is compared with the current database: tabs, headers, row counts).
   For a real need: open the copy › File › **Make a copy**, share it with the service account as Editor, put its ID
   in `SHEETS_SPREADSHEET_ID` (Vercel) › Redeploy; the Installation page checks everything. **Don't switch
   production over** for a drill, and keep the old Sheet untouched.
6. (Optional) An uptime monitor (UptimeRobot, Better Stack…) on `https://<your-app>/api/health`,
   at most once a minute.

*Advanced (optional):* full restore from a terminal into a **new** empty Sheet:
`npm run restore:sheets -- --from-sheet <backup copy id> --to <new Sheet id>`, then
`SHEETS_SPREADSHEET_ID=<new id> npm run doctor:sheets` (the script refuses the production Sheet and any non-empty
Sheet; details in `docs/DEPLOYMENT.md` §7). `BACKUP_JOB_SECRET` (signing) goes in Vercel.

**Where it goes:** in the app (Configurer): `BACKUP_DRIVE_FOLDER_ID`, `BACKUP_RETENTION_DAYS`, `BACKUP_JOB_TOKEN`;
Vercel: `CRON_SECRET` (Phase 2), `BACKUP_JOB_SECRET` (advanced).

**Check:** Réglages › Diagnostic › **Sauvegardes** (Backups): "Valemont OS backup <today's date>" present and
**vérifiée** (verified); « Vérifier » (Verify) button to compare with the current database.

**Common problems:** `storageQuotaExceeded` = personal account without a shared drive → Apps Script solution; red
on test = folder not shared with the service account.

### 2.18 Final checks (Phase 10)

1. Réglages › Intégrations: click **Tester la connexion** on every configured row → **Connecté**.
2. Réglages › Diagnostic: health « prête », backup verified.
3. Go through the "Stage 4 gate: live validation" checklist in `docs/ACCEPTANCE.md` together (both sign-ins,
   a call seen by the other founder in under a minute, edit conflict, `+33…` intact in the Sheet, calendar, files,
   LinkedIn imports, backup, restore, `/api/health`, security headers).
4. Record the dated result in `docs/STATUS.md`. An integration is only **VERIFIED_LIVE** after this real test.

---

## 3. All the variables

Two places:
- **Vercel (base)**: **Vercel › Settings › Environment Variables** (Production, *Sensitive* for secrets), then
  **Redeploy**. These are the settings the app needs before it can open the Sheet; Réglages › Intégrations shows them
  read-only.
- **In the app (Configurer)**: **Réglages › Intégrations › Configurer**; applied immediately, no redeploy. A variable
  with the same name in Vercel is still possible and **takes priority**.

"You" = a value you generate yourselves (§2.1); "Générer" = the form's Generate button.

| Variable | Where it goes | Required? | Where to find it | Integration |
|---|---|---|---|---|
| `APP_MODE` | Vercel (base) | Required (`live`) | You | Core |
| `SESSION_SECRET` | Vercel (base) | Required | You (32+ chars, `/setup` › Generate a secret) | Core |
| `CONNECTORS_ENCRYPTION_KEY` | Vercel (base) | Strongly recommended | `/setup` › Generate a secret | Encryption of in-app keys |
| `CONNECTORS_ENCRYPTION_KEY_PREVIOUS` | Vercel (base) | Only while changing the key | The old key | Encryption of in-app keys |
| `APP_BASE_URL` | Vercel (base) | Optional on Vercel (automatic), required elsewhere | Your domain, `https://…` with no trailing `/` | Core, Sign-In, webhooks |
| `SYNC_POLL_SECONDS` | Vercel (base) | Optional (30) | 30 to 60 | Core |
| `LOG_LEVEL` | Vercel (base) | Optional (`info`) | `debug` / `info` / `warn` / `error` / `silent` | Logs |
| `FOUNDER_THEO_EMAIL`, `FOUNDER_PABLO_EMAIL` | Vercel (base) | Required | Your Google addresses | Sign-In |
| `EMAIL_SENDER_ADDRESS` | Vercel (base) or Settings › Workspace | Recommended | The client-email sending address (a Google mailbox) | Gmail |
| `FOUNDER_THEO_TIMEZONE`, `FOUNDER_PABLO_TIMEZONE` | Vercel (base) | Optional (default `Europe/Paris`, `Europe/Madrid`) | `Europe/Paris`, `Europe/Madrid` | Core |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Vercel (base) | Required | Google Auth Platform › Clients | Sign-In, Drive, Gmail |
| `SHEETS_SPREADSHEET_ID` | Vercel (base) | Required | Sheet URL | Google Sheets |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | Vercel (base) | Required | Service account JSON key, pasted as-is (or in base64) | Sheets, Drive, Calendar, backups |
| `PRIVATE_SHEET_ID_THEO`, `PRIVATE_SHEET_ID_PABLO` | Vercel (base) | Optional | URL of each founder's private Sheet | Google Sheets (private) |
| `CRON_SECRET` | Vercel (base) | Recommended on Vercel | `/setup` › Generate a secret (24+ chars) | Backups + snapshot |
| `WISE_API_TOKEN` | In the app (Configurer) | Required for Wise | Wise › Settings › API tokens (Read only) | Wise |
| `WISE_PROFILE_ID` | In the app (Configurer) | Optional (found automatically) | BUSINESS profile | Wise |
| `WISE_WEBHOOK_PUBLIC_KEY_BASE64` | In the app (Configurer) | Optional | Wise webhooks production public key, pasted whole | Wise |
| `WISE_SCA_PRIVATE_KEY_BASE64` | In the app (Configurer) | Optional (advanced) | Your private RSA key (public part uploaded to Wise), pasted whole | Wise |
| `STRIPE_API_KEY` | In the app (Configurer) | Required for Stripe | Stripe › Developers › API keys › restricted key `rk_live_…` | Stripe |
| `STRIPE_WEBHOOK_SECRET` | In the app (Configurer) | Optional (recommended) | Stripe › Webhooks › destination › secret `whsec_…` | Stripe |
| `WEBSITE_WEBHOOK_SECRET` | In the app (Configurer) | Required for forms | Générer, then also on the website side | Website forms |
| `INBOX_WEBHOOK_SECRET` | In the app (Configurer) | Required for the relay | Générer, then also in Make/Zapier/n8n | Messages to handle |
| `META_APP_SECRET` | In the app (Configurer) | Optional | Meta app › Settings › Basic | Messages (Instagram) |
| `META_VERIFY_TOKEN` | In the app (Configurer) | Optional | Générer, then also in the Meta Webhooks config | Messages (Instagram) |
| `INSTAGRAM_ACCESS_TOKEN` | In the app (Configurer) | Required for 1 account | Meta system user (or Instagram Login) | Instagram |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | In the app (Configurer) | Required for 1 account | Graph API Explorer | Instagram |
| `INSTAGRAM_ACCOUNT_KEY` | In the app (Configurer) | Optional | `ig-valemont` (default) or `ig-thirty` | Instagram |
| `INSTAGRAM_TOKEN_EXPIRES_AT` | In the app (Configurer) | Optional | Expiry date of a 60-day token | Instagram |
| `INSTAGRAM_ACCOUNTS_JSON` | Vercel (advanced) | Optional (instead of the 4 above) | You (JSON list, see `.env.example`) | Instagram |
| `INSTAGRAM_API_BASE_URL` | Vercel (advanced) | Optional | Only `https://graph.instagram.com/v21.0` with Instagram Login | Instagram |
| `SNAPSHOT_JOB_TOKEN`, `SNAPSHOT_JOB_SECRET` | In the app (Configurer) | Optional | Générer (if a scheduler other than Vercel) | Snapshot job |
| `TRACKER_WEBHOOK_URL_THEO` / `_PABLO` | In the app (Configurer, each your own) | Optional | Your tracking app (https) | My tracker |
| `TRACKER_WEBHOOK_SECRET_THEO` / `_PABLO` | In the app (Configurer, each your own) | Required with the address | Générer | My tracker |
| `TRACKER_FEED_TOKEN_THEO` / `_PABLO` | In the app (Configurer, each your own) | Optional | Générer | My tracker |
| `TRACKER_DAILY_SUMMARY_THEO` / `_PABLO` | Vercel (advanced) | Optional | `1` to enable | My tracker |
| `BACKUP_DRIVE_FOLDER_ID` | In the app (Configurer) | Optional (recommended) | Address of the backup folder / shared drive | Backups |
| `BACKUP_RETENTION_DAYS` | In the app (Configurer) | Optional (30) | 1 to 365 | Backups |
| `BACKUP_JOB_TOKEN` | In the app (Configurer) | Optional | Générer (if a scheduler other than Vercel) | Backups |
| `BACKUP_JOB_SECRET` | Vercel (advanced) | Optional | You (if a scheduler that signs) | Backups |
| `SHEETS_API_BASE_URL`, `GOOGLE_API_BASE_URL`, `WISE_API_BASE_URL`, `STRIPE_API_BASE_URL`, `DEMO_BACKEND`, `FAKE_SHEETS_URL`, `FAKE_SHEETS_SPREADSHEET_ID`, `DEMO_ACCESS_CODE` | **Never in production** | — | Tests and demo only | — |

On the website side (not in Valemont OS): `WEBSITE_WEBHOOK_SECRET` (same value) and `VALEMONT_WEBHOOK_URL`.
Calendar IDs and the Drive folder ID are entered **in the application** (Réglages › Calendriers,
Réglages › Espace de travail), not as variables.

---

## 4. Security reminders

- **Keys pasted in the application are encrypted** (AES-256-GCM) before they are saved: the Sheet holds only
  unreadable text (`IntegrationSecrets` tab), and the encryption key (`CONNECTORS_ENCRYPTION_KEY`) stays in Vercel,
  never in the Sheet. Non-secret identifiers (Wise profile, Instagram account, backup folder) are saved in plain text
  in the settings.
- **A saved key is never shown again**: only « Configuré · se termine par 1234 » (Set · ends with 1234), who saved
  it and when. To change it, paste a new value or click **Générer** again; **Supprimer** (Delete) erases it. A
  generated secret is shown only once: copy it straight away into the other service.
- **Only Théo and Pablo can change the keys** (signed in with their founder Google account). Every change is written
  to the audit log (the field name only, never the value). Tracker values belong to each founder.
- **Base settings live only in Vercel** (ticked *Sensitive*) and in your password manager. No secret in a chat, an
  email, directly in the Sheet, a ticket, a screenshot or the code. Logs mask keys, emails and phone numbers.
- **Least privilege everywhere:** service account with no role (only the shares it needs), Drive folder as
  Viewer, personal calendars as "free/busy only", Wise **read-only**, Stripe **restricted Read
  key**, Instagram statistics/read, Gmail **send only**, Drive as `drive.file` (only the
  files created by the app).
- **What the application never does:**
  - send an email, a WhatsApp, an Instagram or LinkedIn reply without **your click**;
  - read your Gmail inbox;
  - move money, pay, refund (Wise and Stripe are read-only);
  - contact an unsubscribed contact (blocked on the server, for both of you);
  - show one founder the other's private data (private tasks, personal calendar details);
  - use the demo instead of the real data: without the base settings, LIVE mode shows a configuration error (in the
    demo, nothing you paste is really saved).
- **Rotation:**
  - leak or doubt about a service key → regenerate it at the provider, then **Configurer** › paste the new value ›
    **Enregistrer et tester** (no redeploy); for a secret we create, **Générer** again and copy it into the other
    service again;
  - Google key → new key, Vercel variable, Redeploy, **then** delete the old one;
  - changing `SESSION_SECRET` = everyone is signed out (this is how you revoke a stolen session). Without
    `CONNECTORS_ENCRYPTION_KEY`, the keys saved in the app also become unreadable ("unreadable, paste it again"):
    that's why this key is set in Phase 2;
  - changing `CONNECTORS_ENCRYPTION_KEY`: set the new value, the old one in `CONNECTORS_ENCRYPTION_KEY_PREVIOUS`,
    Redeploy, then Réglages › Intégrations › « Rechiffrer avec la nouvelle clé » (Re-encrypt with the new key); only
    then remove the old one (details: `docs/SECURITY.md` §12b);
  - 60-day Instagram token: the application creates a task 14 days before expiry;
  - a contractor leaves or you change computer: redo the tokens they may have seen.
- **One owner per resource, and it's Valemont:** Google accounts, Meta portfolio, Vercel account, Wise,
  Stripe. Turn on two-factor authentication everywhere.
- **Backups:** the downloadable JSON copy contains personal data, keep it somewhere private.
  A restore always goes into a **new** Sheet, never on top of production.

## Delays to plan for (summary)

| What | Delay | Meanwhile |
|---|---|---|
| Google verification for `gmail.send` (External app in production) | several days to a few weeks | Internal app (Workspace), or Testing mode with your two addresses, or pre-filled Gmail draft |
| Meta App Review (Instagram comments/messages) | a few days to a few weeks | Make "Watch comments" relay to Messages à traiter |
| LinkedIn Community Management API | long, not guaranteed | .xls/.xlsx exports imported every week |
| Vercel domain certificate | a few minutes to a few hours (DNS) | `*.vercel.app` address for testing (remember to add the new Google URIs afterwards) |
