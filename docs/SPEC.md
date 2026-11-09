# VALEMONT OS: PRODUCT SPECIFICATION (v3)

Product and engineering specification for Valemont OS: a functional, deployable internal operating system for a two-founder consulting firm (a working application, not a slide deck, static mockup or architecture proposal).

Requirement words: MUST and NEVER are binding. "Seed" means an editable starting value stored in Google Sheets, never a hardcoded rule. When two parts of this document appear to conflict, the more specific section wins, and the resolution is logged in `docs/DECISIONS.md`.

The original version of this specification required an English UI, with outreach scripts and client-facing content templates in FR and ES as content. This is superseded by D048 in `docs/DECISIONS.md`: the UI is in French for Théo and Spanish for Pablo. Clients are served in France and Spain.

---

## 0. PRODUCT GOAL AND DEFINITION OF DONE

**Product goal:** the founders spend their time calling, sending legitimate DMs and InMails, visiting businesses, following up, posting content, holding meetings, proposing and delivering. Everything else (tracking, task generation, reporting, proposals, cost projections, reminders) is as frictionless as possible. A feature that adds data entry without helping one of those actions or a decision is simplified.

**A feature is done only when:** (1) it is reachable from the real UI; (2) its state persists through the `DataRepository`; (3) server authorization and Zod validation exist; (4) loading, empty, error and retry states exist; (5) automated tests cover its business rule; (6) lint, typecheck and tests pass; (7) `docs/STATUS.md` records it accurately.

**Status vocabulary for every feature:** `VERIFIED_LIVE` (passed against a real Google Sheet), `VERIFIED_FAKE` (passed against the fake Sheets server only), `PARTIAL`, `NOT_STARTED`, `BLOCKED: <reason>`. Without Google credentials, nothing may be labelled `VERIFIED_LIVE`.

**Nothing inert.** A module from a later stage is hidden from navigation until it works; Settings > Roadmap lists what is planned. No button without behavior. No placeholder numbers.

**Not oversaturated.** Every element on a screen supports a decision or an action, otherwise it moves behind a tab or a drill-down. Section 8.2 sets hard limits.

---

## 1. ENGINEERING PROCESS

1. **Existing work is preserved.** Changes start from an audit of the repository and its dependencies; existing work is not overwritten unnecessarily.
2. **Current facts.** Framework and API behavior (Next.js, the auth library, googleapis, shadcn/ui) is checked against the installed package docs or official docs. Current stable versions are used.
3. **Compact plan.** Each stage has a short execution plan and file tree in `docs/PLAN.md` (one screen).
4. **Durable project state in files.** `docs/STATUS.md` (feature checklist with the status vocabulary), `docs/DECISIONS.md` (one line per decision: what, why, how to reverse) and `CLAUDE.md` (under 60 lines: non-negotiables from sections 3 and 4, commands, where things live) are maintained. Work MUST be resumable from these three files alone.
5. **Test-first for business rules.** Scoring, streaks, idempotency, MRR, EBITDA, FX, quote totals, permissions and sanitization are pure functions with no I/O, written red-green-refactor.
6. **Evidence before claims.** A feature is reported as working only after the command that proves it has run and its full output and exit code have been read.
7. **Stage gate.** Lint, typecheck, unit, integration and smoke tests run after each stage; failures are fixed and `docs/STATUS.md` is updated. The stage diff is reviewed for security and dead code before the next stage.
8. **Bug handling.** Root cause before code change. No retry-until-green. No deleted or skipped test without a line in `docs/DECISIONS.md`.
9. **Parallel work.** Only independent, file-disjoint work (for example separate documentation files or an independent review of a finished stage) is parallelized. Shared schemas and the repository adapter are built first.
10. **Decision policy.** Routine choices take the most reasonable option and are logged. Irreversible choices, real credentials and legal facts require a founder. An item that is blocked is recorded as `BLOCKED` and does not stop other work.
11. **Commits.** One logical commit per completed slice, with green checks. Secrets, `.env*` (except `.env.example`), real personal data and real founder email addresses are never committed.
12. **No real data in code or fixtures.** Real emails, phones and company identifiers live only in environment variables or the live Sheet. Fixtures use synthetic names and reserved domains such as `example.com`.

---
## 2. BUSINESS AND OPERATING CONTEXT

Valemont Partners is a boutique, founder-led B2B business/AI consulting and implementation studio serving French and Spanish SMEs. It diagnoses operational needs, selects the right approach, implements working solutions itself when appropriate and uses vetted subcontractors if needed. Valemont owns the commercial relationship and coordinates delivery. It MUST NEVER falsely describe contractors as employees or claim third-party technology is proprietary.

### 2.1 Activities (cost centers and brands)

- **Valemont Consulting:** consulting, audits, implementation and ongoing services. Higher ticket, custom scope. Current channel: LinkedIn outreach.
- **Valemont Local:** a standardized "customer loop" subscription for local businesses: capture a request, qualify it, notify the owner, follow up, and ask for feedback after the service. It is sold as a request-handling and follow-up system, not as "a website with a chatbot". Its purpose is cash flow.
- **30/30 AI:** a distinct paid digital product, EUR 39 illustrative one-time shortlist matching businesses with relevant AI solutions. It is an acquisition channel and a product, separate from Valemont delivery. A qualified 30/30 buyer can optionally pursue Valemont implementation with lawful consent. Its one-off purchases MUST NOT count as MRR.

### 2.2 Scope boundary

Valemont OS is the founders' internal cockpit. It does NOT build the Valemont Local customer product, the Local mini-CRM, chatbots, or the agent showroom. Those are separate codebases. Valemont OS only tracks them: subscriptions, usage, demos shown, costs, and links to demo assets in `Resources`.

### 2.3 Founders

- **Théo (France, Europe/Paris):** French market sales, engineering/product/demos, Google Flow/Claude creative production, French brand content, project delivery.
- **Pablo (Spain, Europe/Madrid):** Spanish market sales, commercial meetings, Spanish localization/content, partners and supplier coordination, project delivery.

Both founders have their own home screen, tasks, accountability/streaks, availability and personal working-mode settings. Both see company-wide commercial and financial data. Personal job-search data is private to its owner (see 4.7).

No public link between Théo's personal LinkedIn publication and Valemont may be suggested. Personal posts cannot promote or hint at Valemont, and the app MUST NOT generate tasks, templates or CTAs that do. Official Valemont and 30/30 pages may promote their respective brands.

### 2.4 Go-to-market working assumptions (seeds, all editable)

| Assumption | Seed |
|---|---|
| Priority order | 1. Local cash flow, 2. Valemont Consulting in parallel, 3. 30/30 AI tested progressively |
| Sales effort split, first 14 days | 70% Local, 20% Consulting, 10% 30/30 |
| First niches for Local | Building trades (plumbers, heating, roofers, electricians, HVAC) and independent garages, in FR and ES |
| Lower-priority niches | Kitchen/joinery/renovation, real estate agencies, caterers and event venues, private schools and training bodies, movers, equipment rental, holiday-rental concierges, independent hotels, local B2B distributors |
| Deprioritized for Local | Barbers/salons (Planity) and doctors (Doctolib): the "we build your site" pitch is weak there, and health data raises the privacy bar |
| Prospecting channels for Local | In-person visits, cold calls, LinkedIn |
| 14-day sprint target, per founder (proposed) | 50 businesses contacted, 10 qualified replies, 3 demos, 1 pilot client |
| Ads gate | No paid ads until the funnel is validated; budgets discussed: EUR 1,500 test, EUR 3,000 full |

These are working targets, not forecasts. The app labels them as targets.

### 2.5 Price book seeds

All entries are `pilot_assumption = true`, configurable and versioned by effective date. They are not validated market prices or computed margins. Ranges store min and max, and the quote requires a chosen price.

| Item | One-time EUR ex VAT | Monthly EUR ex VAT | Notes |
|---|---:|---:|---|
| Valemont Local Essential | 490 | 99 | Limits below |
| Add-on: WhatsApp AI connected | 190 | 59 | Meta and usage costs billed separately, capped |
| Add-on: Email customer reactivation | 99 | 39 | Consent rules apply |
| Add-on: AI phone receptionist | 290 | 99 | Minutes billed separately, capped |
| Add-on: Higher volume | 0 | 29 to 59 | |
| Add-on: Second location | quote | 49 | |
| Add-on: CRM or business software integration | quote | quote | |
| Add-on: Ads management (Google or ChatGPT Ads) | 249 | 149 to 249 | Ad spend excluded, paid directly by the client |
| Connected assistant tier | 700 to 1,500 | 149 to 299 | |
| Valemont standalone ChatGPT Ads management | quote | 250 to 500 | Ad spend excluded |
| 30/30 AI report | 39 | 0 | One-time, distinct product |
| Consulting discovery, implementation modules, custom hours, contractor costs, AI usage allowance, ongoing maintenance | founder-entered | founder-entered | No seeded price |

