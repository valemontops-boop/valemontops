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

/** Settings that may also come from the hosting environment when the Sheet has no value yet (one-time setup). */
export const SETTING_ENV_FALLBACK: Record<string, string> = { drive_folder_id: "DRIVE_FOLDER_ID" };

export async function settingValue(repo: DataRepository, key: string): Promise<string | null> {
  const { rows } = await repo.list("SystemSettings");
  const v = rows.find((r) => r.key === key && !r.is_archived)?.value;
  if (v) return v;
  const env = SETTING_ENV_FALLBACK[key];
  return (env && process.env[env]?.trim()) || null;
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

/** A whole-number setting, or the fallback when missing or not a number. */
export async function numSetting(repo: DataRepository, key: string, fallback: number): Promise<number> {
  const raw = (await settingValue(repo, key))?.trim();
  const n = raw ? Number(raw.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Default deal values per offer (iteration 8), in EUR cents: Consulting value and Local monthly price. */
export async function offerDefaults(repo: DataRepository): Promise<{ consulting: number; local: number }> {
  return { consulting: Math.round((await numSetting(repo, "offer_consulting_value_eur", 1500)) * 100), local: Math.round((await numSetting(repo, "offer_local_monthly_eur", 100)) * 100) };
}
