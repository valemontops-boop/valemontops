import { route } from "@/server/http";
import { commercialOverview } from "@/server/services/commercial";

/** Settings › Commercial: price book (current + versions), policy, taxes, legal details, recent changes. */
export const GET = route(undefined, async ({ repo }) => commercialOverview(repo));
