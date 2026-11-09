import type { DataRepository } from "@/data/repository";
import { TABLE_NAMES } from "@/data/schema/tables";

export async function diagnostics(repo: DataRepository) {
  const all = await repo.listMany(TABLE_NAMES);
  const tables = TABLE_NAMES.map((t) => ({ table: t, rows: all[t].rows.length, warnings: all[t].warnings.length, fetchedAt: all[t].fetchedAt }));
  return {
    adapter: repo.kind,
    stats: repo.stats(),
    revisions: await repo.revisions(),
    tables,
    warnings: TABLE_NAMES.flatMap((t) => all[t].warnings).slice(0, 50),
  };
}