**Local Essential plan limits (seeds):** 200 AI conversations, 100 qualified requests and 200 automated transactional or relationship emails per month, 1 location, 30 minutes of standard support per month. No unlimited usage, promotional sends or complex integrations included.

**Local cost provision per client per month (seeds):** hosting and domain share EUR 3, AI tokens EUR 2, email/storage/notifications EUR 3, payment fees EUR 4, monitoring and tools share EUR 5, support 30 min valued at EUR 40/h = EUR 20. Total EUR 37. Labelled as provisions, not actuals.

---

## 3. ABSOLUTE TECHNICAL REQUIREMENTS

1. **Google Sheets is the sole persistent business database for V1.** Do not replace it with Supabase, Firebase, PostgreSQL, SQLite, Airtable or localStorage as source of truth. Browser memory is for ephemeral UI state only. Local test fixtures are permitted, clearly separated from live data. Short-lived server caches are allowed as derived data, never as source of truth.
2. **All durable create/update/delete operations persist in the real Sheet.** A refresh or the other founder's session sees the data. The interface says "Saved", "Syncing" or "Error: retry", only after server confirmation. Never fake a successful sync.
3. **Storage abstraction.** All business services use a `DataRepository` interface with a `GoogleSheetsRepository` adapter and an `InMemoryRepository` for DEMO and tests. Later migration to PostgreSQL replaces the adapter without rewriting pages or business rules. One shared contract test suite runs against every adapter.
4. **Stack (decided, unless the repository already has a compelling production stack):** Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui, React Hook Form + Zod, TanStack Query, Recharts via shadcn charts, `@react-pdf/renderer` for PDFs (no headless browser), Vitest, Playwright.
5. **Server-only Sheets access** via the official API and a Google service account, with the Sheet explicitly shared to it. Credentials stay in environment variables, never reach the browser and are never saved in Sheets. Provide `.env.example`, a secure setup guide and connectivity diagnostics. Accept the service-account key as base64 to avoid newline issues on hosts.
6. **Authentication:** Google sign-in, stateless encrypted server-side session (no auth database), allowlist of exactly the two founder addresses from `FOUNDER_THEO_EMAIL` and `FOUNDER_PABLO_EMAIL`. Founder/Admin RBAC. Sign-in requests only `openid email profile`; any further Google permission is requested incrementally, at the moment of use, and only where section 7 allows it. Server-side authorization on every route and mutation. Support future team roles in the types, but create no working fictitious employee accounts. Any test-auth bypass exists only when `NODE_ENV=test`, and a production build or boot MUST fail if it is enabled.
7. **Near-real-time, honestly.** Invalidate after writes, refetch on window focus, poll at a configurable 30 to 60 second interval, manual refresh. Show sync timestamp and conflict/error warnings. Bounded retries with exponential backoff and jitter on 429/5xx, for idempotent operations only. Timeouts on every remote call. Batch reads and writes. No per-widget workbook reads.
8. **Records.** UUID primary keys, ISO 8601 timestamps, explicit time zone per founder, `created_at`, `updated_at`, `updated_by`, `version`, `is_archived`. No row-number identity. NEVER invent legal sequential invoice numbering.
9. **Security.** No exposed spreadsheet, public access or unauthenticated webhook. Validate every server request, escape HTML, enforce file size and input limits, log mutations to an append-only audit trail. Minimize personal data, allow deletion and export, document GDPR responsibilities. Logs contain no personal data or secrets. Rate-limit webhooks.
10. **Two clearly separated modes:** LIVE (real Sheets credentials) and DEMO (labelled synthetic fixture data, permanent visible banner). DEMO must never silently appear live and must never touch live data. If `APP_MODE=live` and credentials are missing, show a setup error and setup wizard; never fall back to DEMO automatically.
11. **Interface:** responsive desktop/tablet/mobile, premium enterprise feel, fast keyboard-driven entry (section 8).
12. **Currency.** Main display EUR with an instant EUR/USD VIEW toggle. Store each transaction's original currency and amount and never rewrite originals. Use ECB reference rates cached daily with an attributed FX timestamp, a documented manual fallback, and a locked rate on historical entries. Show native and converted amounts in detail views. No invented exchange rates. Money is stored as integer minor units plus an ISO currency code; never use binary floats for money.
13. **Free/low-cost.** No needless paid APIs, subscriptions, SMS, voice minutes, LLM calls or background jobs. AI recommendations are optional and require explicit model configuration; deterministic templates work with no API key. No scheduled job is required for correctness (see 4.6), with one documented exception: audience snapshots (see 4.11).
14. **Hosting.** Node-compatible and host-agnostic. Before recommending a host, check its current terms: Vercel's Hobby tier has been limited to non-commercial use, so document a compliant option and its cost.
15. **Build identity is not runtime identity.** The accounts and tools used to develop the code have no role in the running product. Valemont OS is a standalone deployed web application; a development tool's preview cannot hold its server secrets and is not a delivery target. Development accounts, connectors and tools are NEVER used to read, create or configure Valemont's real resources. A developer's address is NEVER used as a default, fixture, sender, owner or contact. Every Google, Meta, LinkedIn and hosting identity is supplied by the founders at setup through environment variables or the Integrations page. A founder's sign-in address, calendar owner, Drive owner and social-account admin may all differ, so they are configured separately.

---

## 4. GOOGLE SHEETS ENGINEERING CONTRACT

Sheets has no transactions, no unique constraints and no locks. These decisions resolve that; implement them, and document residual limits in `docs/ARCHITECTURE.md`.

### 4.1 Quota budget

The Sheets API default is 300 requests per minute per project and 60 per minute per user per project, for reads and for writes. A batch counts as one request. The service account is a single user, so **both founders share the 60 per minute**. Design for at most 30 sustained reads per minute.

- Polling does NOT reread data. It reads one small range holding per-domain revision tokens, cached server-side for about 10 seconds so concurrent clients collapse into one call.
- Each mutation writes a new random token for its domain (a UUID, not a counter, so concurrent writes cannot lose an increment).
- Tabs are refetched by domain with `values.batchGet` only when their token changed, plus a TTL of a few minutes to catch manual edits.
- Payloads stay under about 2 MB. Reads are bounded by column range. Show a quota panel in diagnostics.

### 4.2 Exactly-once counting by derivation

"A single idempotent event, never double-counted when retried" is achieved without a lock:

- The client generates `idempotency_key` when the form opens and reuses it for every retry.
- The server appends one row to `ActivityEvents`. Appends are the only write needed to commit an activity.
- Lead history, tallies, scores and dashboards are **derived from events by pure functions**. Readers deduplicate by `idempotency_key` (earliest `created_at` wins, then lowest `id`). A duplicate row from a race therefore cannot change any number.
- The server also checks the recent tail to avoid obvious duplicates. `doctor:sheets` reports duplicate rows.
- Denormalized fields such as `last_activity_at` are repairable caches, not truth.

### 4.3 Mutable rows and conflicts

- Mutations send `expected_version`. The server re-reads the target row **bypassing cache**, resolves its row by scanning the fresh `id` column, compares version, writes with `version + 1` and a `write_id`, then re-reads to confirm its `write_id` survived. A mismatch returns a conflict shown to the user with both values.
- Row number is resolved at write time only. Humans sorting a tab cannot corrupt writes.
- Residual race window is documented. Prefer append-only events wherever a value can be derived.
- V1 needs no shared counter: references derive from UUIDs. If a workflow later requires one, add a signed Google Apps Script LockService write gateway rather than a read-then-increment from the app.

### 4.4 Multi-tab workflows

Workflows touching several tabs (Won to Client + Project, quote approval) use a `WorkflowRuns` tab with step status and **deterministic child IDs** (UUIDv5 from workflow id + step name). Retrying a partial run is a no-op for finished steps. Partial runs are visible and resumable in the UI. Never claim ACID transactions.

### 4.5 Value handling and injection

- Write with `valueInputOption=RAW` so user strings are never parsed as formulas. Read with `UNFORMATTED_VALUE`.
- Format columns as plain text where needed.
- **Do NOT prefix or strip leading `+`, `-`, `=` or `@` in stored data:** that corrupts phone numbers such as `+33612345678` and negative amounts.
- CSV/XLSX **exports** apply formula-injection escaping to free-text columns, and leave typed columns (phone, amount) intact and quoted. CSV **imports** treat every cell as untrusted text validated by Zod.
- Apply a size limit per cell. Google Sheets holds at most 50,000 characters per cell.

