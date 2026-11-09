/**
 * The connector configuration every integration reads (D087): environment variable first, then the in-app value
 * (vault secret or plain setting) loaded by `refreshConnectorEnv` (services/vault.ts). This module only holds the
 * process-wide cache and the synchronous view of it; it has no Node-only import (the browser preview bundles it).
 *
 * The cache is refreshed by getContext() at most every TTL_MS (and immediately after a save on this instance; other
 * server instances pick a change up within TTL_MS). Values are kept in memory only, like environment variables.
 */
type Env = Record<string, string | undefined>;

export const CONNECTOR_TTL_MS = 60_000;

interface Cache {
  at: number;
  /** Repository the values were read from (a different repository = a different store). */
  owner: object | null;
  values: Record<string, string>;
  unreadable: string[];
  stale: boolean;
}
const g = globalThis as unknown as { __valemontConnectors?: Cache };
const empty = (): Cache => ({ at: 0, owner: null, values: {}, unreadable: [], stale: true });
const cache = () => (g.__valemontConnectors ??= empty());

const processEnv = (): Env => (typeof process !== "undefined" && process.env ? process.env : {});

/** True when the cache is recent enough for this repository. */
export function connectorCacheFresh(owner: object, now = Date.now()): boolean {
  const c = cache();
  return !c.stale && c.owner === owner && now - c.at < CONNECTOR_TTL_MS;
}
export function setConnectorCache(owner: object, values: Record<string, string>, unreadable: string[], now = Date.now()) {
  g.__valemontConnectors = { at: now, owner, values, unreadable, stale: false };
}
/** After a save: the next getContext() reloads (this instance). */
export function invalidateConnectorCache() {
  cache().stale = true;
}
/** Tests. */
export function resetConnectorCache() {
  g.__valemontConnectors = empty();
}

/** Merged view: in-app values overlaid by every non-empty environment variable (env wins, unchanged behaviour). */
export function connectorEnvSync(env: Env = processEnv()): Env {
  const out: Env = { ...cache().values };
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v.trim() !== "") out[k] = v;
  return out;
}

/** Where a variable comes from: "env" (host environment, wins), "app" (saved in the app), or null. */
export function connectorSource(name: string, env: Env = processEnv()): "env" | "app" | null {
  if (env[name]?.trim()) return "env";
  return cache().values[name] ? "app" : null;
}

/** Names stored in the app that could not be decrypted with the current keys. */
export const unreadableConnectors = () => [...cache().unreadable];
