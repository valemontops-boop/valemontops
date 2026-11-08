import { route } from "@/server/http";
import { preview, previewSchema } from "@/server/services/imports";

export const POST = route(previewSchema, async ({ repo, input }) => preview(repo, input.csv));