### 4.6 Time-based logic without cron

Day closure, streaks, overdue status and expiry are computed lazily from events and the founder's time zone on read. `DailyResults` is a materialized, idempotent snapshot written on first read after cutoff, and can always be recomputed. FX refresh happens lazily on the first read of a day. ECB publishes on TARGET business days only, so weekends and holidays use the last published rate with its real date shown.

### 4.7 Private data

A founder with access to the shared Sheet can read every tab, so a "private" tab in that file is not private. Job applications and private tasks live in a **separate spreadsheet per founder** (`PRIVATE_SHEET_ID_THEO`, `PRIVATE_SHEET_ID_PABLO`), owned by that founder and shared only with the service account. Private data is never in shared caches, team metrics, exports or the audit log's readable payloads.

### 4.8 Google Drive and service accounts

Service accounts have no Drive storage quota on personal accounts, and new ones commonly fail when creating files with `storageQuotaExceeded`. Therefore:

- `setup:sheets` NEVER creates the spreadsheet. A founder creates it and shares it with the service account; the script configures tabs.
- **Read path (default):** a founder creates a `Valemont OS` Drive folder and shares it with the service account as Viewer. The app lists and searches that folder server-side, so the founders' files appear without any per-user token.
- **Write path:** anything the app creates or uploads uses the signed-in founder's own Google identity with the non-sensitive `drive.file` scope, requested incrementally, so the founder owns the file and it uses their quota. Attaching an existing file uses the Google Picker.
- If the founders later have Google Workspace with Shared Drives, the adapter may write through the service account instead. Do not assume this.
- `FilesIndex` stores file id, name, MIME type, URL and linked record. Binaries never go in Sheets.

### 4.9 Protecting the Sheet

Founders use the app, not the tabs. `setup:sheets` applies warning-only protection on every tab, freezes the header, trims empty grid rows and columns, and stores a schema hash. `doctor:sheets` detects moved columns, edited headers, malformed rows, duplicate IDs, orphans and missing references. A manual edit that breaks a row surfaces as a data-integrity warning, never as a crash.

### 4.10 Scale

Track row counts and cell use against the 10-million-cell workbook limit. Archive `ActivityEvents` by month into dated tabs (or safe CSV export) before operational limits, and keep read paths aware of the archive.

### 4.11 Audience snapshots (the one scheduled job)

Provider APIs return current values or limited windows, so the evolution of views and followers cannot be rebuilt later. It must be captured as it happens.

- One signed endpoint, `POST /api/jobs/snapshot` (HMAC, timestamp tolerance), idempotent per account and capture slot.
- Triggered every 6 hours by whichever free or included scheduler fits the host: a Google Apps Script time-driven trigger owned by a founder, GitHub Actions, or host cron. Do not rely on a daily-only cron, because Instagram Story insights are served by the API for only 24 hours.
- A missed run leaves a visible gap. Charts NEVER interpolate. The Integrations page shows last success, and a failure raises a notification.

### 4.12 Credentials that expire

There is no database and tokens never go in Sheets, so the design avoids rotating secrets:

- Prefer non-expiring credentials held in environment variables: a Meta System User token, and the service account for Google.
- Tokens with a 60-day life (Instagram Login, LinkedIn) live in environment variables with a companion `*_EXPIRES_AT`. The app shows the remaining days and creates a task 14 days before expiry. `docs/INTEGRATIONS.md` gives the rotation steps.
- Per-founder Google tokens live in an encrypted httpOnly cookie, never server-side in plain form. Losing one means asking for consent again, never data loss.

### 4.13 Google Calendar as an external source of truth

Scheduling lives in Google Calendar. Sheets stores only the link between an event and a record (`CalendarLinks`: calendar id, event id, record type, record id), never copies of attendee lists or personal event titles. Events the app creates use a client-supplied ID derived from the workflow or record UUID (UUIDv5 encoded in base32hex), so a retry cannot create a duplicate. A change made directly in Google Calendar wins after the next sync.

---

## 5. PRODUCT MODULES

**Navigation.** Always visible: Command Center, My Day, Sales CRM, Marketing, Clients & Projects, Finance. Collapsible Workspace group: Agenda, Ideas, Files, Audits & Quotes, Partners & Resources, Reports. Bottom block with the profile (showing current work mode): Integrations, Settings. Badges appear only for counts that need action.

**Header:** quick global search, sync state, + Quick Action. Founder/team scope, date range (Today, This Week, MTD, QTD, YTD, custom) and EUR/USD appear in the page toolbar, only on pages where they change what is displayed.

**Quick Actions (one-click or keyboard-first):** Log Call (choose contact or add fast contact, answered?, outcome, notes, next action), Log Field Visit, Log LinkedIn DM, Log Connection Request, Log Sales Navigator InMail, Log Cold Email, Log Follow-up, Log Meeting/outcome, Log Demo Shown, Add Prospect, Add Task/Complete Task, Add Idea, Schedule Founder Point, Log Published Content, Add Expense/Payment, Generate Quote from Opportunity, Start New Client Audit. The menu shows the five most used for that founder, with search for the rest.

A completed activity updates lead history, day tally, score and dashboards through a SINGLE idempotent event (4.2). "Contact attempted", "conversation held", "demo shown" and "meeting booked" are separate states and counters. Reports deduplicate distinct prospects and show denominators.

### 5.1 Command Center (team)

Four tabs: **Now** (default), Sales, Money, Content. **Now** shows exactly five numbers (cash balance, MRR, weighted pipeline, new businesses contacted this week against target, meetings in the next 7 days), then one "Needs attention" list of at most five rows, sprint progress, and the next three calendar events. Everything below is available, placed in the tab it belongs to:

- **This month:** revenue recognized, cash collected, operating expenses, gross profit, estimated EBITDA, cash balance (from entered opening balances and transactions), MRR, ARR, new contracts, pipeline value, weighted pipeline, opportunities by stage.
- **Week:** founder-specific outbound attempted (calls, field visits, DMs, invitations, InMails, emails, follow-ups), new businesses contacted, positive replies, demos, meetings, proposals, deals won; conversion rates and meetings per focused sales hour.
- **Active sprint:** progress per founder against the sprint targets, and actual effort split by brand against the target split.
- Sales funnel and comparison France vs Spain; brands Valemont Consulting, Valemont Local, 30/30 AI.
- Top overdue tasks, hot leads needing follow-up, projects at risk, invoices awaiting payment, vendor capacity warnings, upcoming content.
- Personal daily streaks and team goal progress. No public shaming, no founder-versus-founder ranking, no distorted metrics.
- All charts derive from real Sheet data or unmistakably marked demo data.

### 5.2 My Day

Shows daily mode, capacity, today's quotas, actual counters with one-click logging, task checklist with priority and deadline, meetings, due follow-ups, Next Best Action queue, private job-search tasks if applicable, content tasks and workday completion. Switch between personal and team tasks. Views: My Tasks, Assigned to Pablo, Assigned to Théo, Unassigned, Overdue, By Project.

**Tasks** have id, title, description, owner, created_by, project_id, client_id, opportunity_id, priority (P0/P1/P2/P3), status, estimated_minutes, due_at, recurrence, dependency_ids, completion_evidence, completed_at, visibility, created_at, updated_at. Support list, Kanban and calendar views, reassign, snooze with reason, recurring instances, comments, activity log. Checkboxes persist actual status.

### 5.3 Work modes and editable targets

Modes: JOB_SEARCHING, EMPLOYED_35H, LAUNCH_SPRINT, CUSTOM, DAY_OFF, VACATION, plus per-day overrides and availability. Targets are suggested starting values, not platform caps or claims of sustainable performance. Stored in Sheets, editable at any time **prospectively**.

Seeds per workday, excluding meetings and delivery time:

| Mode / founder | Calls | DMs | Invitations | InMails | Cold emails | Due follow-ups | Comments | Job applications (private) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| JOB_SEARCHING Théo | 35 | 12 | 12 | 2 | 8 | 15 | 5 | 15 |
| JOB_SEARCHING Pablo | 50 | 15 | 12 | 2 | 10 | 20 | 5 | 5 |
| EMPLOYED_35H Théo | 12 | 6 | 6 | 1 | 4 | 8 | 3 | 0 |
| EMPLOYED_35H Pablo | 20 | 8 | 8 | 1 | 5 | 10 | 3 | 0 |

