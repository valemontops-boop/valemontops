# Valemont OS — working rules for Claude Code

Spec: `docs/VALEMONT_OS_CLAUDE_CODE_MASTER_PROMPT.md` (binding). Resume from `docs/STATUS.md`, `docs/DECISIONS.md`, this file.

## Non-negotiables
- Google Sheets is the ONLY durable business store. No Supabase/Firebase/Postgres/SQLite/localStorage as truth.
- All business code goes through `DataRepository` (`src/data/repository.ts`): `GoogleSheetsRepository` (live) and
  `InMemoryRepository` (demo/tests). One contract suite (`tests/contract/`) runs against both.
- Writes: `valueInputOption=RAW`, every cell a string; reads `UNFORMATTED_VALUE` + Zod. Never strip `+ - = @`.
- Activity = one append-only `ActivityEvents` row with a client `idempotency_key`; all counts are DERIVED and deduped.
- Mutable rows: `expected_version` → fresh read → version check → write `version+1` + `write_id` → confirm. Conflict = 409 shown to the user.
- Row identity is a UUID, never a row number. Columns are resolved by header name.
- LIVE without credentials → setup error. NEVER fall back to DEMO. DEMO is always bannered and never touches live data.
- Opt-out / suppression = hard block on the server for both founders.
- Call mode: one tap = one event; refusals from free dialling store only `target_key` (HMAC), never the number.
- Private data (PrivateTasks) only in each founder's own spreadsheet (`ctx.privateRepo`). The other founder's
  calendar is read as free/busy only. Partial updates use `patchOf()` (zod v4 `.partial()` keeps defaults!).
- Server-side auth + Zod on every route (`src/server/http.ts` `route()`), same-origin check on mutations.
- No real emails, IDs, handles or tokens in code/fixtures (`tests/integration/build-separation.test.ts`). Fixtures use example.com.
- The building Claude account/connectors are NEVER used on Valemont's real resources (spec §3.15).
- UI in English. Design tokens and limits in `docs/DESIGN.md` (≤5 numbers, ≤1 chart, accent ≤2, one ink block).
- No inert buttons: later-stage modules stay out of navigation; list them in Settings › Roadmap.
- Status words: VERIFIED_LIVE / VERIFIED_FAKE / PARTIAL / NOT_STARTED / BLOCKED. Nothing is VERIFIED_LIVE without real credentials.

## Commands
- `npm run dev` (needs `.env.local`, see `.env.example`) · `npm run build` · `npm start`
- `npm run check` = lint + typecheck + unit/integration (`vitest`)
- `npm run test:e2e` (Playwright; builds must be fresh: `npm run build` first) · `npm run test:live` (gated, NOT RUN without creds)
- `npm run fake:sheets` (local fake Sheets API on :4010) · `npm run setup:sheets` · `npm run doctor:sheets`

## Where things live
- `src/domain/` pure business rules + tests (tally, attainment, suppression, CSV, report, time zones)
- `src/data/schema/tables.ts` all tabs and columns · `src/data/sheets/` client, adapter, setup, doctor
- `src/fake-sheets/server.ts` fake Sheets HTTP API with fault injection
- `src/server/` config, session (jose JWE cookie), auth, `route()` helper, `context.ts` (repos + Google ports), `services/*`
- `src/data/google/` Calendar/Drive ports + adapters · `src/fake-google/` store + HTTP fake · `preview/` browser preview build
- `src/app/(app)/` pages (My Day, CRM, Import, Settings) · `src/app/api/` route handlers · `src/components/`
- Next.js 16.4 with `cacheComponents`: read the request (`cookies()`/`connection()`) BEFORE reading config in server components,
  otherwise prerender bakes build-time env into the static shell. Read `node_modules/next/dist/docs/` before using new APIs.
