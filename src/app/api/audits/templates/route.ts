import { route } from "@/server/http";
import { listTemplates } from "@/server/services/audits";

export const GET = route(undefined, async ({ repo }) => listTemplates(repo));
