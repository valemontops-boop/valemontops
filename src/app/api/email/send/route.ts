import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { GMAIL_COOKIE } from "@/server/gmail-grant";
import { sendFollowUp, sendSchema } from "@/server/services/email";

export const POST = route(sendSchema, async ({ app, session, input, req }) => {
  const grant = await unseal<{ t?: string; f?: string }>(req.cookies.get(GMAIL_COOKIE)?.value, getConfig().sessionSecret);
  return sendFollowUp(app, session.founder, grant?.f === session.founder ? grant.t ?? null : null, input);
});
