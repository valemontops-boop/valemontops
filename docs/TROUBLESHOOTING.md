# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Setup required" page | LIVE mode with missing/invalid env | The page lists each missing variable. Set them on the host and restart. |
| `doctor:sheets`: Permission denied | Sheet not shared with the service account | Share the Sheet with the `…iam.gserviceaccount.com` address as Editor. |
| `doctor:sheets`: Spreadsheet not found | Wrong `SHEETS_SPREADSHEET_ID` | Copy the id between `/d/` and `/edit` in the Sheet URL. |
| "not one of the two founder addresses" | Signed in with another Google account | Use the address in `FOUNDER_*_EMAIL`, or fix the variable. |
| `redirect_uri_mismatch` from Google | Callback not registered | Add `<APP_BASE_URL>/api/auth/google/callback` to the OAuth client. |
| Header shows "Error: retry" | Sheets unreachable or quota (429) after bounded retries | Click it to retry. Nothing was counted. Retrying a log reuses the same key, so no double count. Check Settings › Diagnostics. |
| Conflict panel when saving | The other founder saved the same record first | Choose "Keep saved version" or "Apply mine on top". |
| Data-integrity warning | A row was edited by hand in the Sheet | Run `npm run doctor:sheets`; fix the named row/column in the Sheet. Columns are matched by header name; do not rename headers. |
| Service account key error | Newlines in the key | Use `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` with `base64 -w0`. |
| DEMO data disappeared | `DEMO_BACKEND=memory` resets on restart | Use `DEMO_BACKEND=fake-sheets` with `npm run fake:sheets` (persists in `.data/`). |
| My Day says "Not a scheduled workday" | Today is not in your workdays | Settings › Profile › Workdays. Changing it does not alter today's locked plan. |
| Target edit "applies from tomorrow" | Today's plan was locked at day start | Intended: a day cannot be passed by editing its goal. |
