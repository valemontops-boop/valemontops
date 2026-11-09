import { z } from "zod";
import { RULE_STATUSES } from "@/domain/constants";
import { route } from "@/server/http";

export const GET = route(undefined, async ({ repo }) => (await repo.list("ChannelRules")).rows);
export const POST = route(
  z.object({ id: z.string().uuid(), expected_version: z.number().int(), status: z.enum(RULE_STATUSES), note: z.string().trim().max(1000), source_url: z.string().trim().max(300), review_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]) }),
  async ({ repo, session, input }) =>
    repo.update("ChannelRules", input.id, input.expected_version, { status: input.status, note: input.note, source_url: input.source_url, review_date: input.review_date || null }, { founder: session.founder }),
);
