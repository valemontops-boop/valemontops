import { z } from "zod";
import { WORK_MODES } from "@/domain/constants";
import { route } from "@/server/http";
import { getTargetsForEdit, setTargets, setTargetsSchema } from "@/server/services/myday";

export const GET = route(z.object({ mode: z.enum(WORK_MODES) }), async ({ repo, session, input }) => getTargetsForEdit(repo, session.founder, input.mode));
export const POST = route(setTargetsSchema, async ({ repo, session, input }) => setTargets(repo, session.founder, input));
