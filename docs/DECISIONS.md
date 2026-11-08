# Decisions

One line each: what — why — how to reverse.

- D001 Next.js 16.4 App Router with `cacheComponents` (scaffold default); session reads live behind `<Suspense>` — current stable — remove flag in next.config.ts.
- D002 shadcn/ui primitives hand-written on `radix-ui` in `src/components/ui` — the shadcn registry (ui.shadcn.com) is unreachable from the build sandbox — run `npx shadcn add <c>` later and replace files one by one.
- D003 Sheets accessed through a thin `fetch` client (`src/data/sheets/client.ts`) instead of the `googleapis` package — full control of timeouts/retries and the same code path hits the fake server; tokens from `google-auth-library` — swap for `@googleapis/sheets` behind the same interface.
- D004 Every cell is written as a string with `valueInputOption=RAW` and parsed back through Zod — guarantees `+336…`, `-12.00`, `=SUM(A1)` survive unchanged — n/a (spec 4.5).
- D005 Columns are resolved by header name, not position; a missing header is an integrity warning — survives humans moving columns — n/a.
- D006 Creates use client/server-generated UUIDs and readers de-duplicate by `id` (earliest `created_at`), so a retried append cannot create a second logical record — makes append retry-safe without locks — n/a.
- D007 Activity events are their own audit trail (append-only); `AuditLog` records other mutations with field names only, never values — saves one Sheets call per log and keeps personal data out of logs — append an AuditLog row in `logActivity`.
- D008 Targets and work modes are append-only rows with `effective_from`; edits apply today only if today's `DailyPlans` snapshot does not exist yet, otherwise from tomorrow — spec 5.3 "plan snapshot at day start" — n/a.
- D009 The day plan snapshot is written lazily on the first My Day read of a scheduled local day (deterministic UUIDv5 id, earliest row wins) — no cron (spec 4.6) — n/a.
- D010 DEMO sign-in (pick Théo or Pablo, synthetic data) exists only when `APP_MODE=demo`; in production it additionally requires `DEMO_ACCESS_CODE` — makes the app usable before credentials exist without an auth bypass — remove `/api/auth/demo`.
- D011 No test-auth bypass is implemented at all; e2e tests use DEMO sign-in, service tests call services with an explicit actor — nothing to leak into production — n/a.
- D012 DEMO data can be served by the in-memory repository (`DEMO_BACKEND=memory`, default) or by the real Sheets adapter pointed at the local fake server (`DEMO_BACKEND=fake-sheets`) — exercises the whole Sheets path without credentials — n/a.
- D013 Stage 1A creates only the tabs it uses (listed in docs/SCHEMA.md); later stages add tabs through `setup:sheets` migrations — avoids designing 60 empty schemas now — n/a.
- D014 Private job-search data (separate spreadsheet per founder) is Stage 1B; Stage 1A has no job-application counter, so nothing private is in the shared Sheet — n/a.
- D015 Opt-out reversal is not offered in Stage 1A UI; suppression entries are append-only — safest default for a hard block — add an audited "lift with consent evidence" action in 1B.
- D016 Skills from spec §1 were loaded selectively (installed Next.js docs read directly) to keep context for implementation — n/a.
