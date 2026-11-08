import { z } from "zod";
import { route } from "@/server/http";
import { whatsappReport } from "@/server/services/myday";

export const POST = route(z.object({ next_day_priority: z.string().trim().max(300).default("") }), async ({ repo, session, input }) => ({
  text: await whatsappReport(repo, session.founder, input.next_day_priority),
}));
