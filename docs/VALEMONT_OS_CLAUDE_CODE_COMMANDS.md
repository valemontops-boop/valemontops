# Valemont OS: commands to run with Claude Code

Save `VALEMONT_OS_CLAUDE_CODE_MASTER_PROMPT.md` in your project at `docs/VALEMONT_OS_CLAUDE_CODE_MASTER_PROMPT.md`, and unzip the design references into `docs/design-inspiration/`. Run Claude Code from the project root. Start a fresh session (`/clear`) between stages: the status files carry the context.

## Message 1: Stage 1A, first usable version

```
Read docs/VALEMONT_OS_CLAUDE_CODE_MASTER_PROMPT.md completely. It is the binding product specification. Inspect this repo before changing anything.

Create CLAUDE.md, docs/PLAN.md, docs/STATUS.md and docs/DECISIONS.md as section 1 describes, and docs/DESIGN.md from section 8 after viewing docs/design-inspiration/. This Claude account only builds the app: do not use any connector or tool of this session on real Valemont resources (section 3, item 15). Then implement Stage 1A end to end with Google Sheets as the ONLY durable business datastore, following section 4 exactly.

Do not stop at a plan, do not build a static prototype, do not introduce Supabase/Firebase/Postgres, and do not claim the Sheet is connected when credentials are missing. Use the explicitly labelled DEMO mode and the fake Sheets server until I add credentials.

Do not wait for me to approve routine edits. Run lint, typecheck and tests, read the output, then report completed versus blocked functionality with the exact commands I need to connect my real Sheet.
```

## Message 2: Stage 1B, once 1A works and you have logged real activity

```
Read docs/VALEMONT_OS_CLAUDE_CODE_MASTER_PROMPT.md, CLAUDE.md, docs/STATUS.md and docs/DECISIONS.md. Audit the current implementation against section 9, Stage 1A, and fix any gap first.

Then build Stage 1B: tasks, scoring and streaks, sprints, Command Center on real data with the limits of section 8.2, Next Best Action, weekly review, reports, notifications, the conflict UI, Agenda and Founder Points through shared calendars, Idea Box, Files, and Audience tracking with manual entry and LinkedIn import. Run the Stage 1B gate scenarios and report real results.
```

## Message 3: Stage 2

```
Read the specification, CLAUDE.md and docs/STATUS.md, audit Stage 1, then build Stage 2: audit templates by sector, price book, real PDF quote builder with commercial policy, opportunity-to-project workflow with recovery, supplier bench, rates, capacity, delivery tracking, and Local subscription usage with per-client margin.

Keep Google Sheets as the sole durable database. Automated tests must include a quote for EUR 490 setup + EUR 99/month and verify MRR excludes the setup amount. Deliver working UI and state, not placeholders.
```

## Message 4: Stage 3

```
Read the specification, CLAUDE.md and docs/STATUS.md, audit Stage 2, then build Stage 3: managerial finance and P&L, EUR/USD, expense and payment journal, recurring contracts, revenue schedules, MRR/ARR with movements, EBITDA estimate with earned-versus-cash distinctions, ECB rates, brand cost centers, Ad Fund, FR/ES content planning with weekly targets, the Instagram adapter, the signed snapshot job and post-level checkpoints.

Run scenarios 8, 9, 10 and 22 with their exact expected figures. A currency toggle must never alter stored values.
```

## Message 5: Stage 4

```
Read the specification, CLAUDE.md and docs/STATUS.md, audit Stage 3, then build Stage 4: Integration Hub, authenticated website webhooks, optional Calendar/Gmail/Meta connectors, CSV import/export, backups with a tested restore, security hardening with a threat model, observability, deployment scripts, integration tests and the PostgreSQL migration plan.

For each provider lacking approval or API access, show an honest Manual or Unavailable status. Validate both founder logins and live cross-session sync if credentials exist; otherwise report NOT RUN. Give exact production deployment steps and the list of credentials I must set up.
```

## What you must prepare (never paste secrets into a chat)

1. A private Google Sheet **that you create yourself**, titled `Valemont OS — Production Data`. A service account usually cannot create it.
2. One additional private Google Sheet per founder for job-search data, owned by that founder.
3. A Google Cloud project with the Google Sheets API enabled.
4. A service account. Share the three Sheets with its email, with Editor access.
5. Google OAuth for the two founders' sign-in, with redirect URLs for local and production. Put the two real addresses in environment variables, not in source code.
6. Real company name and details, logos, legal jurisdiction and VAT status, opening cash balances, and credentials only for integrations you decide to activate.
7. A host with secure environment variables, whose terms allow commercial use.
8. A review of `ChannelRules` by someone qualified, before relying on cold email or cold calling in Spain in particular.
9. **Use Valemont accounts for everything below, not the Claude account that builds the app.**
10. Google Calendar: create a shared `Valemont` calendar. Share it with each other and with the service account ("Make changes to events"). Each founder shares their own calendar with the service account ("See only free/busy").
11. Google Drive: create a `Valemont OS` folder, share it with the service account as Viewer. Enable the Drive and Calendar APIs in the Google Cloud project, and the Google Picker API.
12. Instagram: each account must be Professional (Business or Creator), linked to a Facebook Page, in a Meta Business portfolio. Create a Meta app, then a System User token.
13. LinkedIn: export statistics from Page analytics and from creator analytics. For API access later, apply for the Community Management API with a new developer app, a verified Company Page, a registered company and a business email. Allow several weeks.
14. A scheduler for the 6-hourly snapshot: a Google Apps Script trigger is free.

## Acceptance gate before using live data

- Both founders can log in and have distinct personal dashboards.
- A call or task update by either founder persists in Sheets, survives refresh and appears to the other founder after sync.
- The same action cannot be counted twice after a retry.
- Today's quotas, Passed/Missed/Off, streaks and weekly content deliverables calculate correctly.
- An opted-out contact cannot be worked by either founder.
- A founder point created in the app appears in both Google Calendars, and a founder's personal event shows only as "Busy" to the other.
- Instagram and LinkedIn figures build up over time with their source shown, and gaps stay visible.
- No screen feels crowded: the limits in section 8.2 are respected.
- A CRM opportunity can become an audit, approved quote/PDF, won client and delivery project.
- EUR/USD display does not alter stored amounts.
- Management finance distinguishes cash received, income earned, receivables, MRR, ARR and EBITDA.
- LIVE mode shows a clear error when Google credentials are missing. DEMO mode never pretends to be live.
