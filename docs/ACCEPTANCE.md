# Acceptance — spec §10 scenarios mapped to tests (Stage 4B, D084)

Run: `npm run check` (lint + typecheck + Vitest), `npm run build && npm run test:e2e` (Playwright: production build in
DEMO on the fake Sheets server, plus a LIVE-without-credentials server), `npm run test:live` (gated: real Google API
on a dedicated test Sheet; **NOT RUN** without `.env.live-test`).

Fakes used: `src/fake-sheets/server.ts` (Sheets v4, RAW vs USER_ENTERED, 429/5xx/latency injection),
`src/fake-google/server.ts` (Calendar, Drive incl. files.copy/trash and the service-account storage quota, Gmail),
`src/fake-instagram`, `src/fake-wise`, `src/fake-stripe.ts`.

Status words: VERIFIED_FAKE (passes against the fakes), VERIFIED_LIVE (needs real credentials: none yet),
PARTIAL, NOT_STARTED, BLOCKED: reason.

| # | Scenario (short) | Tests | Status |
|---|---|---|---|
| 1 | Théo, Searching mode, exact saved targets | `tests/integration/scenarios.test.ts › Scenario 1` | VERIFIED_FAKE |
| 2 | Account + opportunity, one cold call counted once, survives reload | `scenarios.test.ts › Scenario 2`, `tests/e2e/stage1a.spec.ts › scenario 2` | VERIFIED_FAKE |
| 3 | Pablo in another context sees updates; concurrent edit → conflict | `tests/contract/*`, `scenarios.test.ts › Scenario 3`, `stage1a.spec.ts › scenario 3` (two browser contexts) | VERIFIED_FAKE |
| 4 | P0 task for Pablo, My Day, complete, sync | `tests/integration/stage1b.test.ts › Scenario 4`, `tests/e2e/stage1b.spec.ts › scenario 4` | VERIFIED_FAKE |
| 5 | Streak figures 85 % / 80 % / cap, off days, idempotency, no follow-ups not penalised | `src/domain/streaks.test.ts`, `src/domain/targets.test.ts`, `stage1b.test.ts › Scenario 5` | VERIFIED_FAKE |
| 6 | Audit + quote, 12-month first-year value, nothing booked | `src/domain/quotes.test.ts`, `tests/integration/quotes.test.ts › scenario 6`, `tests/e2e/stage2a.spec.ts` | VERIFIED_FAKE |
| 7 | Won → client + project via WorkflowRuns, killed and retried, contractor margin | `tests/integration/delivery.test.ts › Scenario 7`, `tests/e2e/stage2b.spec.ts` | VERIFIED_FAKE |
| 8 | Cash vs recognised revenue, MRR/ARR, OPEX, provisional EBITDA, VAT and split periods | `tests/integration/finance.test.ts › Scenario 8`, `src/domain/finance.test.ts`, `tests/e2e/stage3-finance.spec.ts` | VERIFIED_FAKE |
| 9 | EUR/USD toggle with ECB fixture, locked historical rate | `finance.test.ts › Everything is EUR` (asserts the switch is gone) | BLOCKED: removed by the founders (D082, everything is EUR) |
| 10 | 30/30 concept, FR + ES versions, UTM links, manual metrics | `tests/integration/content-studio.test.ts › scenario 10`, `tests/e2e/stage3-content.spec.ts` | VERIFIED_FAKE |
| 11 | No Google credentials: LIVE setup error, never a fake save; DEMO labelled | `scenarios.test.ts › Scenario 11`, `tests/e2e/live-missing-credentials.spec.ts`, `stage1a.spec.ts › DEMO is clearly labelled`, `tests/integration/stage4b-routes.test.ts › readiness fails with 503` | VERIFIED_FAKE |
| 12 | Roles; CSV formula injection; malformed values; 429 backoff; 5xx → "Error: retry"; missing refs; conflicts; malformed webhook signatures | `tests/integration/sheets-adapter.test.ts`, `doctor.test.ts`, `src/domain/csv.test.ts`, `stage1a.spec.ts › server rejects malformed input and cross-origin mutations`; webhooks: `inbox.test.ts`, `stripe.test.ts`, `wise.test.ts`, `website-webhook.test.ts`, `content-studio.test.ts › snapshot signature`, `stage4b-routes.test.ts › webhooks: oversized bodies / rate limited`, `stage4b-routes.test.ts › malformed Origin → 403` | VERIFIED_FAKE |
| 13 | Field visit on a phone, touch only, counted once, in WhatsApp report | `tests/e2e/mobile.spec.ts` | VERIFIED_FAKE |
| 14 | Opted-out contact refused by the server for both founders | `scenarios.test.ts › Scenario 14`, `stage1a.spec.ts › scenario 14` | VERIFIED_FAKE |
| 15 | `+33612345678`, `-12.00`, `=SUM(A1)` round-trip; CSV neutralises formula, keeps phone | `tests/contract/*`, `sheets-adapter.test.ts`, `src/domain/csv.test.ts`, `stage1a.spec.ts › CSV export`, **and through a backup + restore**: `tests/integration/backups.test.ts › restore round-trip` | VERIFIED_FAKE |
| 16 | Private job-search data unreachable by Pablo; duplicate idempotency key counts once; goal lowered mid-day | `stage1b.test.ts › Scenario 16`; audit rows of private mutations carry no detail and are hidden from the other founder: `stage4b-routes.test.ts › viewer`, `tests/integration/audit-log.test.ts`; JSON backup excludes private sheets: `stage4b-routes.test.ts › JSON copy` | VERIFIED_FAKE |
| 17 | Agenda merges calendars; Théo's private event is "Busy" for Pablo | `stage1b.test.ts` (fake Calendar HTTP), `stage1b.spec.ts › scenario 17` | VERIFIED_FAKE |
| 18 | Founder Point: three free slots, one event, retry no duplicate, moved event syncs, action items → tasks | `stage1b.test.ts › Scenario 18`, `stage1b.spec.ts › scenario 18` | VERIFIED_FAKE |
| 19 | One-line idea, no target impact, park prompt at third, conversion keeps link | `src/domain/ideas.test.ts`, `stage1b.test.ts › Scenario 19`, `stage1b.spec.ts › scenario 19` | VERIFIED_FAKE |
| 20 | Files via service account; link persists; write without drive.file asks consent | `stage1b.test.ts › Scenario 20` (fake Drive HTTP), `stage1b.spec.ts › scenario 20` | VERIFIED_FAKE |
| 21 | LinkedIn XLS/XLSX import preview, idempotent re-import, source `import`, personal data private | `src/domain/audience.test.ts`, `stage1b.test.ts › Scenario 21` | VERIFIED_FAKE |
| 22 | Snapshot job: signature, once per slot, story kept after 24 h, < 5 viewers "not available", gaps, no summing | `tests/integration/content-studio.test.ts › scenario 22`, `src/domain/content-studio.test.ts` | VERIFIED_FAKE |
| 23 | Command Center Now = exactly five numbers; contrast check | `stage1b.test.ts › Scenario 23`, `src/domain/contrast.test.ts`, `stage1b.spec.ts › scenario 23` | VERIFIED_FAKE |
| 24 | Build separation: no real address/ID/token; boots from env only | `tests/integration/build-separation.test.ts` | VERIFIED_FAKE |

