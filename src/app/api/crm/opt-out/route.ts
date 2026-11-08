import { route } from "@/server/http";
import { optOutContact, optOutSchema } from "@/server/services/crm";

export const POST = route(optOutSchema, async ({ repo, session, input }) => optOutContact(repo, session.founder, input));
