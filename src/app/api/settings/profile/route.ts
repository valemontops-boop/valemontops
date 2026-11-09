import { route, RuleError } from "@/server/http";
import { profileSchema } from "@/server/services/myday";
import { userRow } from "@/server/services/common";
import { isValidTimeZone } from "@/domain/time";

export const GET = route(undefined, async ({ repo, session }) => userRow(repo, session.founder));
export const POST = route(profileSchema, async ({ repo, session, input }) => {
  if (!isValidTimeZone(input.timezone)) throw new RuleError("Unknown time zone");
  const u = await userRow(repo, session.founder);
  const { expected_version, ...patch } = input;
  return repo.update("Users", u.id, expected_version, patch, { founder: session.founder });
});
