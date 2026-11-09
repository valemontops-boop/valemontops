import { route } from "@/server/http";
import { syncBank } from "@/server/services/bank";

export const POST = route(undefined, async ({ app, session }) => syncBank(app, { founder: session.founder }));
