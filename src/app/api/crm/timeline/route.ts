import { z } from "zod";
import { route } from "@/server/http";
import { accountTimeline } from "@/server/services/crm";

export const GET = route(z.object({ account_id: z.string().uuid() }), async ({ repo, input }) => accountTimeline(repo, input.account_id));
