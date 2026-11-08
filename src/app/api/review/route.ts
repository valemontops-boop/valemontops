import { route } from "@/server/http";
import { getReview, reviewSchema, saveReview } from "@/server/services/results";

export const GET = route(undefined, async ({ app, session }) => ({ review: await getReview(app, session.founder) }));
export const POST = route(reviewSchema, async ({ app, session, input }) => saveReview(app, session.founder, input));
