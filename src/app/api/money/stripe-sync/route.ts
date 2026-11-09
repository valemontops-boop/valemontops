import { route } from "@/server/http";
import { syncStripe } from "@/server/services/bank";

export const POST = route(undefined, async ({ app, session }) => syncStripe(app, { founder: session.founder }));
