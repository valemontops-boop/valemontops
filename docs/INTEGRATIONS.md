# Integrations — honest status (Stage 1B)

| Integration | Status | Notes |
|---|---|---|
| Google Sheets | Needs setup | Service account + shared Sheet (+ one private Sheet per founder). Verified against the fake server only. |
| Google Sign-In | Needs setup | OAuth client, two allowlisted founders, basic scopes only. |
| Google Calendar | Needs setup | Shared "Valemont" calendar + personal calendars shared with the service account; ids in Settings › Calendars. Other founder's calendar read as free/busy only. |
| Google Drive | Needs setup | Read: folder shared with the service account (Viewer). Write: each founder's own `drive.file` grant, asked at first upload. Picker not wired yet. |
| LinkedIn statistics | Import-only | Page export (.xls) and creator export (.xlsx) through Marketing › Import. API adapter only after Community Management API approval. |
| LinkedIn / Sales Navigator outreach | Manual logging | Logger + click-to-open. No scraping, no automated messaging. |
| Instagram statistics | Manual logging | Manual entry now; API adapter + 6-hourly snapshot job in Stage 3. |
| Gmail (send only) | VERIFIED_FAKE | Opt-in per founder from Call mode or Marketing › Email. Scope `gmail.send` only (no inbox read). Add the scope to the OAuth consent screen and `{APP_BASE_URL}/api/auth/google/gmail/callback` to the client's redirect URIs. With an External app in Testing, consent is re-asked often (tokens are online, about 1 h) and the scope needs Google verification for Production; a Workspace Internal app avoids both. |
| Websites, payments, banking, GA4 | Not started | Stages 3–4. |
| ECB FX | Not started | Stage 3. |

## Expiring credentials
`drive.file` access tokens last about an hour and live only in an encrypted cookie; expiry means one more consent click.
No token is ever stored in Sheets. The builder's Claude account is never used at runtime.
