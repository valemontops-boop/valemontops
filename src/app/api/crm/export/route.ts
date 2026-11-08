import { route } from "@/server/http";
import { exportAccountsCsv } from "@/server/services/imports";

export const GET = route(undefined, async ({ repo }) => {
  const csv = await exportAccountsCsv(repo);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="valemont-accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
