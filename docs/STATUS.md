# Status

Updated: 2026-11-08 · Stage: **1A complete (fake-verified)** · Next: Stage 1B.
No Google credentials exist in the build environment, so nothing is `VERIFIED_LIVE`.

## Gate results (Stage 1A)
| Check | Result |
|---|---|
| `npm run lint` | pass (0 problems) |
| `npm run typecheck` | pass |
| `npm test` (vitest) | 66/66 pass, 12 files |
| `npm run test:e2e` (Playwright, production build, DEMO on fake Sheets + LIVE-without-creds server) | 10/10 pass |
| `setup:sheets` ×2 + `doctor:sheets` against a fake server | pass; second run is a no-op |
| `npm run test:live` | NOT RUN (no credentials) |

## Acceptance scenarios
| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | Mode → exact saved targets from Sheets | VERIFIED_FAKE | `tests/integration/scenarios.test.ts` |
| 2 | One cold call counted once, persists after reload | VERIFIED_FAKE | scenarios.test.ts + e2e `stage1a.spec.ts` |
| 3 | Cross-founder visibility; concurrent edit → visible conflict | VERIFIED_FAKE | contract suite, scenarios.test.ts, e2e (two browser contexts) |
| 11 | LIVE without creds → setup error, no fake save, no DEMO fallback | VERIFIED_FAKE | scenarios.test.ts + e2e `live-missing-credentials.spec.ts` |
| 15 | `+33612345678`, `-12.00`, `=SUM(A1)` round-trip; CSV export neutralises formula | VERIFIED_FAKE | contract + adapter tests, csv.test.ts, e2e |
| 13 | Field visit on phone, touch only → 1 new business, in WhatsApp report (1B gate, done early) | VERIFIED_FAKE | e2e `mobile.spec.ts` |
| 14 | Opt-out blocked for both founders, server + UI (1B gate, done early) | VERIFIED_FAKE | scenarios.test.ts + e2e |
| 5 | Attainment figures 85/80/80 % (pure function only; streak days are 1B) | PARTIAL | `src/domain/targets.test.ts` |
| 16 | Same idempotency_key counts once; goal lowered mid-day does not change the day | PARTIAL (private data part is 1B) | scenarios.test.ts |
| 24 | No real address/ID/token in repo | VERIFIED_FAKE | `build-separation.test.ts` |

## Features
| Feature | Status | Notes |
|---|---|---|
| Next.js app, design tokens, responsive shell, DEMO banner, ⌘K palette, single-key quick actions | VERIFIED_FAKE | |
| Google OAuth allowlist (2 founders, `openid email profile`, PKCE) | PARTIAL | Code complete; BLOCKED: needs OAuth client to test against Google |
| Encrypted stateless session (JWE cookie), DEMO sign-in only in DEMO | VERIFIED_FAKE | |
| LIVE/DEMO separation + setup page | VERIFIED_FAKE | |
| `DataRepository`, Sheets adapter, in-memory adapter, fake Sheets server | VERIFIED_FAKE | 429 retry w/ jitter, 5xx exhaustion, write_id conflict, column moves, sorted tabs |
| Revision-token polling (one small range, 10 s server cache) | VERIFIED_FAKE | |
| `setup:sheets` / `doctor:sheets` | VERIFIED_FAKE | Live run BLOCKED: credentials |
| Accounts, Contacts, Opportunities, stage events, pipeline, ANUM rule, hygiene flags | VERIFIED_FAKE | |
| CSV prospect import (preview, dedupe by domain/email/phone, idempotent) + CSV export | VERIFIED_FAKE | |
| Quick Actions: call, field visit, DM, invitation, InMail, cold email, follow-up, demo, meeting, comment | VERIFIED_FAKE | fast "new business" inside the logger |
| My Day: next action, mode, targets editor, plan snapshot, live meters, follow-ups, today's log, Focus, feasibility | VERIFIED_FAKE | |
| Suppression list + opt-out hard block; channel-rule warnings (all `needs_review`) | VERIFIED_FAKE | Not legal advice; counsel review pending |
| Copy WhatsApp daily report | VERIFIED_FAKE | |
| Conflict UI (both values, keep / apply mine) | VERIFIED_FAKE | |
| Diagnostics (requests/min, retries, tab row counts, integrity warnings) | VERIFIED_FAKE | |
| Command Center, Tasks, streaks/day closure, sprints, NBA queue, weekly review, Agenda, Ideas, Files, Audience | NOT_STARTED | Stage 1B; hidden from nav, listed in Settings › Roadmap |
| Private job-search spreadsheets | NOT_STARTED | Stage 1B (D014) |
| Quotes/PDF, projects, finance, content, integrations hub, backups | NOT_STARTED | Stages 2–4 |
| docs: FINANCIAL_DEFINITIONS, MIGRATION_TO_POSTGRES, full STRIDE SECURITY | NOT_STARTED | Stage 3 / 4 |

## Known limits
- Residual race window between our version check and the write is detected by write_id confirmation (reported as a conflict), not prevented. See ARCHITECTURE.md.
- DEMO `memory` backend resets on server restart (labelled). Use `DEMO_BACKEND=fake-sheets` for persistence.
- No streak/day-closure status yet: Passed/Missed arrive in 1B (pure attainment function exists and is tested).
