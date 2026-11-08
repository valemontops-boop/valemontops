# Security (Stage 1A controls)

Full STRIDE threat model, security review and hardening are Stage 4. Controls in place now:

- **Authentication.** Google OpenID Connect with PKCE + state cookie; `email_verified` required; allowlist of exactly
  `FOUNDER_THEO_EMAIL` and `FOUNDER_PABLO_EMAIL`; scopes `openid email profile` only.
- **Session.** Stateless JWE (A256GCM, key = SHA-256 of `SESSION_SECRET`), httpOnly, `SameSite=Lax`, `Secure` in production,
  7-day expiry, bound to the app mode (a DEMO session is invalid in LIVE). No auth database.
- **Authorization.** Every API route goes through `route()` (`src/server/http.ts`): session check server-side, Zod validation,
  1.2 MB body limit, same-origin check on mutations (CSRF), structured log without bodies or personal data.
  Pages re-check the session server-side; `proxy.ts` is only a fast redirect.
- **No test bypass exists** (D011). DEMO sign-in is disabled in LIVE and needs `DEMO_ACCESS_CODE` in production (constant-time compare).
- **Secrets** only in environment variables; the service-account key never reaches the browser or the Sheet.
  `build-separation.test.ts` fails if a real email, Google doc id, private key or token appears in the repo.
- **Sheets injection.** RAW writes (formulas are never evaluated); CSV export escapes leading `= + - @ tab CR` in free text;
  CSV import treats every cell as untrusted and validates with Zod; per-cell size limits below the 50,000-char Sheets limit.
- **Headers.** `X-Frame-Options: DENY`, `nosniff`, strict referrer, restrictive permissions policy, no `x-powered-by`.
- **Privacy.** Opt-out and suppression are hard blocks for both founders. `AuditLog` records field names, never values.
  Channel rules are informational and explicitly not legal advice. Personal job-search data is not in this stage.

Residual risks to address in Stage 4: rate limiting of API routes, CSP, audit of all mutations (activity events are
their own trail), GDPR export/delete tooling, dependency audit (`npm audit` reports advisories in dev dependencies).

## Stage 1B additions
- Private founder data lives in separate spreadsheets; the other founder's calendar is read with free/busy only (no titles).
- Drive writes use the founder's own `drive.file` token in an encrypted httpOnly cookie, never the service account.
- Gmail uses `gmail.send` only, with the founder's own short-lived token in an encrypted httpOnly cookie (`vos_gmail`); the token is never written to Sheets or logs, the app cannot read any mailbox, and every send passes the suppression hard block (typed address included) and the Spanish cold-email consent rule. Headers are stripped of CR/LF (no header injection). Mail-app and WhatsApp links count only after the founder confirms.
- `npm audit --omit=dev` (2026-11-08): `xlsx` 0.18.5 (high: prototype pollution / ReDoS on crafted files), used only to read
  legacy `.xls` LinkedIn exports uploaded by a signed-in founder, capped at 2 MB and 5,000 rows (D020); `uuid` nested in
  `exceljs` (moderate: buffer bounds in v3/v5/v6 with a caller-supplied buffer, a path exceljs does not take with our input).
  Action: replace with the current SheetJS build from cdn.sheetjs.com once that host is reachable.