**LAUNCH_SPRINT seed (both founders):** 5 new businesses contacted per workday on any channel (phone, field visit, LinkedIn), all due follow-ups, 14-day targets from 2.4.

**Sprints** are a first-class record: name, start, end, per-founder targets, brand effort split, status. Onboarding asks which mode is active first and does not assume one.

**Feasibility.** Display estimated time against capacity using editable minutes per action (seeds: call 4, field visit 15, DM 3, invitation 1, InMail 5, cold email 4, follow-up 3, comment 3, job application 15). If planned time exceeds capacity, warn before the day starts and offer to reduce. Warn if an employed schedule leaves no daytime calling window. Job applications count toward capacity for the owner's eyes only.

**Plan snapshot.** Each scheduled day stores a `DailyPlans` snapshot of targets and weights at day start. Lowering a target during the day affects tomorrow, so a day cannot be passed by editing the goal.

LinkedIn invitation and InMail counters do not grant the right to exceed platform limits. Use a configurable remaining monthly InMail budget with manual resets and credits.

### 5.4 Streak rules

- Daily statuses: Scheduled, In progress, Passed, Perfect, Missed, Excused/Off.
- The user explicitly chooses workdays. No penalty for weekends, vacations, illness or days configured off. A scheduled day closes at local midnight, with a visible local cutoff.
- **Weighted attainment** = sum over eligible targets of `weight × min(actual / target, 1)` divided by the sum of weights. Eligible means target above 0. The cap stops one channel from compensating for another. Weights are configurable and shown. Private job applications are excluded.
- **Passed** requires: all high-priority due follow-ups completed or explicitly rescheduled with a reason; a completed end-of-day review; attainment of at least 85% using actual logged activities.
- **Perfect** additionally achieves every eligible daily target.
- No due follow-ups counts as fulfilled (ratio 1), not as a zero.
- **Missed** means a scheduled workday did not reach Passed after cutoff. No targets means no punishment.
- Streak = consecutive Passed/Perfect scheduled days, skipping Off days. Separate 7-day and 30-day consistency percentages. Founder-specific plus team overview. No fictional money or fake achievement claims.
- **Late logging:** an activity logged after cutoff keeps its true `occurred_at` and is flagged `late_logged`. It changes a closed day only through an audited correction with a reason.
- Logged events have unique IDs and cannot be silently fabricated or deleted to improve a streak.
- Weekly marketing deliverables are separate weekly completion scores, not forced daily tasks.
- Every activity is marked reported manually, verified by provider, or imported.
- Tone is informational: progress toward a target the founder chose. A broken streak shows the fact and the next step, with no guilt copy, no badges, no sounds.

### 5.5 Sales CRM and outreach

**Data model:** Accounts/Companies, Contacts, Opportunities, Touchpoints/Activities, Notes, Campaigns, Tasks. A "Deal" is an Opportunity in stage Won, not a separate table.

**Fields:** company, sector, niche, country FR/ES, lead source and lead type (referral, inbound, outbound), website, phone, business email, LinkedIn URL, decision-maker, estimated budget, owner founder, lead status, observed problem with evidence (what was actually seen, never an invented diagnosis), pain points, language, contact type, consent/opt-out status, next action and due date, value and currency, brand. Search and filter by founder, region, niche, channel, stage, deal size, expected close, last activity.

**Pipeline (configurable per brand):** Targeted > Contacted > Replied > Discovery Scheduled > Qualified > Demo Shown > Proposal Sent > Negotiation > Won/Lost, with a separate after-sale client lifecycle. Valemont Local may skip stages. Each stage has written exit criteria and a configurable probability. Track lost reasons, stage transitions and timestamps through append-only `OpportunityStageEvents`.

**Hygiene rules:** an open opportunity needs a next action with a date; the UI flags those without one. Qualified requires authority, need, urgency and money notes (ANUM).

**Next Best Action queue, deterministic order:** replied and unanswered; overdue high-priority follow-ups; follow-ups due today; hot leads with no touch in N days; new targets in the sprint niche. Show why each item is listed.

**Follow-up cadence seed:** day 1, 3, 7, 14 (close-the-file message), configurable per channel. A cadence creates next actions only. It never sends anything.

**Channels logged distinctly:** cold call, connected call, voicemail, field visit, LinkedIn connection invitation, LinkedIn DM, Sales Navigator InMail, cold email, reply, follow-up, demo shown, meeting booked, meeting held, proposal sent, sale. Each activity has result, objection (controlled list plus free text), source (manual/verified/imported), link to contact and campaign, user, `occurred_at`, `logged_at`, notes, next follow-up. A field visit also captures the outcome and who was met.

Click-to-call `tel:`, and click-to-open LinkedIn, WhatsApp and email. DO NOT simulate that clicking open completed an action: require a confirmed outcome.

Weekly conversion analytics by channel and founder with denominator labels. Top objections by niche and market. Pipeline math works backward from a target (deals, proposals, demos, conversations, contacts) using observed rates, and shows "not enough data" below a configurable sample, or clearly labelled assumptions.

Bulk CSV import with preview, validation and duplicate detection by normalized domain, email and phone; CSV export. No automated scraping or fake LinkedIn profiles. Track InMail credits separately from DMs and invitations.

**Outreach compliance (`ChannelRules`).** This is not legal advice and the app MUST say so. Each contact has a contact type: company generic, professional named, sole trader, consumer. A rule table per market, contact type and channel stores status (`allowed`, `allowed_with_conditions`, `requires_consent`, `needs_review`), a note, source URL and review date. Seed every rule as `needs_review` with these notes for counsel to confirm:

- FR phone to consumers: prior consent required since 2026-08-11 (loi 2025-594), and consent evidence must be retained.
- FR phone to professionals: reported as outside that rule when the offer directly relates to the recipient's profession; confirm for sole traders.
- FR email to professionals: opt-out regime when relevant to the recipient's role, with sender identity and objection on every message.
- ES commercial email: LSSI art. 21 requires prior authorization or a prior relationship, and it is not limited to consumers. Treat Spanish cold email as `requires_consent` until reviewed.
- ES commercial calls: LGTel art. 66.1.b requires consent or another GDPR art. 6 basis; sole-trader treatment needs review.

Behavior: the logging form and prospect card show the rule status and warn. A contact on the suppression list or with an opt-out is a **hard block** for outreach logging and queueing, across all founders and channels. A daily target on a `requires_consent` channel is flagged in onboarding until a founder confirms it. Store source, lawful basis and retention date per contact, and flag inactive prospects for deletion after a configurable period (seed: 3 years since last contact).

### 5.6 Marketing and Content Studio

Two brands: Valemont (meetings) and 30/30 AI (report purchases). Markets FR/ES. Channels: Instagram, LinkedIn company pages, founder LinkedIn, site/blog. Single pipeline: Idea > Script > Google Flow assets > Edit > Localize FR > Localize ES > Approved > Scheduled > Published > Measured.

Each content record: brand, concept_id, format, hook, target_persona, language, market, channel, published_at, caption, CTA, destination_url, UTM source/medium/campaign/content, owner, status, asset_url, platform_post_url, impressions, views, completion_rate, comments, saves, shares, profile_visits, link_clicks, leads, purchases, revenue. No made-up analytics; mark manually imported metrics clearly.

**Weekly goals, JOB_SEARCHING:** 3 original video concepts (2 for 30/30, 1 Valemont) adapted to 6 reels (4 30/30 FR/ES, 2 Valemont FR/ES), 4 brand LinkedIn posts (2 per brand, localized FR and ES), 4 personal LinkedIn posts total (2 each; Théo posts independent expertise only), 8 Instagram stories total (4 FR, 4 ES). One full VSL every 2 weeks during initial launch; later VSL modifications as needed.

**Weekly goals, EMPLOYED_35H:** 2 original concepts adapted to 4 reels (2 30/30 FR/ES, 2 Valemont FR/ES), 4 brand LinkedIn posts, 2 personal posts (1 each, same restriction), 4 stories total, no weekly new VSL quota.

Publishing tasks link to Google Flow and Claude assets. Media links are stored in Drive, never binaries in Sheets. Reusable FR/ES scripts, CTA templates and end-card checklist. Spanish distribution is owned by Pablo, French by Théo. Organic Instagram does not guarantee country filtering; store and inspect audience country and language metrics where accessible. LinkedIn Page targeting depends on platform eligibility. No false claim of guaranteed geo-targeting.

