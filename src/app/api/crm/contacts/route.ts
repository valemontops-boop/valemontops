import { route } from "@/server/http";
import { createContact, createContactSchema, updateContact, updateContactSchema } from "@/server/services/crm";

export const POST = route(createContactSchema, async ({ repo, session, input }) => createContact(repo, session.founder, input));
export const PATCH = route(updateContactSchema, async ({ repo, session, input }) => updateContact(repo, session.founder, input));