## Stage 4 additions (not numbered in the spec)

| Feature | Tests | Status |
|---|---|---|
| Backups: Drive copy, verification, once per day (lock + lease + done row), retention, quota error, 5xx | `tests/integration/backups.test.ts`, `src/domain/backup.test.ts` | VERIFIED_FAKE |
| Restore into a NEW spreadsheet (from the Drive copy and from the JSON copy), refusal of live/non-empty targets | `backups.test.ts › restore …` | VERIFIED_FAKE |
| Audit log via `route()` (field names only, refused mutations included, private rows hidden), viewer filters | `stage4b-routes.test.ts`, `audit-log.test.ts`, `tests/e2e/stage4b-ops.spec.ts` | VERIFIED_FAKE |
| Correlation ids, structured redacted logs | `src/server/log.test.ts`, `stage4b-routes.test.ts`, `stage4b-ops.spec.ts` | VERIFIED_FAKE |
| `/api/health` (liveness/readiness), `/api/health/details` (founders) | `stage4b-routes.test.ts › health`, `stage4b-ops.spec.ts` | VERIFIED_FAKE |
| Security fixes: open redirect, CSRF on sign-out, malformed Origin, streaming body caps, webhook rate limits, SSRF via redirect, CSP/HSTS | `src/server/guard.test.ts`, `src/server/services/seo-ssrf.test.ts`, `stage4b-routes.test.ts › security fixes`, `stage4b-ops.spec.ts › headers` | VERIFIED_FAKE |
| Integration Hub, website webhook, CSV everywhere (Stage 4A) | `website-webhook.test.ts`, `csv-hub.test.ts`, `tests/e2e/stage4a-integrations.spec.ts` | see STATUS.md (Stage 4A) |

## Stage 4 gate: live validation (needs the founders' credentials)

`npm run test:live` — **NOT RUN** (no `.env.live-test`). Manual checks to record in STATUS.md with the date:

- [ ] `npm run setup:sheets` then `npm run doctor:sheets` on the production Sheet: all checks ✓
- [ ] Théo signs in with Google; a non-founder account is refused
- [ ] Pablo signs in in another browser; Théo logs a call; Pablo sees it within one poll (≤ 60 s) or on refresh
- [ ] Both edit the same opportunity: the second sees the conflict panel with both values
- [ ] In the Sheet: `+33…` cells keep the `+`, notes beginning with `=` show as text
- [ ] `npm run test:live` with a dedicated test Sheet prints `VERIFIED_LIVE`
- [ ] Calendar: a founder point appears in both calendars; moving it in Google updates the app
- [ ] Pablo's Agenda shows Théo's personal events only as "Busy"
- [ ] Files lists the shared folder; an upload asks for Drive permission once and the file is owned by the founder
- [ ] LinkedIn Page (.xls) and creator (.xlsx) exports import with source "import"
- [ ] Backups: `/api/jobs/backup` with the cron secret makes "Valemont OS backup <today>" in the backups folder (Shared Drive or Apps Script copy); Diagnostics › Backups shows "verified"
- [ ] Restore drill: `npm run restore:sheets -- --from-sheet <copy> --to <new empty Sheet>` prints ✓; `doctor:sheets` on it ✓ (do not switch production)
- [ ] `GET /api/health` returns 200 from the production URL; `x-request-id` of a request is found in Vercel logs and in the AuditLog tab
- [ ] Security headers on the production domain (CSP, HSTS) via the browser's network panel
