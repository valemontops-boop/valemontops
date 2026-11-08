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

## Manual checks once credentials exist (record the date and result in STATUS.md)
- [ ] `npm run setup:sheets` then `npm run doctor:sheets` on the production Sheet: all checks ✓
- [ ] Théo signs in with Google; a non-founder Google account is refused with "not one of the two founder addresses"
- [ ] Pablo signs in in another browser; Théo logs a call; Pablo sees it in the business history within one poll (≤ 60 s) or on refresh
- [ ] Both open the same opportunity, both edit: the second sees the conflict panel with both values
- [ ] Open the Sheet: phone `+33…` cells still start with `+`, notes beginning with `=` show as text
- [ ] `npm run test:live` with a dedicated test Sheet prints `VERIFIED_LIVE`
