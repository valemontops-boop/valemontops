# Status

Updated: 2026-11-09 · Stage: **1B complete + founder feedback round 9 (fake-verified)** · Next: Stage 2 (revenue operations).

## Feedback round 9 (2026-11-09)
| Change | Status |
|---|---|
| Business seeds: Consulting priority (100 % effort), Local = entry offer, ladder Consulting → Local → 30/30, phone + LinkedIn, no Instagram DMs, ads 0 €, hour cost 30 €; emails counted with no daily target | VERIFIED_FAKE (brief-seeds tests) |
| Call path: New call → picked up / not → objection or in-call email → hung up → outcome; mail during the call (address typed while the prospect spells it), mail after a missed call; Local / 30/30 ladder with pitches and outcomes | VERIFIED_FAKE (calls tests, e2e, preview) |
| CAC per channel, fully loaded (founder time + all Money expenses), cost per meeting, payback, LTV:CAC, call economics vs researched benchmarks | VERIFIED_FAKE (cac.test.ts) — real expenses needed for meaningful numbers |
| SEO: Search Console CSV import, optimisation points, site audit, AI-engines checklist | VERIFIED_FAKE (seo.test.ts; demo site) — audit runs on the real site in LIVE only |

## Feedback round 8 (2026-11-09)
| Change | Status |
|---|---|
| Founder brief applied: modes FULL_TIME / REDUCED (old values read as aliases), targets, LinkedIn limits first, KPI targets, sprint 9 Nov → 4 Dec (2 clients, 3 000 € HT), conversion by channel, time split, daily checklist + one-off tasks, content plan, WhatsApp report, Friday rules | VERIFIED_FAKE (brief-seeds, conversion, friday, report tests; preview) |
| Offers: one Valemont offer (Consulting, default 1 500 €), Local = downsell 100 €/month; no brand choice when prospecting; 490 € removed | VERIFIED_FAKE |
| Export over a period: Markdown for AI (founder's language), Excel option; no prospect phone/email | VERIFIED_FAKE (export-tracker.test.ts; preview MD only) |
| Personal tracker connector: signed webhook per activity + backfill + daily summary; bearer-token feed | VERIFIED_FAKE — needs the tracker URL/secret for VERIFIED_LIVE |
| Growth: Web (browser) vs AI engines vs social networks, each with its funnel | VERIFIED_FAKE (traffic-sources.test.ts) |
| "To reply" inbox: signed webhook (Make/Zapier/n8n), Instagram (Meta) adapter, automatic items from replies/leads, suggested replies; nothing sent automatically | VERIFIED_FAKE — Meta app review needed for live Instagram |
| Calls: before / during / after flow, 6 most-heard objections first, undo 10 s; inline message card, WhatsApp Web, "Sent?" on return; message session | VERIFIED_FAKE (e2e, preview) |
| LinkedIn prospecting session: queue, profile, step message to copy, results by key, follow-ups J+3/J+7, hard invitation/InMail limits | VERIFIED_FAKE (linkedin.test.ts, e2e) |

## Feedback round 7 (2026-11-09)
| Change | Status |
|---|---|
| Objection replies easier to read: 3 numbered steps (Reformule / Demande / Propose), large text, the question in bold | VERIFIED_FAKE (preview) |
| Instant email / WhatsApp: one click; Gmail API when connected, else Gmail opens prefilled (right person, subject, founder's language, founder's signature); WhatsApp prefilled; "Sent?" confirmation | VERIFIED_FAKE (playbook.test.ts, e2e, preview) — Gmail API send needs real credentials for VERIFIED_LIVE |
| Calls: no language switch; "Hang up" (X) ends the call, not the session; call log per session and over 14 days | VERIFIED_FAKE (calls.test.ts, e2e, preview) |
| Growth rebuilt: six tabs with the same layout (numbers → funnel → details), channels compared, LinkedIn and Instagram funnels | VERIFIED_FAKE (preview FR/ES/phone) |
| Trade names in French / Spanish everywhere (demo data + dictionary for English names) | VERIFIED_FAKE (preview scan) |
| Weekly review simplified (4 totals, went well / to improve, 3 fields) | VERIFIED_FAKE |
| Task recurrence: daily, weekdays, weekly, monthly, chosen weekdays (e.g. every Tuesday) | VERIFIED_FAKE (tasks.test.ts) |

## Feedback round 6 (2026-11-09)
| Change | Status |
|---|---|
| Call session error after a reload fixed (session recreated, no lost tap) | VERIFIED_FAKE (calls.test.ts, preview reload check) |
| Live call: big reply card, big buttons, message bar on top; scripts only in the founder's language | VERIFIED_FAKE (e2e, preview) |
| Stripe: balance, sales, fees, payouts, MRR, signed webhook; Wise payouts from Stripe not counted twice | VERIFIED_FAKE (stripe.test.ts) — needs the real key for VERIFIED_LIVE |
| Verdicts (what works / to watch / to improve + next step) on Reports, Growth, Money, Command Center | VERIFIED_FAKE (verdicts.test.ts) |
| Growth (renamed Marketing); six social accounts with an overview | VERIFIED_FAKE |

## Feedback round 5 (2026-11-09)
| Change | Status |
|---|---|
| No English UI: French for Théo, Spanish for Pablo (UI, server messages, WhatsApp report, dates, money format) | VERIFIED_FAKE (i18n.test.ts, preview scan FR/ES) |
| Wise: balances, statements (SCA signing), live webhooks (RSA-verified), CSV import, categories, Money page, Command Center cash | VERIFIED_FAKE (wise.test.ts, fake Wise HTTP) — needs the real token for VERIFIED_LIVE |
| Simpler call screen and sober UI (one blue, green for results) | VERIFIED_FAKE (e2e, preview) |
| Marketing = funnels across calls, visits, LinkedIn, email, WhatsApp, website/social, meetings per hour | VERIFIED_FAKE (funnels.test.ts) |

## Feedback round 4 (2026-11-09)
| Change | Status |
|---|---|
| Objections v3: brush-off vs real, 12 objections (keys A…T), 3-step replies (Label / Ask / Next step) × 2 variants FR/ES, best reply learned from results (← → to switch), pause cue, objection drill, analytics by country | VERIFIED_FAKE (playbook.test.ts, followups.test.ts, e2e) |
| Messages: suggested message after every outcome (key M), thank-you / door-open / missed-call / nudge templates, "Messages to send" queue with Send all by Gmail, messages counted per session | VERIFIED_FAKE (followups.test.ts, preview) |
| One color system across the app (sales blue, results green, marketing violet, ops teal), tinted tiles, colored menu and section headers | VERIFIED_FAKE (preview screenshots) |
| Dashboards: sparklines on KPIs, visual funnels (Reports, CRM, Command Center, Call summary, Marketing), founder bars instead of tables, weekday columns and trade bars in Email | VERIFIED_FAKE (preview) |

## Feedback round 3 (2026-11-09)
| Change | Status |
|---|---|
| Call mode v2: objections on any outcome (multi-select, keys A–L), live reply in FR/ES, "won over" rate per objection | VERIFIED_FAKE (followups.test.ts, e2e) |
| Live preparation: opener per language, follow-up panel (E email + Calendly, P deck, W WhatsApp, C copy link), suggested action after each outcome, call timer | VERIFIED_FAKE (e2e, preview smoke test) |
| Gmail connection (gmail.send only), send from templates, mail-app/WhatsApp with confirmation, suppression + LSSI checks, idempotent sends | VERIFIED_FAKE (fake Gmail HTTP) — needs real OAuth credentials for VERIFIED_LIVE |
| Marketing › Email: reply-rate benchmarks vs public ranges, by template / language / weekday / niche, one-tap reply marking | VERIFIED_FAKE (playbook.test.ts, followups.test.ts) |
| Settings › Playbook (editable scripts and templates) and Calendly/deck links | VERIFIED_FAKE |
| Reports: blue = volume, teal = conversions, palette validated for colour blindness | VERIFIED_FAKE (preview) |

## Feedback round 2 (2026-11-09)
| Change | Status |
|---|---|
| Call mode: sessions, one-tap outcomes (keys 1–7), objection in one tap, live counters, session summary vs your average | VERIFIED_FAKE (calls.test.ts, e2e) |
| CRM: yes-only pipeline, month funnel strip, call lists with progress, status per business | VERIFIED_FAKE |
| My Day: 14-day streak strip, Sales / Marketing / Ops areas, weekly content ticks; job search removed | VERIFIED_FAKE |
| Tasks: sales / marketing / ops areas | VERIFIED_FAKE |
| Reports: visual dashboard (KPIs + deltas, daily chart, funnel, objections, best hours, country, trade) | VERIFIED_FAKE (dashboard.test.ts) |
| Marketing: overview with recommendations, funnels per brand, traffic sources (GA4 CSV/manual), audience countries vs target | VERIFIED_FAKE (marketing.test.ts) |
| Files: Drive explorer (grid/list, folders, search, recent, new folder, drag-and-drop upload) | VERIFIED_FAKE (fake Drive HTTP) |
No Google credentials exist in the build environment, so nothing is `VERIFIED_LIVE`.

## Gate results
| Check | Result |
|---|---|
| `npm run lint` / `npm run typecheck` | pass |
| `npm test` (vitest: unit, contract, integration on fake Sheets + fake Calendar/Drive HTTP servers) | 139/139 pass |
| `npm run test:e2e` (Playwright, production build, DEMO on fake Sheets + LIVE-without-credentials server) | 17/17 pass |
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
| 16 | Private data unreachable (private tasks; job search removed, D031); dedupe; mid-day goal change | VERIFIED_FAKE | stage1b.test.ts, scenarios.test.ts |
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
| Private founder spreadsheets (private tasks) | VERIFIED_FAKE | needs PRIVATE_SHEET_ID_* in LIVE; job search removed (D031) |
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