**Audience analytics (Marketing > Audience).** Tracks how views, followers and engagement evolve for every account in `SocialAccounts` (platform, brand, market, handle, connection mode, visibility).

- **Capture.** `SocialAccountDaily` holds one row per account and day: followers, views or impressions, reach, profile visits, interactions, link clicks, source (`api`/`import`/`manual`), capture time. `SocialPostSnapshots` holds per-post values at fixed ages (24 h, 72 h, 7 d, 30 d), so posts are compared at equal age. Both are append-only.
- **Main view.** One account or brand selector, one large line chart with a metric switch (views, followers, reach), a period switch, published posts marked as points on the line so a spike can be tied to a post, gaps left visible. Beneath it: top posts at equal age, and the path views > link clicks > leads > meetings or purchases using UTM links, with denominators.
- **Metric honesty.** Instagram `views` and LinkedIn impressions are different measures and are NEVER added into one total. Old Instagram impressions are not compared with views. Each figure shows its source. A LinkedIn import and a later API read of the same day keep the most authoritative source and record the other in the audit log.
- **Personal LinkedIn profiles.** Their statistics default to owner-only visibility and are never tagged with a brand. Team views show only the count of personal posts delivered against the weekly goal, unless the owner opts to share. This protects the rule in 2.3.
- **Instagram (API).** Own professional accounts only. Handle: Story metrics unavailable after 24 h and absent below 5 viewers; demographics absent below 100 followers; delayed data, shown with its capture time. On first connection, backfill only what the API actually returns.
- **LinkedIn (import first).** A guided upload accepts the official Page export (XLS) and creator analytics export (XLSX), with header-based mapping, preview, deduplication by date and post, and a clear report of unrecognized columns. A recurring 2-minute task reminds the owner weekly. Implement a `SocialProvider` interface so an approved API adapter can replace the import later without UI changes.

**Ad Fund.** A management-only envelope tracking money set aside for paid acquisition: target amounts (seeds EUR 1,500 test, EUR 3,000 full), allocations by founder decision from Local contribution margin, reserve held back, spend per brand. Allocations are not journal revenue or expense. A go/no-go checklist precedes the first campaign: 30/30 production cost and margin known, conversion measured, tracking in place. Ad results stay separate per brand.

### 5.7 Clients, projects and delivery

When an opportunity becomes WON, one-click Create Client & Project (via 4.4) with inherited quote/services, scope, milestones, delivery checklist, deadlines, budget, revenue, costs, timeline, founder owner, contractor assignments and client status. A short handoff records what was promised, stakeholders and success criteria. Kanban + timeline, segmented by brand/offer and France/Spain. Track estimated vs actual hours and direct costs, gross margin per project. Alert on overdue milestones, unassigned tasks and potential negative margin.

**Valemont Local subscriptions.** Per client and month: conversations, qualified requests, automated emails and support minutes against plan limits, entered manually or imported until the Local product can send them. Show per-client contribution margin from the actual or provisioned cost lines. Alert at 80% and 100% of any limit. Support time over the included 30 minutes is the main margin risk, so show it prominently.

### 5.8 Partners, contractors, suppliers and AI agents registry

Three separate registries: (a) HUMAN contractors/suppliers, (b) software/AI tools/providers, (c) reusable internal agent/workflow templates. Never present one as another.

**Human partner:** real name, company, skills, services, time zone, country, currency, hourly/daily/fixed cost, estimated capacity hours/week, availability status, response SLA, NDA/contract status, rate validity date, contact, projects assigned, notes, quality feedback. Supplier shortlist filtered by skills, capacity, region and cost. No invented contracts or internal employees.

**Tool/agent:** product/provider, use case, APIs and integration status, recurring license/usage cost, token/call/minute limits, input/output pricing version and date, owner, environment, linked projects, risk and privacy notes.

Partner rates are inputs, not hardcoded assumptions. The project cost calculator combines estimated founder labor, contractors, API usage and infrastructure. Margin guardrails apply before a quote is approved.

### 5.9 Audit questionnaire and quote engine

From any Opportunity: Start Audit, choose sector and complexity, generate a tailored questionnaire from stored templates (not hallucinated facts): inbound volume/calls, response times, tools/CRM, workflows, pain points, budget, privacy/data sensitivity, languages, current costs, stakeholders, success KPIs, integrations, security, timeline. 10 to 20 editable questions per template, including building trades and garage templates. Save answers. Supporting docs are linked from `FilesIndex`.

**Opportunity Summary:** observed problems, available facts, needs, open questions, automation opportunities, risk flags, recommended implementation steps. AI-written suggestions are marked as drafts for human review.

**Create Quote** from a validated opportunity/audit with price book items. Quantity, units, currency, discounts with permission, date validity, taxes configured by jurisdiction (no guessed cross-border VAT), payment terms, scope boundaries, exclusions, phased milestones, contingency, risks. Show separately: one-off amount, MRR, total first-year contract value, estimated delivery cost and gross margin. Never put setup fees into MRR. First-year value appears only when contract duration supports it.

**Commercial policy.** Configurable discount bands. A discount or margin below the guardrail requires approval by the other founder and a recorded trade ("what we got in exchange"). Pilot terms: duration, price, success criteria, conversion terms.

Saved draft, approval by a founder, versioned PDF with Valemont branding, preview, download and one-click save to the client's Drive folder; human-initiated sending only; status Draft/Approved/Sent/Accepted/Declined/Expired. UUID-based IDs or a human-readable reference derived from the UUID. A real professional PDF with well-spaced pages and all legally required fields configured by the user, never fake placeholders presented as real business details: if a required field is missing, generation is blocked and the field is named. Client audit and discovery call note templates. No automatic external email. Acceptance is not booked as cash received.

### 5.10 Finance and managerial P&L

This is a management accounting dashboard, not a replacement for statutory bookkeeping, certified invoicing or a qualified accountant. Prepare structured exports for the accountant and a future regulated invoicing system. Do not imply compliance with French/Spanish e-invoicing rules.

Cost centers: Valemont Consulting, Valemont Local, 30/30 AI, consolidated. Every transaction has local date, optional legal entity, account/category, tax treatment, original currency, EUR historical conversion, vendor/client, invoice or receipt reference, project, status, notes. Support recurring subscriptions (only if actually paid by the business), marketing costs, API token costs, contractors, domain/hosting, sales commissions, travel, reimbursements, operating expenses, refunds, transfers, VAT, payment fees, founder contributions and loans correctly classified. Founder capital contributions and inter-account transfers are NOT revenue. Personal salaries or expenses are NOT automatically Valemont costs.

Periods: MTD, QTD, YTD, 12-month trend, fiscal year, custom. Cards: recognized revenue, invoiced revenue, cash received, COGS/direct delivery costs, gross profit/margin, OPEX, estimated EBITDA, net operating result if adequate data, operating cashflow, cash balance, accounts receivable/payable, revenue by offer and country, MRR, ARR, active subscriptions, churn, weighted pipeline, forecast, budget vs actual.

**Accounting definitions (implement as pure tested functions; document in `docs/FINANCIAL_DEFINITIONS.md`):**

- **MRR** = sum of CURRENT ACTIVE contracted recurring monthly revenue, normalized from billing period, excluding VAT, setup fees, one-off reports and unsigned quotes.
- **MRR movements:** new, expansion, contraction, churn, reactivation. Logo churn, gross and net revenue retention. Show CAC payback by channel only with enough data.
- **ARR** = MRR × 12 (run rate), not booked annual revenue and not forecast.
- **Recognized revenue** follows service period/`RevenueSchedules` where entered. Without accrual inputs, show **Provisional EBITDA (invoice-based estimate)** clearly and never claim audited EBITDA. Setup fee recognition policy is a setting, to be confirmed with the accountant.
- **Estimated EBITDA** = accrual revenue − direct operating delivery costs − operating expenses, excluding interest, taxes, depreciation, amortization.
- **Cash collected** counts actual recorded payment events, not proposals or unpaid invoices. It includes VAT actually received, while revenue excludes VAT; show VAT separately.
- **Gross profit** = recognized revenue − direct cost of delivery. **Gross margin %** = gross profit / recognized revenue.
- Refunds and credit notes reduce the right metrics. Tax amounts, transfers and non-operating items are excluded from operational earnings where appropriate.
- **Weighted pipeline** = sum(eligible open opportunity amount × configured probability). NEVER add it to recognized revenue.
- FX uses the ECB reference rate on the transaction date, tracked with rounding and currency. The EUR/USD toggle is a reporting conversion, not a legal restatement.

