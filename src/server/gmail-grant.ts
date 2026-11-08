/** Encrypted httpOnly cookie holding the founder's own gmail.send access token. Never stored server-side, never in Sheets. */
export const GMAIL_COOKIE = "vos_gmail";
/** Send only: the app never reads the founder's inbox (spec 4.15). */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
