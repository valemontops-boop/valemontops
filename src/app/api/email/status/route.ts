import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { GMAIL_COOKIE } from "@/server/gmail-grant";

/** Whether the signed-in founder's Gmail (send only) is connected in this browser. The token itself never leaves the cookie. */
export const GET = route(undefined, async ({ session, req, app }) => {
  const grant = await unseal<{ t?: string; f?: string }>(req.cookies.get(GMAIL_COOKIE)?.value, getConfig().sessionSecret);
  return { connected: Boolean(grant?.t && grant.f === session.founder), mode: app.mode };
});
export const DELETE = route(undefined, async () => {
  const res = NextResponse.json({ connected: false });
  res.cookies.delete(GMAIL_COOKIE);
  return res;
});
