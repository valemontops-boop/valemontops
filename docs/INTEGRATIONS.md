# Integrations — honest status (Stage 1A)

| Integration | Status | Notes |
|---|---|---|
| Google Sheets | Needs setup | Service account + shared Sheet. Verified against the fake server only. |
| Google Sign-In | Needs setup | OAuth client, two allowlisted founders, basic scopes only. |
| Google Calendar, Drive, Gmail | Not started | Stage 1B (Calendar/Drive via shared calendar/folder), Gmail optional Stage 4. |
| LinkedIn / Sales Navigator | Manual logging | Manual logger and click-to-open only. No scraping, no automated messaging. Statistics: Import-only (Stage 1B). |
| Instagram, websites, payments, banking, GA4 | Not started | Stages 3–4. |
| ECB FX | Not started | Stage 3. |

No connector of the Claude account that builds this app is used at runtime. Every identity is supplied by the founders
through environment variables.
