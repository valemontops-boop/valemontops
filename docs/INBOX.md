# "To reply" inbox

The daily task "reply to the business accounts' comments and messages" is backed by an inbox that **signals**
what is waiting and **suggests** an answer. It never answers by itself: every outbound message is an explicit
human action (spec 4.15). LinkedIn has no messaging API, and Meta only allows automated replies after an app review,
so the app copies a ready reply in the founder's language (Théo French, Pablo Spanish, D053) and opens the conversation;
the founder pastes and sends it.

Where it shows: My Day (compact "À répondre / Por responder" panel, only when something waits), a count next to the
notification bell, and the full list in Growth › Messages (scope Team / Me, manual "Add").

Status: VERIFIED_FAKE (unit + fake Sheets tests). Nothing here is VERIFIED_LIVE until the webhooks are wired with real credentials.

## Data

Tab `InboxItems` (domain `work`): `source` (instagram_comment, instagram_dm, linkedin_comment, linkedin_message,
email_reply, whatsapp, website_form, other), `account_label` (which of our six social accounts or mailbox), `from_name`,
`excerpt` (≤ 500 chars), `url` (deep link; http(s) only), `received_at`, `status` (to_reply, replied, ignored),
`assigned_founder` (empty = both), `replied_at`, `external_id`. Row id = UUIDv5 of `external_id`: a webhook delivered
twice, or the same comment pushed by two relays, is stored once. "Replied" / "Ignored" on a stored row is a versioned
update (409 if the other founder changed it meanwhile).

### Signals derived from data we already have (no integration needed)

Computed on every read (`deriveInboxItems`, src/domain/inbox.ts), last 14 days:

- **Email replies** — an `EmailSends` row marked "Interested" or "Replied" (Growth › Messages) with no later message, call or visit to that business.
- **WhatsApp replies** — same rule for WhatsApp sends.
- **LinkedIn replies** — an `ActivityEvents` "reply" on channel LinkedIn with no later touch.
- **Website leads** — an `Accounts` row with lead type inbound, status new, a lead source mentioning the website/form, and no touch yet.

A derived item gets its own `InboxItems` row only when a founder marks it replied or ignored.

## Webhook for relays (Make, Zapier, n8n)

`POST {APP_BASE_URL}/api/inbox/webhook`

- Header `X-Valemont-Signature: sha256=<hex HMAC-SHA256 of the raw body with INBOX_WEBHOOK_SECRET>` (bare hex accepted).
  Compared in constant time. If `INBOX_WEBHOOK_SECRET` is not set, every call is refused (503).
- Body: one item, or `{ "items": [ … ] }` (max 50):

```json
{
  "source": "instagram_comment",
  "external_id": "ig_comment:17895695668004550",
  "account_label": "Instagram Valemont",
  "from_name": "@client_demo",
  "excerpt": "C'est combien ?",
  "url": "https://www.instagram.com/p/EXAMPLE/",
  "received_at": "2026-11-09T10:15:00Z",
  "assigned_founder": null
}
```

- `external_id` must be stable for the same comment/message (it is the dedupe key). Responses: 200 `{ ok, added, duplicates }`,
  400 invalid body, 401 bad signature, 503 not configured or storage error (the relay should retry).
- Make: HTTP module, body = JSON string, header value `sha256={{sha256(body; "hex"; INBOX_WEBHOOK_SECRET)}}` (HMAC function).
  Zapier: "Code by Zapier" step computing `crypto.createHmac('sha256', secret).update(body).digest('hex')`, then a Webhooks POST.
  n8n: Crypto node (HMAC, SHA256, hex) then HTTP Request.

## Instagram (Meta webhook)

`GET/POST {APP_BASE_URL}/api/inbox/meta`

1. Create a Meta app (Business type) owned by Valemont's Business Manager — never the building account (spec 3.15).
   Add the "Instagram" product (Instagram API with Instagram Login, or via the Facebook Page linked to each Instagram professional account).
2. Webhooks › Instagram: callback URL `{APP_BASE_URL}/api/inbox/meta`, verify token = the value of `META_VERIFY_TOKEN`
   (any random string you choose). Meta calls `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`; the app echoes
   the challenge only when the token matches.
3. Subscribe the fields `comments` and `messages` for both Instagram accounts (Valemont, 30/30 AI). Permissions:
   `instagram_business_manage_comments`, `instagram_business_manage_messages` (or the Graph-API equivalents). Live delivery
   for accounts other than the app's testers requires Meta's app review.
4. Env: `META_APP_SECRET` (App settings › Basic › App secret) verifies `X-Hub-Signature-256`; `META_VERIFY_TOKEN`.
5. Optional: name the accounts — Settings value `instagram_account_labels` = `{"<instagram account id>": "Instagram Valemont", "<id>": "Instagram 30/30 AI"}`.
   Without it, items say "Instagram".

Comments become `instagram_comment` (our own comments skipped), messages become `instagram_dm` (echoes of our own
messages skipped). The Instagram webhook does not give a direct link to a comment, so "Open" goes to Instagram
(DMs to the Instagram inbox).

Alternative without a Meta app: a Make/Zapier "Instagram for Business › Watch comments" scenario posting to `/api/inbox/webhook`.

## LinkedIn

No API for personal messages or page comments notifications usable by us. Two options:

- **Email notifications** — LinkedIn emails each new message/comment. A Gmail filter forwards them to a Make/Zapier mailbox
  trigger ("Email by Zapier" / Make "Mailhook") that parses sender + excerpt and posts a `linkedin_message` /
  `linkedin_comment` item with `external_id` = the notification's Message-ID and `url` = the link in the email.
- **Manual** — "Add" in Growth › Messages, or log the LinkedIn reply as an activity (it then appears automatically).

## Gmail and WhatsApp

The app has send-only Gmail access (`gmail.send`, D059) and never reads the inbox. Replies are marked by the founders
in Growth › Messages ("Interested", "Replied"); every marked reply without a follow-up appears here automatically, with
"Open" pointing to a Gmail search on the address (email) or wa.me (WhatsApp). A Gmail filter → relay → webhook can be
added the same way as LinkedIn if the founders want replies flagged before they mark them.

## Suggested replies

Three templates per item, in the founder's language, formal "vous"/"usted" for prospects: thank-you (comments),
price question (detected on words like prix, tarif, combien, precio, cuánto), invitation to book a 15-minute call with the
founder's Calendly link (Settings `calendly_url_theo` / `calendly_url_pablo`). The best fit is first; "Copy a reply"
opens the conversation and copies it.
