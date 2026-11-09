import { route } from "@/server/http";
import { diagnostics } from "@/server/services/diagnostics";

export const GET = route(undefined, async ({ repo }) => diagnostics(repo));
