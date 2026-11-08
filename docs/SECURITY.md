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
