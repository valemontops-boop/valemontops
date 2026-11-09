import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { GMAIL_COOKIE, grantToken, type GmailGrant } from "@/server/gmail-grant";
import { senderAddress } from "@/server/sender";
import { sendFollowUp, sendSchema } from "@/server/services/email";

export const POST = route(sendSchema, async ({ app, session, input, req }) => {
  const grant = await unseal<GmailGrant>(req.cookies.get(GMAIL_COOKIE)?.value, getConfig().sessionSecret);
  // D090: only a grant of the Valemont sending address sends (a cookie from another mailbox counts as not connected).
  const token = grantToken(grant, session.founder, await senderAddress(app.repo));
  return sendFollowUp(app, session.founder, token, input);
});