Editable journal with CSV import/export, recurring expense scheduler and reconciliation status. Financial history is immutable or corrected by adjustment entries, never silently erased. Optional invoice drafts and payment records; actual customer invoices are externally imported or handled by a compliant provider before production use. No simulated bank feeds.

### 5.11 Reports, analytics and alerts

- Weekly founder scorecard, outreach and conversion per channel, consistency heatmap, pass/missed days, streak lengths, work-hours efficiency.
- **Weekly review page:** this week's numbers against targets, top objections, decisions taken (stored), next week's single priority per founder. Founders meet on this page.
- Month-end owner P&L, MRR/ARR trends, cash flow, budget vs actual, revenue by brand and region, project profitability, supplier utilization, aging leads and receivables.
- Downloadable CSV and PDF where appropriate. **Copy WhatsApp daily report** with exactly the logged actions (including field visits), open opportunities and next-day priority.
- In-app notifications in V1 for overdue follow-up, proposal expiry, failed integration sync, unpaid invoice, near-cap usage, supplier capacity. Optional email only if explicitly authorized. No unconfigured background promises.

### 5.12 Agenda and Founder Points

**Agenda** merges the next 14 days of connected calendars in a list and a week view, with a "next meetings" strip in My Day and the next three events on Command Center.

**Calendar setup (no per-user token, no weekly re-consent):**

- A founder creates a shared `Valemont` calendar, shared with the other founder and with the service account ("Make changes to events"). Every business meeting and founder point lives there, so it appears in both founders' own Google Calendar.
- Each founder shares their own calendar with the service account. "See only free/busy" is the recommended default. `CalendarSources` records each calendar, its owner and its visibility.
- Calendar IDs are configured, never inferred from the sign-in address.

**Privacy.** A founder sees full details of the `Valemont` calendar and of their own calendar. The other founder's personal events always render as "Busy", even if details were shared with the service account. Personal titles are never stored, cached across users or reported. This protects job-search interviews.

**Founder Points** are the scheduled conversations between Théo and Pablo. Each has a title, type (daily check-in, weekly review, decision, ad hoc), duration, agenda items, status, notes and decisions.

- Scheduling proposes three slots that are free for both, inside each founder's declared availability. One click writes the event to the `Valemont` calendar, with a link back to the point. Recurrence is supported.
- Service accounts cannot invite attendees without Google Workspace domain-wide delegation, so the app does not use attendees here: the shared calendar is what puts the event in front of both founders.
- A standing video link is a setting, inserted in the event. Per-event Meet creation is only available through the optional OAuth layer in section 7.
- During a point: agenda checklist, notes, decisions (stored and shown in the weekly review), and action items that become Tasks with an owner. Ideas marked "Discuss" are added automatically.
- A point moved or deleted in Google Calendar shows that change after sync.

**Meetings with prospects.** From an Opportunity, "Add to Google Calendar" opens a prefilled Google Calendar page so the founder adds guests and sends the invitation personally. When a linked meeting ends, the app asks for the outcome. It NEVER records a meeting as held on its own.

**Sync.** Read with `events.list` and `freeBusy`, server-side, cached, refreshed when Agenda is open and at the normal polling interval. No push channels in V1.

### 5.13 Idea Box

A deliberately light parking lot for ideas, so that a new idea does not interrupt the work in progress.

- Capture in under 5 seconds from anywhere (`I` shortcut, Quick Action, mobile): one line of text is enough; note, brand and category (offer, content, product, process, partner, other) are optional.
- Status: New, Discuss, Testing, Parked, Done, Rejected. Each founder can mark Yes, Maybe or No. Rejected and Parked ideas keep their reason.
- One-click conversion to a Task, Content Concept, Campaign or Opportunity, keeping the link to the idea.
- **Focus guard:** an idea never adds to today's targets. While a sprint is active, at most 2 ideas (seed, editable) can be in Testing; adding a third asks which one to park. Discussion happens in Founder Points.
- Display is a simple list grouped by status. No scoring matrix.

### 5.14 Files (Google Drive)

- A Files page shows the `Valemont OS` folder: breadcrumb, search, recent files, a right-hand detail panel with linked records and "Open in Drive".
- Clients, Projects, Opportunities, Content items and Quotes show their files in one compact panel. A record can be linked to a Drive folder.
- Attach an existing file through the Google Picker, upload a new one, or save a generated PDF (see 4.8).
- Suggested structure, created on request and never imposed: `Clients/<Client>`, `Content/<Brand>/<Concept>`, `Finance/Receipts`, `Templates`.
- Permissions shown are Drive's real ones. The app never makes a file public.

---

## 6. SHEETS DATA ARCHITECTURE

One private spreadsheet titled `Valemont OS — Production Data`, created by a founder (see 4.8). Idempotent `npm run setup:sheets` creates missing tabs, headers and basic formatting without overwriting data. Centralized schema definition, migrations with `schema_version`. Document relations in `docs/SCHEMA.md`.

**Tabs (refine if needed while preserving all modules):** SystemSettings, Users, WorkModes, DailyTargets, DailyPlans, Sprints, ActivityEvents, DailyResults, DailyResultCorrections, Tasks, TaskComments, Accounts, Contacts, Opportunities, OpportunityStageEvents, Campaigns, SalesActivities (or a documented view over ActivityEvents), LeadNotes, ChannelRules, SuppressionList, Audits, AuditQuestions, AuditAnswers, Offers, PriceBook, Quotes, QuoteItems, Clients, Projects, ProjectAssignments, Milestones, TimeEntries, LocalSubscriptionUsage, Vendors, VendorRates, Resources, AgentTemplates, ToolCosts, ContentConcepts, ContentCalendar, ContentMetrics, ContentTemplates, SocialAccounts, SocialAccountDaily, SocialPostSnapshots, Ideas, FounderPoints, FounderPointItems, CalendarSources, CalendarLinks, FinancialJournal, InvoicesDrafts, Payments, RecurringContracts, RecurringExpenses, RevenueSchedules, Budgets, AdFundLedger, FXRates, Notifications, WorkflowRuns, IntegrationStatuses, FilesIndex, AuditLog, SchemaMigrations.

**Private founder spreadsheets:** JobApplications, PrivateTasks.

Each table has typed Zod schemas, stable UUID id, timestamps, author/version fields and in-memory lookup maps per request. One record per row, predictable columns, no opaque database in one JSON cell. JSON-serialized fields for nested tags/IDs are acceptable if documented and validated. No files, access tokens, secrets or sensitive raw call transcripts in Sheets.

Append-only for outreach and money movement. Maintain integrity checks for foreign keys, missing records, duplicate IDs and orphans.

**Commands:**

- `npm run doctor:sheets`: credentials, permissions, required tabs, schema version, integrity, quotas/errors, and read/write round-trip using an explicitly marked test row it cleans up safely.
- `npm run backup:sheets`: versioned CSV/JSON snapshots to a configured private location or user-initiated download, without leaking private data. A restore procedure is documented and tested against the fake server.
- `npm run setup:sheets`: see above.

---

## 7. INTEGRATIONS HUB: HONEST CAPABILITY MATRIX

Statuses: Connected, Needs setup, Manual logging, Import-only, Unavailable, with last sync, requested permissions, setup instructions and tests. No false connection indicators or fake provider statistics. Least-privilege OAuth. Tokens stay out of Sheets: prefer an encrypted httpOnly cookie, encrypted platform environment or explicit reauthorization.

