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
| Wise (bank, read-only) | VERIFIED_FAKE | Money page and Command Center cash. Env: `WISE_API_TOKEN` (personal API token of the business account, read-only), optional `WISE_PROFILE_ID`, optional `WISE_SCA_PRIVATE_KEY_BASE64` (RSA ≥2048 PEM, its public key uploaded in Wise › Settings › API tokens › Manage public keys) for statements under strong authentication, `WISE_WEBHOOK_PUBLIC_KEY_BASE64` (Wise's production webhook public key, from Wise's webhook docs). Webhook: subscribe `balances#update` to `{APP_BASE_URL}/api/webhooks/wise`. If Wise refuses key signing for the account, balances and live webhooks still work and history comes from a CSV statement export (Money › Import Wise CSV). The token can never move money. |
| Stripe (read-only) | VERIFIED_FAKE | Money page (Stripe balance, sales, fees, payouts) and MRR on Money and the Command Center. Env: `STRIPE_API_KEY` = restricted key with Read on Balance, Balance transactions, Subscriptions, Customers (Stripe › Developers › API keys › Create restricted key); `STRIPE_WEBHOOK_SECRET` of an endpoint `{APP_BASE_URL}/api/webhooks/stripe` listening to charge.*, payout.*, customer.subscription.*, invoice.paid, balance.available. The key cannot create charges or refunds. |
| "To reply" inbox | VERIFIED_FAKE | Relay webhook `{APP_BASE_URL}/api/inbox/webhook` (env `INBOX_WEBHOOK_SECRET`, HMAC-SHA256) and Instagram webhook `{APP_BASE_URL}/api/inbox/meta` (env `META_APP_SECRET`, `META_VERIFY_TOKEN`; needs a Meta app with Instagram messaging/comments permissions and app review). LinkedIn: no API for DMs — email-notification forwarding through a relay, or manual add. Never sends anything: replies are copied and sent by a founder. See docs/INBOX.md. |
| Founder's own tracker | VERIFIED_FAKE | Push every new activity (signed JSON, https only) to `TRACKER_WEBHOOK_URL_<F>` with `TRACKER_WEBHOOK_SECRET_<F>`; pull feed `GET {APP_BASE_URL}/api/tracker/feed` with a bearer `TRACKER_FEED_TOKEN_<F>`; optional `TRACKER_DAILY_SUMMARY_<F>=1`. LIVE only. Settings › My tracker. See docs/TRACKER.md. |
| Websites, GA4 | Not started | Stages 3–4. |
| ECB FX | Not started | Stage 3. |

## Expiring credentials
`drive.file` access tokens last about an hour and live only in an encrypted cookie; expiry means one more consent click.
No token is ever stored in Sheets. The builder's Claude account is never used at runtime.
