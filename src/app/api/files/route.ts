import { z } from "zod";
import { route } from "@/server/http";
import { listFolder } from "@/server/services/files";

export const GET = route(z.object({ folder: z.string().max(200).optional(), q: z.string().max(100).default("") }), async ({ app, input }) => listFolder(app, input.folder ?? null, input.q));
