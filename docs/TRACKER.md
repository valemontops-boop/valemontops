# My tracker — connecting a founder's personal performance app

Each founder can connect their own performance tracker (an app that follows their activity across all their
projects). Valemont OS does not know that app's API, so the connector is generic and works both ways:

- **Push** — every new activity the founder logs is POSTed to the tracker as signed JSON.
- **Pull** — the tracker can read the founder's activity over a period from a feed URL.

Settings › **My tracker** shows the status (connected / not configured, host only, last delivery), what is sent,
**Send a test event**, **Send today's summary** and **Send this period** (backfill). Secrets are never shown.

LIVE only: DEMO data and the browser preview never send anything (CLAUDE.md: DEMO never touches live data).

## Environment variables (never in Sheets, never in code, never in chat)

| Variable | Meaning |
| --- | --- |
| `TRACKER_WEBHOOK_URL_THEO` / `_PABLO` | Endpoint that receives the POSTs. `https://` only (an `http://` URL is refused). |
| `TRACKER_WEBHOOK_SECRET_THEO` / `_PABLO` | Shared secret for the HMAC signature, 16+ characters (`openssl rand -hex 32`). |
| `TRACKER_FEED_TOKEN_THEO` / `_PABLO` | Bearer token for the pull feed, 24+ characters. The token also tells which founder is reading. |
| `TRACKER_DAILY_SUMMARY_THEO` / `_PABLO` | Optional, `1` = also push a day summary when the founder saves the daily review. |

Set them in the host's environment settings and redeploy. Leave them empty to disable.

## Push

`POST <TRACKER_WEBHOOK_URL_…>` for every new `ActivityEvents` row of that founder (all channels: calls, emails,
WhatsApp, LinkedIn, visits, meetings…), right after it is saved. Timeout 5 s, no redirects followed, no retry
from the live hook: a failure never fails or slows the founder's action, it is recorded as the last delivery
(`IntegrationStatuses`, id derived from `integration/tracker/<founder>`) and can be caught up with **Send this period**.

Headers:

```
Content-Type: application/json
X-Valemont-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>
X-Valemont-Idempotency-Key: <event id>
User-Agent: valemont-os-tracker/1
```

Body (activity):

```json
{
  "source": "valemont-os",
  "version": 1,
  "founder": "theo",
  "event": {
    "id": "6f1c3a52-0000-4000-8000-000000000001",
    "type": "connected_call",
    "occurred_at": "2026-11-09T09:12:00.000Z",
    "local_date": "2026-11-09",
    "channel": "phone",
    "outcome": "interested",
    "account": "Plomberie Example",
    "duration_sec": 95,
    "project": "Valemont"
  }
}
```

- `type`: an activity type (`cold_call`, `connected_call`, `voicemail`, `field_visit`, `linkedin_invitation`,
  `linkedin_dm`, `inmail`, `cold_email`, `follow_up`, `reply`, `qualified_conversation`, `comment`, `demo_shown`,
  `meeting_booked`, `meeting_held`, `proposal_sent`, `sale`), or `test` for **Send a test event**.
- `channel`: `phone`, `email`, `linkedin`, `whatsapp`, `in_person`, `field` or `null`.
- `account`: business name only. Empty for numbers outside the CRM and for opted-out businesses. Never a person's
  name, phone number or email.

Body (day summary, idempotency key `summary-<founder>-<date>`):

```json
{
  "source": "valemont-os", "version": 1, "founder": "pablo",
  "summary": { "date": "2026-11-09", "project": "Valemont", "counts": { "connected_call": 6, "cold_call": 14 },
               "outreach": 20, "new_businesses": 12, "conversations": 6, "meetings_booked": 1, "sales": 0 }
}
```

**Send this period** re-sends every activity of the period with the same idempotency keys (event ids), so the
receiver can safely ignore duplicates. Answer any 2xx to acknowledge.

### Verifying the signature (receiver side)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function isFromValemont(rawBody: string, header: string | null, secret: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Compute the HMAC on the raw body bytes, before any JSON parsing.

## Pull feed

```
GET {APP_BASE_URL}/api/tracker/feed?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <TRACKER_FEED_TOKEN_…>
```

- No session cookie: the bearer token authenticates (constant-time comparison) and selects the founder.
  Missing or wrong token → `401`. Bad dates or a period over 400 days → `400`. Defaults: the last 30 days.
- Answer: `{ "source": "valemont-os", "version": 1, "founder": "theo", "project": "Valemont", "from": "…", "to": "…", "events": [ … ] }`
  where each event has exactly the push `event` shape.
- Read-only; the founder's own events only.

## Code

- `src/server/services/tracker.ts` — config, payload, signature, delivery, backfill, feed.
- `src/server/activity-hooks.ts` — fire-and-forget hook called after `logActivity` appends an event (and after the
  daily review is saved). The sink is registered by the LIVE context only (`src/server/repo.ts`).
- `src/server/tracker-auth.ts` — feed token check. Routes: `src/app/api/tracker/route.ts`, `src/app/api/tracker/feed/route.ts`.
- Tests: `tests/integration/export-tracker.test.ts`.
