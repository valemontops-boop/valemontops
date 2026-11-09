import { createHash, timingSafeEqual } from "node:crypto";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { connectorEnvSync } from "./connector-env";

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Pull feed authentication: `Authorization: Bearer <TRACKER_FEED_TOKEN_THEO | _PABLO>` (24+ characters).
 * Constant-time comparison of SHA-256 digests (equal lengths whatever the input). Returns the founder or null.
 */
export function founderForFeedToken(authorization: string | null, env: Record<string, string | undefined> = connectorEnvSync()): FounderKey | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  if (!m) return null;
  const given = digest(m[1]);
  let found: FounderKey | null = null;
  for (const f of FOUNDERS) {
    const expected = (env[`TRACKER_FEED_TOKEN_${f.toUpperCase()}`] ?? "").trim();
    // Check every founder (no early exit) so timing does not reveal which token exists.
    if (expected.length >= 24 && timingSafeEqual(given, digest(expected)) && !found) found = f;
  }
  return found;
}
