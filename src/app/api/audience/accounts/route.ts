import { route } from "@/server/http";
import { addSocialAccount, listAccounts, socialAccountSchema } from "@/server/services/audience";

export const GET = route(undefined, async ({ app, session }) => listAccounts(app, session.founder));
export const POST = route(socialAccountSchema, async ({ app, session, input }) => addSocialAccount(app, session.founder, input));
