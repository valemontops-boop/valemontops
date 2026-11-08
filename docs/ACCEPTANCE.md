# Acceptance checklist

Automated scenarios are listed with their test. Run `npm run check` and `npm run build && npm run test:e2e`.
Live validation needs real credentials (`npm run test:live` and the manual checks below).

## Stage 1A gate: scenarios 1, 2, 3, 11, 15
- [x] 1 — `tests/integration/scenarios.test.ts › Scenario 1` (fake Sheets)
- [x] 2 — `scenarios.test.ts › Scenario 2`, `tests/e2e/stage1a.spec.ts › scenario 2`
- [x] 3 — `tests/contract/*`, `scenarios.test.ts › Scenario 3`, `stage1a.spec.ts › scenario 3` (two browser contexts)
- [x] 11 — `scenarios.test.ts › Scenario 11`, `tests/e2e/live-missing-credentials.spec.ts`
- [x] 15 — `tests/contract/*` (round-trip), `tests/integration/sheets-adapter.test.ts` (RAW vs USER_ENTERED), `src/domain/csv.test.ts`, `stage1a.spec.ts › CSV export`

## Done early (Stage 1B gate items)
- [x] 13 — `tests/e2e/mobile.spec.ts`
- [x] 14 — `scenarios.test.ts › Scenario 14`, `stage1a.spec.ts › scenario 14`
- [x] 24 — `tests/integration/build-separation.test.ts`
- [~] 5 — attainment figures only (`src/domain/targets.test.ts`); Passed/Missed/streaks in 1B
- [~] 12 — malformed values, 429 retry, 5xx exhaustion, missing references, conflicts, malformed input, cross-origin: done; roles: 1B

## Stage 1B gate: scenarios 4, 5, 12, 13, 14, 16, 17, 18, 19, 20, 21, 23, 24
- [x] 4 — `tests/integration/stage1b.test.ts › Scenario 4`, `tests/e2e/stage1b.spec.ts › scenario 4`
- [x] 5 — `src/domain/streaks.test.ts`, `stage1b.test.ts › Scenario 5 (stored)`
- [x] 12 — `tests/integration/sheets-adapter.test.ts`, `doctor.test.ts`, e2e input/origin checks
- [x] 13, 14, 24 — see Stage 1A section
- [x] 16 — `stage1b.test.ts › Scenario 16`
- [x] 17, 18 — `stage1b.test.ts` (fake Calendar HTTP server), `stage1b.spec.ts`
- [x] 19 — `ideas.test.ts`, `stage1b.test.ts`, `stage1b.spec.ts`
- [x] 20 — `stage1b.test.ts` (fake Drive HTTP server), `stage1b.spec.ts`
- [x] 21 — `audience.test.ts`, `stage1b.test.ts` (synthetic XLS + XLSX fixtures)
- [x] 23 — `stage1b.test.ts`, `contrast.test.ts`, `stage1b.spec.ts`

## Manual checks once credentials exist (record the date and result in STATUS.md)
- [ ] `npm run setup:sheets` then `npm run doctor:sheets` on the production Sheet: all checks ✓
- [ ] Théo signs in with Google; a non-founder Google account is refused with "not one of the two founder addresses"
- [ ] Pablo signs in in another browser; Théo logs a call; Pablo sees it in the business history within one poll (≤ 60 s) or on refresh
- [ ] Both open the same opportunity, both edit: the second sees the conflict panel with both values
- [ ] Open the Sheet: phone `+33…` cells still start with `+`, notes beginning with `=` show as text
- [ ] `npm run test:live` with a dedicated test Sheet prints `VERIFIED_LIVE`
- [ ] Calendar: a founder point scheduled in the app appears in both founders' Google Calendars; moving it in Google updates the app
- [ ] Pablo's Agenda shows Théo's personal events only as "Busy"
- [ ] Files lists the shared "Valemont OS" folder; an upload asks for Drive permission once and the file is owned by the founder
- [ ] Import a real LinkedIn Page export (.xls) and creator export (.xlsx); the Audience chart shows source "import"
