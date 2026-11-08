import { route } from "@/server/http";

/** Polling endpoint: one small cached range of revision tokens (spec 4.1). */
export const GET = route(undefined, async ({ repo }) => ({ revisions: await repo.revisions(), at: new Date().toISOString() }));
