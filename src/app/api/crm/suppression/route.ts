import { route } from "@/server/http";
import { addSuppression, suppressSchema } from "@/server/services/crm";

export const POST = route(suppressSchema, async ({ repo, session, input }) => addSuppression(repo, session.founder, input));
