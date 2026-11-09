# Plan — Stage 1A (first usable day)

Goal: the founders can log outreach tomorrow, with Google Sheets as the only durable store.

## Order of work
1. Docs: CLAUDE.md, PLAN, STATUS, DECISIONS, DESIGN.
2. Pure domain (TDD): activity tally + idempotent dedupe, new-business count, attainment, feasibility,
   suppression block, CSV import dedupe/normalise, CSV export escaping, WhatsApp report, time zones.
3. Data layer: table schemas (Zod) -> `DataRepository` -> `InMemoryRepository`, `GoogleSheetsRepository`
   (thin fetch client: timeouts, bounded retry with jitter, RAW writes, UNFORMATTED reads, revision tokens,
   version + write_id conflict check) -> fake Sheets HTTP server with fault injection -> one contract suite.
4. Scripts: `setup:sheets`, `doctor:sheets`, `fake:sheets`.
5. Server: env/config (LIVE vs DEMO, setup errors), encrypted session (jose), Google OAuth allowlist,
   DEMO sign-in, route helper (auth + Zod + error mapping), services (activities, CRM, targets, import, report).
6. UI: shell (sidebar, header sync state, DEMO banner, quick action, command palette), My Day,
   Sales CRM (opportunities, accounts, right detail panel), CSV import, Settings (profile, targets, channel rules,
   suppression, diagnostics, roadmap), Setup page.
7. Gate: lint, typecheck, vitest, Playwright smoke; scenarios 1, 2, 3, 11, 15 (+14 server block).

## File tree (src/)
```
domain/        pure business rules (no I/O), *.test.ts beside them
data/schema/   table definitions + Zod row schemas
data/          repository.ts, memory.ts, factory.ts, demo-seed.ts
data/sheets/   client.ts, a1.ts, repository.ts, auth.ts
fake-sheets/   server.ts (HTTP fake of the Sheets v4 API)
server/        config.ts, session.ts, auth.ts, http.ts, services/*
app/           (app)/my-day, (app)/crm, (app)/settings, login, setup, api/*
components/    ui/* (shadcn-style primitives), app components
scripts/       setup-sheets.ts, doctor-sheets.ts, fake-sheets.ts
tests/         contract/, integration/, e2e/
```