- **Google Sheets:** mandatory, bidirectional.
- **Google Sign-In:** restricted to the two configured addresses.
- **Google Drive:** connected. Service-account read path plus founder `drive.file` write path (4.8, 5.14).
- **Google Calendar:** connected through calendars shared with the service account (5.12, 4.13). Optional per-founder OAuth layer with `calendar.events` for real invitations and Meet links, off by default.
- **Gmail (optional):** user-authorized sending of approved quotes and follow-ups with explicit human action; `gmail.send` only, no inbox access.
- **Google OAuth consent rules to document:** with an External app in Testing status, refresh tokens expire after 7 days unless only basic sign-in scopes are used; sensitive scopes such as Calendar and Gmail need verification to go to Production. Therefore the default product uses only basic scopes and `drive.file`. Calendar and Gmail OAuth are opt-in, and the Integrations page states the weekly re-consent if they are enabled in Testing. A Google Workspace organization can avoid this with an Internal app.
- **Valemont and 30/30 websites:** authenticated endpoints capturing leads, source, language, UTM, purchases and refunds, only after configured and tested. HMAC signature, timestamp tolerance, idempotency key. Never assume websites are already wired.
- **LinkedIn + Sales Navigator (outreach):** manual logger, URLs, CRM imports, click-to-open. Data and messaging APIs require approved partner access. DO NOT scrape, use fake accounts, automate prohibited messaging, claim access or promise to read DMs.
- **LinkedIn statistics:** status `Import-only` until approved. Page statistics and member post analytics belong to the Community Management API, a vetted product: it needs a dedicated new developer app associated with a verified Company Page, a registered organization and a business email, then a Standard-tier review with a screencast. Development tier is limited to 500 calls per app and 100 per member per 24 hours. Build the adapter only after approval is obtained. No browser automation or scraping of analytics pages.
- **Instagram statistics:** Meta's Instagram API for the founders' own professional accounts, which needs no App Review at Standard Access. Prefer the Facebook Login path with a Facebook Page and a System User token, because the token does not expire and some metrics exist only on that path. Use Instagram Login (`instagram_business_manage_insights`, 60-day token) as the fallback. Manual entry remains available. No promise of precise organic country targeting.
- **Facebook:** optional, same Meta app, only if the founders use a Page.
- **Google Flow and AI creative tools (e.g. Claude):** link manually created assets in Drive and log credits/costs. No unofficial APIs, no automatic claim of generated video completion.
- **Payments (30/30, invoices):** connector interface for the actual provider when known; signed webhooks with idempotency; otherwise CSV/manual import. Do not assume Stripe.
- **Wise/banking:** manual CSV import or properly authorized official integration if available. No scraped or fabricated balances.
- **GA4/Search Console:** optional when accounts and credentials exist, manual fallback.
- **ECB:** reference EUR/USD feed with timestamp and cached fallback.

---

## 8. INTERFACE

`docs/DESIGN.md` is derived from this section, and every screen is built from its tokens and components. Reference images, if present, are in `docs/design-inspiration/` (numbered 01 to 20). They are a vocabulary to learn from, never layouts or brands to reproduce.

### 8.1 Direction

A calm, light workspace with quiet surfaces, large confident numbers and one warm accent. Light is chosen for the use: all-day office work and phones used outdoors during field visits. Keep tokens semantic so a dark theme can be added later, but ship one theme.

| Token | Value | Use |
|---|---|---|
| `canvas` | `#F1F0EC` | App background |
| `panel` | `#FBFAF7` | Panels and sidebar surface |
| `ink` | `#17161A` | Primary text, primary data, the single dark block |
| `text-2` | `#57545C` | Secondary text (7.1:1 on panel) |
| `text-3` | `#6E6A72` | Tertiary text, never lighter (5.1:1 on panel) |
| `hairline` | `#E2E0DA` | Separators only |
| `control-border` | `#8E8A92` | Input and control boundaries (3.2:1) |
| `accent` | `#E8920C` | Primary action fill, always with `ink` text (7.3:1) |
| `accent-text` | `#8F5400` | Accent as text on light surfaces (5.9:1) |
| `good` / `bad` | `#17704F` / `#B3261E` | Status only, with an icon and a sign |

**Data colors, fixed to the entity across the whole app:** Valemont Consulting `#2F5FBF`, Valemont Local `#C4730A`, 30/30 AI `#7A4FD6`. France and Spain use `ink` and `#8E8A92`, direct-labelled. Instagram and LinkedIn are never drawn on one axis, so they need no colors. Status colors are never used as series. Re-run a colorblind palette check if any value changes.

**Type:** one grotesque family loaded through `next/font`, with Geist as the first choice. Verify tabular figures work, and use them for all money, counters and table numbers. Scale 12/14/16/20/24/32/48; the hero number is 40 to 48 at weight 500 to 600, tight tracking, not bold. Body 14 to 16.

**Shape and depth:** panels radius 20, inner rows 12, controls and segmented switches fully rounded. Separate surfaces by tone and hairlines. A shadow only on floating layers (menus, tooltips, panels). Spacing scale 4/8/16/24/32/48. No card inside a card.

### 8.2 Limits that prevent saturation

- At most 5 primary numbers above the fold on any page.
- At most 1 chart above the fold, except comparison pages.
- The accent appears at most twice per screen: the primary action and the current focus.
- At most one dark `ink` block per screen, reserved for the number that matters most on that page. Never for promotion.
- Lists on overview pages show at most 5 rows with "See all".
- Hide a widget entirely when it has nothing to say, except where an empty state gives the next action.
- Details open in a right-hand panel that keeps the list visible. Modals only for protected focus.
- My Day has a Focus toggle that leaves only the next action, today's meters and the log button.
- Before finishing a screen, remove one element and check that nothing was lost.

### 8.3 Component vocabulary

| Component | Use it for | Reference |
|---|---|---|
| **Action meter**: one tick per action up to the target, filling only after server confirmation, a hollow tick while saving. Falls back to a continuous bar above 60. This is the signature element. | Today's quotas, sprint progress | 09, 20 |
| **Solid versus hatched**: solid means recorded fact; hatched means projected, unconfirmed or remaining target. Used consistently everywhere. | Revenue vs weighted pipeline, budget vs actual, target remaining | 02, 17, 20 |
| **Segmented bar with legend counts**, 2 px gaps | Pipeline by stage, tasks by status | 02 |
| **Dot matrix**: one dot per scheduled day, with shape as well as color for Passed, Perfect, Missed, Off | Consistency heatmap only | 01 |
| **Line chart** with vertical guide and a pill tooltip, 2 px line, 8 px markers, recessive grid, no area fill unless a single series | Views, followers, MRR | 02, 08, 13 |
| **Large number with delta pill**, and the comparison period always named | Primary metrics | 03, 14, 19 |
| **Direct label** connected to its point by a hairline | Key values on charts | 07, 20 |
| **Single dark block** | The one number that matters most | 06 |
| **Segmented pill switch** | Period, EUR/USD, list views | 04, 06, 15 |
| **Task row** with a round check and tabs Upcoming/Overdue/Completed | My Day, tasks | 10, 12 |
| **Setup checklist** with completed items struck through | Onboarding | 11 |
| **Sidebar tree** with quiet active row, action badges, account block at the bottom | Navigation | 01, 03, 05 |
| **Right detail panel** with properties and tags | CRM, Files | 05 |

**Do not take from the references:** low-contrast grey text, a large "View detail" button on every card, glass tooltips, glowing strokes and blurred color fields, gradient area fills on every chart, rainbow status colors, gauges and progress rings, emoji icons, mock avatars, promotional cards, perspective device framing, greetings such as "Welcome back".

### 8.4 Behavior and states

- My Day is built around the next action. The first visible element is what to do now, not a row of KPI tiles.
- Use tables and aligned columns where the data is tabular, instead of identical card grids.
- Numbers must be real, and a metric always shows its denominator or comparison. Charts have a table view, and each chart answers one question. One y-axis per chart.
- No eyebrow labels above headings, no gradient text, no colored side-stripes on cards, no emoji in UI, no copy praising the user.
- Text contrast at least 4.5:1, visible focus states, labelled inputs, hit targets usable on a phone. Theme selection, caret, scrollbars and focus rings. Log Field Visit and Log Call MUST be completable with one thumb.
- Keyboard: command palette, single-key shortcuts for frequent Quick Actions, Enter to save, Escape to close. A log completes in under 10 seconds for a known contact.
- Motion only to explain a state change, under 200 ms with ease-out, respects reduced motion, never delays input. Feedback happens in place on the element.
- Save states are server-confirmed. Optimistic UI is allowed only with a visible pending state and automatic rollback.
- Useful empty states with one clear next action; no mocked clients, revenue or success statistics in live mode.
- Onboarding checklist: identities, permissions, work schedules, markets, price book, opening cash balances, company details. Display missing prerequisites plainly and never invent legal addresses or company identifiers.
- Customizable sidebar, responsive tables, filters, date picker.

**Access:** row ownership, query isolation, server-side RBAC. Personal tasks are not shared unless chosen. Company pipelines and finance are shared.

---

## 9. IMPLEMENTATION STAGES

Stages are built sequentially. Each stage ends with its gate (section 1, item 7).

### Stage 1A: first usable day (built before anything else)

The smallest version the founders can sell with tomorrow:

Next.js app; Google OAuth allowlist; LIVE/DEMO separation; `DataRepository` with Sheets adapter, in-memory adapter and fake Sheets server; `setup:sheets` and `doctor:sheets`; Accounts, Contacts, Opportunities with pipeline; CSV prospect import with deduplication; Quick Actions for call, field visit, DM, invitation, InMail, cold email, follow-up, demo and meeting; My Day with editable mode, targets and live counters; suppression and opt-out block; Copy WhatsApp daily report.

