import { route } from "@/server/http";
import { callLists } from "@/server/services/calls";

export const GET = route(undefined, async ({ app }) => callLists(app));
