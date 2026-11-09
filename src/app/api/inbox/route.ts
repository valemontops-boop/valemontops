import { route } from "@/server/http";
import { addInboxItem, inboxAddSchema, inboxListSchema, inboxStatusSchema, listInbox, setInboxStatus } from "@/server/services/inbox";

export const GET = route(inboxListSchema, async ({ app, session, input }) => listInbox(app, session.founder, input));
export const POST = route(inboxAddSchema, async ({ app, session, input }) => addInboxItem(app, session.founder, input));
export const PATCH = route(inboxStatusSchema, async ({ app, session, input }) => setInboxStatus(app, session.founder, input));
