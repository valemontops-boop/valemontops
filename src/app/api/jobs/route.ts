import { route } from "@/server/http";
import { jobSchema, listJobs, saveJob } from "@/server/services/jobs";
import { z } from "zod";

export const GET = route(undefined, async ({ app, session }) => listJobs(app, session.founder));
export const POST = route(jobSchema.extend({ expected_version: z.number().int().optional() }), async ({ app, session, input }) => saveJob(app, session.founder, input));
