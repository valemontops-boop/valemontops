# Security — STRIDE threat model and review (Stage 4B, D084)

Scope: the deployed Next.js app (one Node process per instance), Google Sheets as the only store, the founders'
Google identities, the webhooks and jobs, the browser preview build. Review date 2026-11-09. Findings fixed in this
stage are marked **FIXED (D084)**. Residual risks are listed per component and summarised at the end.

STRIDE = **S**poofing · **T**ampering · **R**epudiation · **I**nformation disclosure · **D**enial of service ·
**E**levation of privilege.

## 1. Authentication and session

| | Threat | Mitigation (file) |
|---|---|---|
| S | Someone signs in as a founder | Google OpenID Connect with PKCE + state cookie, `email_verified` required, allowlist of exactly `FOUNDER_THEO_EMAIL` / `FOUNDER_PABLO_EMAIL` (`src/app/api/auth/google/callback/route.ts`, `src/server/auth.ts`). Scopes `openid email profile` only. |
| S | Forged / replayed session cookie | Stateless JWE (`dir` + A256GCM, key = SHA-256 of `SESSION_SECRET` ≥ 32 chars), 7-day expiry, bound to the app mode (a DEMO session is invalid in LIVE) (`src/server/session.ts`). httpOnly, `SameSite=Lax`, `Secure` in production. |
| T | CSRF on mutations | `route()` refuses cross-site mutations: `Sec-Fetch-Site: cross-site` or an `Origin` whose host differs; a malformed Origin (`null`) is now a 403, not a 500 (**FIXED (D084)**, `src/server/guard.ts › isCrossOrigin`). Sign-out refuses a cross-site post (**FIXED (D084)**, `src/app/api/auth/logout/route.ts`). DEMO sign-in uses the same check. |
| T | Open redirect after consent | `back=/\evil.example.com` was accepted by the Drive/Gmail consent routes and resolved by browsers to another host. Return paths now go through `safeBackPath` (same-site path only) on the start and callback routes (**FIXED (D084)**, `src/app/api/auth/google/{drive,gmail}/…`). |
| E | Test bypass left on | No bypass exists (D011). DEMO sign-in is refused in LIVE and needs `DEMO_ACCESS_CODE` (constant-time compare) on a production DEMO. |
| I | Session theft through XSS | React escaping, no `dangerouslySetInnerHTML` on user data, CSP (below), httpOnly cookie. |
| R | A founder denies an action | Every authenticated mutation is in the AuditLog with actor, time, correlation id (§3). |

Residual: a stolen, unexpired cookie works until expiry (no server-side revocation without a database; rotate
`SESSION_SECRET` to revoke all sessions). Two founders = two equal roles; no admin separation by design.

## 2. Route handlers (`src/app/api/**`, `route()` in `src/server/http.ts`)

| | Threat | Mitigation |
|---|---|---|
| S/E | Unauthenticated access | Every business route uses `route()`: config check → session → same-origin → body cap → Zod → handler. Pages re-check the session server-side; `src/proxy.ts` only redirects early. Role/ownership checks live in services (private tasks, private sheets, suppression for both founders). |
| T | Malformed input, injection | Zod on every input; RAW writes to Sheets (formulas never evaluated, spec 4.5); per-cell size limits; CSV export neutralises `= + - @ tab CR` in free text. |
| D | Huge bodies | Body capped at 1.2 MB **while streaming** and refused from `Content-Length` before reading (**FIXED (D084)**: the body used to be read entirely before the length check). |
| R | Untraceable requests | `x-request-id` from the proxy (or a safe caller value) becomes the correlation id of the structured log line, the error body, the response header and the audit row (`src/server/log.ts`, `src/proxy.ts`). |
| I | Errors leak internals | Error mapping returns fixed messages; unexpected errors log `name/message` redacted and answer "Unexpected error" with the correlation id. |

Residual: API routes have no per-user rate limit (two trusted users; the Sheets quota is the binding limit and its use
is visible in Diagnostics).

## 3. Audit trail and logs

