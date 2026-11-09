import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { DRIVE_COOKIE } from "@/server/drive-grant";
import { driveSchema, saveQuoteToDrive } from "@/server/services/quotes";

/** Saves the quote PDF with the founder's own drive.file grant (consent asked when missing; never the service account). */
export const POST = route(driveSchema, async ({ app, session, input, req }) => {
  const grant = await unseal<{ t?: string; f?: string }>(req.cookies.get(DRIVE_COOKIE)?.value, getConfig().sessionSecret);
  return saveQuoteToDrive(app, session.founder, grant?.f === session.founder ? grant.t ?? null : null, input);
});
