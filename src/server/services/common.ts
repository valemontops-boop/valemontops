import type { DataRepository } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import type { FounderKey } from "@/domain/constants";
import { STAGE_PROBABILITY_SEED, type Stage } from "@/domain/constants";
import { NotFoundError } from "@/data/repository";

export async function userRow(repo: DataRepository, founder: FounderKey): Promise<Row<"Users">> {
  const { rows } = await repo.list("Users");
  const u = rows.find((r) => r.founder_key === founder && !r.is_archived);
  if (!u) throw new NotFoundError("Users", founder);
  return u;
}

export async function settingValue(repo: DataRepository, key: string): Promise<string | null> {
  const { rows } = await repo.list("SystemSettings");
  return rows.find((r) => r.key === key && !r.is_archived)?.value ?? null;
}

export async function stageProbabilities(repo: DataRepository): Promise<Record<Stage, number>> {
  const raw = await settingValue(repo, "stage_probabilities");
  if (!raw) return STAGE_PROBABILITY_SEED;
  try {
    return { ...STAGE_PROBABILITY_SEED, ...(JSON.parse(raw) as Partial<Record<Stage, number>>) };
  } catch {
    return STAGE_PROBABILITY_SEED;
  }
}