* **AuditLog tab** (append-only): `route()` enqueues one row per authenticated mutation, refused ones included
  (403/409/422), and writes it **after** the response (`after()`), batched (one Sheets append per flush, no revision
  bump: spec 4.1 quota) — `src/server/services/audit-log.ts`. Columns: actor, action (method + path), entity, record id,
  changed **field names**, HTTP status, correlation id, keyed hash of the input, keyed hash of the IP (HMAC with
  `SESSION_SECRET`, 16 hex). Never values, never secrets. Private mutations (private tasks / private sheets) keep only
  actor, action, status and time, and are shown only to their author (spec 4.7). The JSON backup download is audited.
* **Structured logs**: one JSON line per request (`level`, `event`, `correlationId`, method, path, status, ms,
  founder key). `LOG_LEVEL` = debug|info|warn|error|silent. Every payload is redacted: secret-named keys, bearer
  tokens, Stripe/Google/JWT/PEM shapes, long opaque strings, emails, phone numbers (`src/server/log.ts`).

Residual: audit rows still queued in memory are lost if the instance is killed before the flush (the business write
itself is already durable); a founder with Sheet edit rights can alter AuditLog by hand (warning-only protection,
spec 4.9) — the log is a trail for two trusted founders, not tamper-proof evidence.

## 4. Webhooks and jobs (no session: a signature or token authenticates)

All of them now go through `guardInbound` (`src/server/guard.ts`): **per-client rate limit** (120/min webhooks,
30/min jobs, 60/min feeds/health; in-process window from `src/server/rate-limit.ts`) and **streaming size cap**
(**FIXED (D084)**: no rate limit existed, and bodies were read fully before the size check). Nothing touches Sheets
before the signature is verified.

| Endpoint | Authentication | Replay | Size |
|---|---|---|---|
| `/api/webhooks/stripe` | `Stripe-Signature` HMAC-SHA256, constant-time (`src/server/stripe-webhook.ts`) | 5-min timestamp tolerance | 500 kB |
| `/api/webhooks/wise` | RSA-SHA256 with Wise's public key (`src/server/wise-webhook.ts`) | no timestamp in Wise's scheme; events are idempotent by id | 100 kB |
| `/api/inbox/webhook` (relay) | `X-Valemont-Signature` HMAC-SHA256 (`src/server/inbox-webhook.ts`) | idempotent by `external_id` | 200 kB |
| `/api/inbox/meta` (Instagram) | `X-Hub-Signature-256` with `META_APP_SECRET`; GET challenge with `META_VERIFY_TOKEN` | idempotent by item id | 500 kB |
| `/api/webhooks/website` (Stage 4A) | timestamp + HMAC (`src/server/website-webhook.ts`), its own 20/min limiter | 5-min window | capped |
| `/api/jobs/snapshot` | timestamp + HMAC (`SNAPSHOT_JOB_SECRET`) or bearer ≥ 24 chars | 5-min window; idempotent per slot | 10 kB |
| `/api/jobs/backup` | timestamp + HMAC (`BACKUP_JOB_SECRET`) or bearer `BACKUP_JOB_TOKEN` / Vercel `CRON_SECRET` | idempotent per day | 10 kB |
| `/api/tracker/feed` | bearer per founder, constant-time, all founders checked (`src/server/tracker-auth.ts`) | read-only | — |

Secrets are resolved env first, then the connector vault (D087, §12b); the vault read is cached 60 s per instance,
so an unauthenticated flood causes at most one `IntegrationSecrets`/`SystemSettings` read per minute per instance
before verification (no business tab is touched before the signature). Unconfigured secret → the endpoint refuses everything (503). Residual: rate limits are per instance (several
Vercel instances each keep a window; a restart resets it) — an abuse brake, not a guarantee; the client IP comes
from `x-forwarded-for`, trustworthy on Vercel, spoofable on a host without a proxy that overwrites it.

## 5. Google Sheets / Drive service account

