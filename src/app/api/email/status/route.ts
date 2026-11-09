import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { GMAIL_COOKIE, grantToken, type GmailGrant } from "@/server/gmail-grant";
import { senderAddress } from "@/server/sender";

/** Whether the signed-in founder's Gmail (send only, the sending address — D090) is connected in this browser. The token itself never leaves the cookie. */
export const GET = route(undefined, async ({ session, req, app }) => {
  const grant = await unseal<GmailGrant>(req.cookies.get(GMAIL_COOKIE)?.value, getConfig().sessionSecret);
  const sender = await senderAddress(app.repo);
  return { connected: Boolean(grantToken(grant, session.founder, sender)), mode: app.mode, sender };
});
export const DELETE = route(undefined, async () => {
  const res = NextResponse.json({ connected: false });
  res.cookies.delete(GMAIL_COOKIE);
  return res;
});
