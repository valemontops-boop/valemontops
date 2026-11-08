# Architecture

```
Browser (React, TanStack Query)
  │  polls GET /api/sync every 30–60 s (revision tokens only), refetches on focus, invalidates after writes
  ▼
Next.js route handlers ── route(): setup check → JWE session → same-origin → size limit → Zod → service → error map
  ▼
Services (src/server/services)  ── pure domain rules (src/domain) ──
  ▼
DataRepository ── GoogleSheetsRepository ── SheetsClient (fetch, 10 s timeout, retry 429/5xx with full jitter)
               └─ InMemoryRepository (DEMO, tests)                     └─ Google Sheets API  |  fake server (tests/DEMO)
```

## Sheets contract (spec §4) as implemented
- **Quota.** Polling reads `_Revisions!A1:C14` only, cached 10 s server-side with single-flight, so concurrent clients
  collapse into one call. Tables are re-read per domain (`settings`, `activity`, `crm`, `audit`) with one `values.batchGet`
  only when their token changed or the 3-minute TTL expired (catches manual edits). Writes bump their domain with a new UUID.
  Typical cost: a log = 3–4 calls; a page load after a change = 1–2 calls.
- **Exactly-once.** `ActivityEvents` is append-only. The client generates `idempotency_key` when the logger opens and reuses
  it on retry. The server returns the original event if the key exists (cached and fresh tail check). Every count is derived
  by `dedupeEvents` (earliest `created_at`, then lowest `id`), so a duplicate row from a race cannot change a number.
- **Conditional updates.** Fresh read (cache bypass) → resolve row by scanning ids → compare `version` → write
  `version+1` with a new `write_id` → re-read the row → mismatch = conflict. **Residual risk:** two writers can both pass the
  version check within the same ~100 ms; the second write wins at the cell level, and the first writer's confirmation read
  then sees a foreign `write_id` and reports a conflict. Nothing is silently lost from the user's point of view, but the
  earlier write is overwritten. Prefer append-only events wherever a value can be derived.
- **Creates** carry client/server UUIDs; readers de-duplicate by id, so retried appends are harmless (doctor reports them).
- **Value handling.** All cells written as strings with `RAW`; read with `UNFORMATTED_VALUE` and parsed by Zod codecs.
  Columns resolved by header name; unknown/missing columns and malformed rows become warnings, never crashes.
- **Time.** Day boundaries use each founder's IANA zone. Today's `DailyPlans` snapshot is written on the first My Day read
  of the day (deterministic UUIDv5 id); target and mode edits apply today only while no snapshot exists, else from tomorrow.
- **Setup/doctor.** `setup:sheets` never creates the spreadsheet; it adds tabs, headers, missing columns (right edge),
  frozen header, warning-only protection, TEXT number format, revision rows and seeds. `doctor:sheets` checks access, tabs,
  headers, schema hash, malformed rows, duplicate ids/keys, orphans, cell budget, and a marked round-trip on `_Doctor`.
- **Scale.** 10 M cell workbook limit tracked by doctor. Monthly archiving of `ActivityEvents` is planned before it matters
  (at ~40 columns, 10 M cells ≈ 250 k events).

## Modes
`APP_MODE=live` → Sheets adapter with the service account; missing config → `/setup`, every API returns 503
`setup_required`. `APP_MODE=demo` → in-memory or fake-Sheets backend seeded with synthetic data, permanent banner,
DEMO sign-in (code required in production). Sessions are bound to the mode they were issued in.

## Next.js notes
`cacheComponents` is on. Authenticated UI renders behind `<Suspense>`; server components read the request
(`cookies()`/`connection()`) before reading config so build-time env is never baked into a prerendered shell.
