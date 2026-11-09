import { route } from "@/server/http";
import { newVersion, versionSchema } from "@/server/services/quotes";

export const POST = route(versionSchema, async ({ repo, session, input }) => newVersion(repo, session.founder, input));
