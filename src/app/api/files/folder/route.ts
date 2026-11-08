import { route } from "@/server/http";
import { getConfig } from "@/server/config";
import { unseal } from "@/server/session";
import { createFolder, folderSchema } from "@/server/services/files";
import { DRIVE_COOKIE } from "@/server/drive-grant";

export const POST = route(folderSchema, async ({ app, session, input, req }) => {
  const grant = await unseal<{ t?: string; f?: string }>(req.cookies.get(DRIVE_COOKIE)?.value, getConfig().sessionSecret);
  return createFolder(app, session.founder, grant?.f === session.founder ? grant.t ?? null : null, input);
});
