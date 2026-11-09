import { route } from "@/server/http";
import { categorySchema, setCategory } from "@/server/services/bank";

export const PATCH = route(categorySchema, async ({ app, session, input }) => setCategory(app, session.founder, input));