| | Threat | Mitigation |
|---|---|---|
| I | Key leaks | Key only in `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` (host env), never in the browser, Sheets or logs (redacted shapes). `build-separation.test.ts` fails on a private key, Google doc URL or token in the repo. |
| E | Service account sees too much | Access is what founders share with it: the main Sheet (Editor), the private sheets (each founder's own), the `Valemont OS` folder (Viewer), the backups folder (Editor). Calendar: free/busy only for the other founder's calendar. Drive writes use the founder's own `drive.file` token, never the service account (spec 4.8). |
| T | Manual edits corrupt rows | Warning-only protection, frozen headers, columns resolved by name, row identity by UUID, `doctor:sheets` (spec 4.9). |
| D | Quota exhaustion | Revision tokens, cached reads, batch I/O, health probe cached 30 s, audit appends batched without revision bumps. |
| R/T | Data loss | Daily Drive copy of the Sheet, verified by tab/row counts, retention N days; JSON copy on demand; tested restore **into a new spreadsheet** (never over live) — `docs/DEPLOYMENT.md › Backups / Restore`. |

Residual: on a personal Google account a service account has no storage quota, so the Drive copy needs a Shared
Drive folder or the founder-owned Apps Script copy (documented); the backup copies hold the same personal data as
the live Sheet and live in the founders' Drive.

## 6. Gmail / Calendar / Drive user tokens

`gmail.send` and `drive.file` are requested incrementally, only by the founder who uses them, and kept in an
encrypted httpOnly cookie (JWE, lifetime of the Google access token, about 1 h) — never in Sheets or logs (`src/server/gmail-grant.ts`, `src/server/drive-grant.ts`).
Gmail headers are stripped of CR/LF; every send passes the suppression hard block. Residual: Google sign-in refresh
is not stored, so consent is asked again after expiry (by design: no token database).

## 7. CSV import / export, Excel and XLS

Imports: 1 MB / 2,000 rows for CSV (`src/domain/csv.ts`), 2 MB / 5,000 rows for LinkedIn XLS/XLSX; every cell is
untrusted text validated by Zod. Exports: formula-injection neutralisation on free text, phones and amounts kept;
private data never exported. Residual: `xlsx` 0.18.5 has known prototype-pollution / ReDoS advisories on crafted
files (see npm audit below); only a signed-in founder can upload, size-capped.

## 8. PDF generation (quotes)

`pdf-lib` on the server (no headless browser), inputs from validated quote rows; the filename is the generated
reference (no header injection); served `inline`/`attachment` to founders only through `route()`.

## 9. External fetches (SSRF)

Every remote call has a timeout (Sheets 10 s, Google 10 s, Stripe/Wise/Instagram 15 s, tracker 5 s, site audit 10 s).
The SEO site audit fetches only https public host names and now follows redirects **by hand, validating each hop
before requesting it** (same host, https, no IP literal / internal name) — previously a redirect to an internal
address was requested before being rejected (**FIXED (D084)**, `src/server/services/seo.ts`). Residual: DNS that
resolves a public name to a private address is not blocked (no resolver pinning).

## 10. Browser and headers (`next.config.ts`)

`Content-Security-Policy` (**FIXED (D084)**, was missing): `default-src 'self'`, scripts and styles from this origin
(`'unsafe-inline'` required by Next's inline bootstrap without nonces; nonces would make every page dynamic, which
`cacheComponents` prerendering forbids), `img-src 'self' data: blob: https:`, `connect-src 'self'`,
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Plus HSTS (2 years,
includeSubDomains), `X-Frame-Options: DENY`, `nosniff`, strict referrer, restrictive permissions policy,
`Cross-Origin-Opener-Policy: same-origin-allow-popups` (Gmail/WhatsApp compose tabs), no `x-powered-by`.
Residual: `'unsafe-inline'` scripts weaken XSS protection compared with nonces.

## 11. Preview build (`preview/`)

A static HTML file with the services and an in-memory repository; no server, no secret, no network except Google
Fonts; `process.env.NODE_ENV` is the only env value bundled. Synthetic data only. It is a review tool, never a
delivery target (spec 3.15).

## 12. Secrets

Environment variables, or the encrypted connector vault for integration keys (§12b, D087: ciphertext only in the
Sheet, key in the environment). `.env.example` lists names, never values. Never in clear in Sheets, logs (redaction), the
browser, the preview or the repository (scan test). Rotation: `docs/INTEGRATIONS.md` (tokens), `docs/DEPLOYMENT.md`
(session secret, job tokens). The building Claude account and its connectors are never used on Valemont's resources.

## 12b. Connector vault (D087: in-app connector setup)

Keys pasted in Settings › Integrations › Configure are stored in the `IntegrationSecrets` tab as AES-256-GCM
ciphertext only (`src/server/vault-crypto.ts`, `src/server/services/vault.ts`). This deliberately amends spec §4 "no
secrets in Sheets": only ciphertext, the key stays in the environment, env variables still win.

| | Threat | Mitigation |
|---|---|---|
| I | The Sheet (or a backup copy / JSON download) leaks | Only ciphertext + 12-byte IV + 128-bit tag + key id + last 4 characters of long values + keyed fingerprint. The key is HKDF-SHA256 from `CONNECTORS_ENCRYPTION_KEY` (32+ random bytes) and never written anywhere but the host env. Non-secret ids (Wise profile, Instagram account, Drive folder, retention) are plain in SystemSettings by design. |
| T | A Sheet editor edits or swaps a ciphertext | GCM authentication with associated data = row id + integration + field + key version: a changed or moved cell fails to decrypt and is shown "unreadable, paste again"; it is never used. Wise's webhook public key is stored encrypted for the same integrity reason. |
| I | The encryption key leaks | Rotate: new key in `CONNECTORS_ENCRYPTION_KEY`, old one in `CONNECTORS_ENCRYPTION_KEY_PREVIOUS`, "Re-encrypt with the new key" (rows carry `key_version`), then rotate the provider keys themselves (a leaked key + a Sheet copy reveals them). Without a dedicated key the key derives from `SESSION_SECRET` (distinct HKDF label): weaker separation, and rotating SESSION_SECRET makes saved keys unreadable (documented trade-off; the hub recommends the dedicated key). An invalid dedicated key blocks writes instead of downgrading. |
| I | A saved value is read back through the app | Write-only API: `GET /api/integrations/vault` returns source, last 4 (values ≥ 16 chars only), who, when, version — never a value; generated secrets are returned once in the generate response. Conflicts (409) carry metadata only. Logs: no bodies + redaction; AuditLog: field names only and no input hash for this path (`isVaultPath`). |
| S/E | Someone else changes connectors | `route()`: founder session, `role === "founder"`, same-origin, Zod; tracker fields always resolve to the signed-in founder's own variables; bootstrap values (APP_MODE, SESSION_SECRET, OAuth client, Sheet id, service account, encryption key…) cannot be stored in the vault. |
| D | Flood of changes | 20 vault changes per founder per minute per instance → 429. |
| R | Who changed a key | AuditLog row per change (actor, action, field names, status) + `updated_by`/`updated_at` on the row. |
| — | DEMO / preview | Random in-memory key per process, never an env key; banner "nothing is really saved"; demo ports never reach a real provider. |

Residual: the decrypted values live in server memory (like env variables) for up to 60 s per cache period; a founder
with the encryption key and the Sheet can read every connector key (they own them anyway).

## Health endpoint exposure

`GET /api/health` is unauthenticated by design (uptime monitors) and answers only `status`, three check words and two
integration counts; `?probe=live` touches nothing. Reasons, timings and integration names are in
`/api/health/details` (founder session).

## npm audit (`npm audit --omit=dev`, 2026-11-09)

3 advisories: `xlsx` (high: prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9; no fix on npm — used
only to read a founder-uploaded legacy `.xls`, capped at 2 MB/5,000 rows; action: switch to the SheetJS CDN build once
reachable), `uuid` < 11.1.1 nested in `exceljs` (moderate GHSA-w5hq-g745-h8pq: missing bounds check when a caller
passes `buf` to v3/v5/v6 — exceljs does not with our input; the only fix downgrades exceljs to 3.4.0, a breaking
change) and `exceljs` itself (moderate, through that `uuid`). No advisory on runtime code we call with untrusted
buffers. Dev-only advisories are not shipped.

## Residual risks (summary)

1. Per-instance rate limits and audit queue (serverless); 2. no session revocation besides rotating `SESSION_SECRET`;
3. `'unsafe-inline'` in CSP; 4. DNS rebinding for the site audit; 5. `xlsx` advisories; 6. Wise webhooks without
a timestamp (idempotent); 7. AuditLog editable by a founder in the Sheet; 8. backups contain personal data (GDPR:
founders are the controllers; retention `BACKUP_RETENTION_DAYS`, deletion = trash the copy and empty Drive trash).
