import { route } from "@/server/http";
import { priceItemSchema, savePriceItem } from "@/server/services/commercial";

export const POST = route(priceItemSchema, async ({ repo, session, input }) => savePriceItem(repo, session.founder, input));
