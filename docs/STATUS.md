# Status

Updated: 2026-11-08 · Stage: **1B complete (fake-verified)** · Next: Stage 2 (revenue operations).
No Google credentials exist in the build environment, so nothing is `VERIFIED_LIVE`.

## Gate results
| Check | Result |
|---|---|
| `npm run lint` / `npm run typecheck` | pass |
| `npm test` (vitest: unit, contract, integration on fake Sheets + fake Calendar/Drive HTTP servers) | 107/107 pass |
| `npm run test:e2e` (Playwright, production build, DEMO on fake Sheets + LIVE-without-credentials server) | 16/16 pass |
| `npm run test:live` | NOT RUN (no credentials) |
| Browser preview artifact (all pages load, no console errors, Théo→Pablo task, agenda privacy) | pass |

## Acceptance scenarios
| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | Mode → exact saved targets | VERIFIED_FAKE | scenarios.test.ts |
| 2 | Cold call counted once, persists | VERIFIED_FAKE | scenarios.test.ts, e2e stage1a |
| 3 | Cross-founder visibility; concurrent edit → conflict | VERIFIED_FAKE | contract suite, e2e (two browsers) |
| 4 | P0 task for Pablo → his My Day; completion syncs | VERIFIED_FAKE | stage1b.test.ts, e2e stage1b |
| 5 | 85 % Passed / 80 % Missed / cap / Off skipped / idempotent / no follow-ups not penalised | VERIFIED_FAKE | streaks.test.ts, stage1b.test.ts (stored closure after cutoff) |
| 11 | LIVE without creds → setup error, no DEMO fallback | VERIFIED_FAKE | e2e live-missing-credentials |
| 12 | Malformed values, 429 retry, 5xx exhaustion, missing refs, conflicts, cross-origin, private-task access | VERIFIED_FAKE | adapter + doctor + e2e tests (roles beyond the two founders: n/a in V1) |
| 13 | Field visit by touch on a phone | VERIFIED_FAKE | e2e mobile |
| 14 | Opt-out blocked for both founders | VERIFIED_FAKE | scenarios.test.ts, e2e |
| 15 | `+33…`, `-12.00`, `=SUM(A1)` round-trip; CSV neutralised | VERIFIED_FAKE | contract, adapter, csv, e2e |
| 16 | Private job data unreachable; dedupe; mid-day goal change | VERIFIED_FAKE | stage1b.test.ts, scenarios.test.ts |
| 17 | Agenda merge; other founder's event only "Busy", title absent | VERIFIED_FAKE | stage1b.test.ts (HTTP fake), e2e |
| 18 | 3 mutual slots, one event, retry-safe, move followed, actions → tasks | VERIFIED_FAKE | stage1b.test.ts, e2e |
| 19 | Idea adds nothing to targets; 3rd Testing → park prompt; conversion linked | VERIFIED_FAKE | ideas.test.ts, stage1b.test.ts, e2e |
| 20 | Files via service account; link persists; upload needs founder grant | VERIFIED_FAKE | stage1b.test.ts, e2e |
| 21 | LinkedIn XLS/XLSX import: mapping, re-import no-op, source shown, personal private | VERIFIED_FAKE | audience.test.ts, stage1b.test.ts |
| 23 | Exactly five numbers on Now; all 5.1 metrics reachable; token contrast | VERIFIED_FAKE | stage1b.test.ts, contrast.test.ts, e2e |
| 24 | No real address/ID/token in repo | VERIFIED_FAKE | build-separation.test.ts |

## Features
| Feature | Status | Notes |
|---|---|---|
| Simple CRM board (5 columns, next step first, drag or →, qualify prompt), list view, details under "More" | VERIFIED_FAKE | D018 |
| Accent changed from orange to ink | VERIFIED_FAKE | D017, contrast test |
| Tasks: P0–P3, owner, due, recurrence, dependencies, snooze with reason, comments, list/board/week, private tasks | VERIFIED_FAKE | |
| Private founder spreadsheets (job applications, private tasks) | VERIFIED_FAKE | needs PRIVATE_SHEET_ID_* in LIVE |
| Daily results, streaks, 7/30-day consistency, end-of-day review, audited late correction | VERIFIED_FAKE | D021 |
| Sprints (targets per founder, brand split, niche) | VERIFIED_FAKE | |
| Command Center (Now / Sales / Money / Content) | VERIFIED_FAKE | cash & MRR "Not tracked yet" until Stage 3 (D022) |
| Next Best Action queue with reasons | VERIFIED_FAKE | |
| Weekly review (numbers vs targets, objections, decisions, priorities), scorecard + CSV, consistency dots | VERIFIED_FAKE | |
| In-app notifications (follow-ups, tasks, integration errors) | VERIFIED_FAKE | D024 |
| Agenda (14 days, list/week) + Founder Points | VERIFIED_FAKE | LIVE needs Calendar API + shared calendars |
| Idea Box (I shortcut, votes, guard, conversion) | VERIFIED_FAKE | Task/Opportunity only (D028) |
| Files: Drive read path, linking, consent-gated upload | PARTIAL | Picker not wired (D026) |
| Audience: accounts, manual entry, LinkedIn import, chart with gaps | VERIFIED_FAKE | post snapshots + Instagram API: Stage 3 (D027) |
| Google OAuth sign-in, Drive incremental consent | PARTIAL | code complete; BLOCKED: needs OAuth client to run against Google |
| Stage 1A features (see git history) | VERIFIED_FAKE | |
| Stages 2–4 | NOT_STARTED | listed in Settings › Roadmap |

## Known limits
- Residual race window on mutable rows is detected (write_id) and shown as a conflict, not prevented.
- Day closure uses current workdays when no plan snapshot exists for a past day.
- Legacy XLS parsing uses SheetJS 0.18.5 (advisories on crafted files), see D020 and SECURITY.md.
- DEMO `memory` resets on restart; the browser preview resets on reload and cannot import Excel files.
