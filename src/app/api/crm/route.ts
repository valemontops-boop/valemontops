import { route } from "@/server/http";
import { crmSnapshot } from "@/server/services/crm";

export const GET = route(undefined, async ({ repo }) => crmSnapshot(repo));
