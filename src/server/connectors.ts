import "server-only";
import { fieldOf, type ConnectorKey } from "@/domain/connectors";
import { connectorEnvSync } from "./connector-env";
import { getContext } from "./repo";

type Env = Record<string, string | undefined>;

/**
 * The one resolver for connector configuration (D087): the environment variable when set (unchanged behaviour),
 * otherwise the value saved in the app (vault secret or plain setting), loaded through getContext() and cached
 * CONNECTOR_TTL_MS. Returns undefined when neither exists or the app cannot reach its store (setup required).
 */
export async function resolveSecret(name: string): Promise<string | undefined> {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim()) return fromEnv;
  try {
    await getContext();
  } catch {
    return undefined; // setup required / store unreachable: same as "not configured"
  }
  return connectorEnvSync()[name] || undefined;
}

/** `getSecret("stripe", "STRIPE_WEBHOOK_SECRET")`: refuses a variable that is not part of that connector. */
export async function getSecret(integration: ConnectorKey, field: string): Promise<string | null> {
  const f = fieldOf(field);
  if (!f || f.form.key !== integration) throw new Error(`Unknown connector field ${integration}/${field}`);
  return (await resolveSecret(field)) ?? null;
}

/** Merged view (env first, then app values) after a refresh; the environment alone when the store is unreachable. */
export async function connectorEnv(): Promise<Env> {
  try {
    await getContext();
  } catch {
    /* environment only */
  }
  return connectorEnvSync();
}
