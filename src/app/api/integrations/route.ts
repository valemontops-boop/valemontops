import type { NextRequest } from "next/server";
import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { GMAIL_COOKIE } from "@/server/gmail-grant";
import { DRIVE_COOKIE } from "@/server/drive-grant";
import { integrationHub } from "@/server/services/integrations";

/** Whether this browser holds the founder's own grant cookie. The token itself never leaves the cookie. */
async function grant(req: NextRequest, cookie: string, founder: string) {
  const g = await unseal<{ t?: string; f?: string }>(req.cookies.get(cookie)?.value, getConfig().sessionSecret);
  return Boolean(g?.t && g.f === founder);
}

/** Settings › Integrations (spec 7, D083): honest status of every integration; env names only, never values. */
export const GET = route(undefined, async ({ app, session, req }) =>
  integrationHub(app, session.founder, { gmail: await grant(req, GMAIL_COOKIE, session.founder), drive: await grant(req, DRIVE_COOKIE, session.founder) }),
);
