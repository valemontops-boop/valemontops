import type { DataRepository } from "@/data/repository";
import type { Row } from "@/data/schema/tables";
import type { FounderKey } from "@/domain/constants";

/**
 * After-append hooks (iteration 8: every activity is also sent to the founder's own tracker).
 * A sink is registered by the LIVE context only (never in DEMO or the browser preview). Emitting is
 * fire-and-forget: a sink that throws or hangs can never fail or slow the founder's action.
 */
export interface ActivitySink {
  activity(repo: DataRepository, founder: FounderKey, event: Row<"ActivityEvents">, accountName: string): Promise<unknown>;
  dailyReview?(repo: DataRepository, founder: FounderKey, localDate: string): Promise<unknown>;
}

// On globalThis: the context that registers it is cached there too (dev reloads keep both in step).
const g = globalThis as unknown as { __valemontActivitySink?: ActivitySink | null };
export function setActivitySink(s: ActivitySink | null) {
  g.__valemontActivitySink = s;
}

const swallow = (p: () => Promise<unknown> | undefined) => {
  try {
    void p()?.catch(() => undefined);
  } catch {
    // never propagate
  }
};

export function emitActivityLogged(repo: DataRepository, founder: FounderKey, event: Row<"ActivityEvents">, accountName: string) {
  const s = g.__valemontActivitySink;
  if (s) swallow(() => s.activity(repo, founder, event, accountName));
}

export function emitDailyReviewSaved(repo: DataRepository, founder: FounderKey, localDate: string) {
  const s = g.__valemontActivitySink;
  if (s?.dailyReview) swallow(() => s.dailyReview?.(repo, founder, localDate));
}
