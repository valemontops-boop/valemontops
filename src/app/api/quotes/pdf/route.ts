import { z } from "zod";
import { route } from "@/server/http";
import { quotePdf } from "@/server/services/quotes";

/** Quote PDF (Node runtime, pdf-lib). Missing required fields → 422 naming them; never a placeholder. */
export const GET = route(z.object({ id: z.string().uuid(), download: z.enum(["0", "1"]).default("0") }), async ({ repo, input }) => {
  const { bytes, filename } = await quotePdf(repo, input.id);
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${input.download === "1" ? "attachment" : "inline"}; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
