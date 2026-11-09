import { route } from "@/server/http";
import { createAccount, createAccountSchema, updateAccount, updateAccountSchema } from "@/server/services/crm";

export const POST = route(createAccountSchema, async ({ repo, session, input }) => createAccount(repo, session.founder, input));
export const PATCH = route(updateAccountSchema, async ({ repo, session, input }) => updateAccount(repo, session.founder, input));