**Gate:** acceptance scenarios 1, 2, 3, 11 and 15 pass; `docs/STATUS.md` updated with the setup steps.

### Stage 1B: management layer

Tasks with priorities, deadlines and views; private founder spreadsheets for job-search data; daily scoring and streaks; sprints; Command Center with real data; Next Best Action queue; weekly scorecard and weekly review; shared reports; notifications; conflict UI. Agenda and Founder Points through shared calendars; Idea Box; Files read path and Picker; `SocialAccounts` with manual entry, LinkedIn import and the Audience chart, so that history starts accumulating early. Smoke tests prove data survives reload and is visible to the other founder after refresh or poll.

**Gate:** scenarios 4, 5, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23 and 24.

### Stage 2: revenue operations

Audit questionnaires by sector, price book, quote/proposal generator to PDF, commercial policy, project creation from WON opportunities, human supplier bench, assignments, capacity, rate calculations, project costs, Local subscription usage and per-client margin, saving quote PDFs to Drive.

**Gate:** scenarios 6 and 7.

### Stage 3: finance and marketing

Expenses/payments, recurring contracts, revenue schedule, accurate managerial P&L, EBITDA, MRR, ARR, finance dashboard, multi-currency EUR/USD via ECB, cash vs revenue distinction, Ad Fund. Content planning, publishing checklist, FR/ES variants, manually entered analytics, weekly content targets. Instagram adapter, the snapshot job (4.11), post-level checkpoints and the views-to-leads path.

**Gate:** scenarios 8, 9, 10 and 22.

### Stage 4: integrations, reliability, deployment

Integration Hub, secure website webhook ingestion, optional Gmail, Calendar OAuth and analytics adapters only when credentials exist, a LinkedIn API adapter only after approval, CSV import/export everywhere, backups, audit logs, observability (structured logs with correlation IDs, health endpoint), deployment guides, full end-to-end acceptance suite, security review with a STRIDE threat model in `docs/SECURITY.md`.

**Gate:** all scenarios, plus live cross-session validation with real credentials if available.

Work stops only at a clean slice boundary with an accurate `docs/STATUS.md`. A missing feature is never reported as working. Google Sheets is never replaced with an easier database.

---

## 10. ACCEPTANCE SCENARIOS

Automated tests where possible, and the `docs/ACCEPTANCE.md` checklist otherwise. Every scenario runs against the fake Sheets server and fake Calendar, Drive and Instagram servers that can simulate 429 and 5xx responses. A separate `npm run test:live`, gated by credentials and using a dedicated test spreadsheet, runs against the real API; report it as `NOT RUN` if credentials are absent.

1. Log in as Théo, set Searching mode; the dashboard loads his exact saved targets from Google Sheets.
2. Add a test account and opportunity; log one cold call with outcome. The call appears exactly once in founder stats and company CRM and persists after reload.
3. Log in as Pablo in a separate browser context; update an opportunity; Théo sees the update after refresh/poll. Concurrent edits on the same row produce a visible conflict, never a silent overwrite.
4. Create a P0 task assigned to Pablo with deadline; it appears in Pablo's My Day and global projects; mark complete; state synchronizes.
5. Streaks, with weights 1 and targets calls 10, DMs 10, follow-up requirement met, review completed: actual 10 and 7 gives 85%, Passed; actual 10 and 6 gives 80%, Missed after local cutoff; actual 20 and 6 still gives 80% because of the cap. Off days are skipped. Repeated submissions with the same `idempotency_key` do not change the score. A day with no due follow-ups is not penalized.
6. Audit and quote for Valemont Local EUR 490 + EUR 99/month. With an explicit 12-month term, the PDF shows EUR 490 one-time, EUR 99 MRR and EUR 1,678 first-year contracted value before taxes. With no term or a shorter term, no first-year sum appears. The quote adds nothing to recognized revenue, cash or MRR.
7. Convert a WON opportunity to a project through `WorkflowRuns`; kill the workflow midway and retry, with no duplicate client or project; assign a contractor with a rate and capacity; compute estimated margin and status.
8. In one month, ex VAT: record EUR 99 cash for a current subscription with its service period inside the month, a EUR 12 operating expense and a one-time EUR 39 30/30 purchase. Expect MRR 99.00, ARR 1,188.00, cash collected 138.00, recognized revenue 138.00, OPEX 12.00, Provisional EBITDA 126.00. Variants: with 20% VAT on the subscription, cash rises by 19.80 and revenue is unchanged; with a service period split across two months, revenue splits and cash does not. A setup fee never changes MRR.
9. Toggle to USD and back using a labelled test FX fixture of 1.1000: EUR 99.00 displays USD 108.90 with rate date; stored `9900` EUR minor units are unchanged. A historical entry keeps its locked rate after the fixture changes.
10. Plan and publish a FR version of a 30/30 video and the ES version of the same concept; record status, UTM links and manual metrics without assuming geo-targeting.
11. Remove Google credentials: LIVE shows a setup error with no fake save. DEMO is clearly labelled and separately seeded.
12. Role restrictions; CSV export formula injection; malformed values; 429 retry with backoff; 5xx exhaustion surfacing "Error: retry"; missing references; conflicting updates. Malformed webhook signature is tested when webhooks exist (Stage 4).
13. Log a field visit on a mobile viewport using touch only; it counts as one new business contacted and appears in the WhatsApp report.
14. Mark a contact opted out; logging or queueing outreach to them is refused for both founders, by the server as well as the UI.
15. Phone `+33612345678`, negative amount `-12.00` and text `=SUM(A1)` round-trip through the Sheet unchanged; the text is stored as text; the CSV export neutralizes the formula text but keeps the phone number intact.
16. Pablo cannot read Théo's private job-search data by any route, and it appears in no team metric, cache or export. Two rows with the same `idempotency_key` count once. A day's goal lowered mid-day does not change that day's result.
17. Agenda merges a shared calendar and two founder calendars from a fake Calendar server. Théo's private event appears to Pablo only as "Busy", and its title is absent from every API response sent to Pablo and from Sheets.
18. Schedule a Founder Point: three mutually free slots are offered; choosing one creates one event on the shared calendar, and a retry creates no duplicate. Moving the event in the fake server updates the point after sync. Action items become Tasks.
19. Add an idea with one line of text. It adds nothing to today's targets. A third idea in Testing during a sprint triggers the park prompt. Conversion to a Task keeps the link.
20. Files lists the shared folder through the fake Drive server, with the service account credential only. Linking a file to a client persists in `FilesIndex` after reload. A write attempt without a founder's `drive.file` grant asks for consent and never falls back to the service account.
21. Import synthetic LinkedIn Page XLS and creator XLSX fixtures: preview shows mapped and unrecognized columns; re-importing the same file adds no row; the Audience chart shows the series with source `import`. Personal-profile data is invisible to the other founder.
22. Snapshot job: a valid signature captures once per slot and a repeat is a no-op; an invalid signature is refused; a Story snapshot taken inside 24 h is retained after the fake API stops serving it; a Story with fewer than 5 viewers is stored as "not available", not zero; a skipped day renders as a gap. Instagram views and LinkedIn impressions are never summed.
23. Information budget: Command Center's Now tab renders exactly five primary numbers in live and demo modes, and every metric from 5.1 is still reachable through the tabs. Automated contrast check passes on the tokens in 8.1.
24. Build separation: a repository scan finds no real address, calendar ID, Drive ID, handle or token outside `.env.example` placeholders, and the app boots using only environment configuration, with no dependency on any development account or connector.

---

## 11. REQUIRED OUTPUTS

All application source; Google Sheets connector; setup scripts; `.env.example`; `README.md`; `CLAUDE.md`; `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/INTEGRATIONS.md`, `docs/FINANCIAL_DEFINITIONS.md`, `docs/SECURITY.md`, `docs/MIGRATION_TO_POSTGRES.md`, `docs/DESIGN.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/ACCEPTANCE.md`, `docs/TROUBLESHOOTING.md`; deployment configuration; test suite.

**Stage report contents (recorded in `docs/STATUS.md` and `docs/DEPLOYMENT.md`):**

- which stages and features are implemented vs pending, using the status vocabulary;
- which Google Cloud credentials, OAuth consent and Sheet sharing actions the founders must perform;
- exact setup commands for local development, demo and live mode;
- tests run with their real results;
- precise limitations of Google Sheets, LinkedIn/Instagram APIs and managerial accounting;
- how to connect Google Sheets and access the live app;
- what to build next without rebuilding the core.
