import { z } from "zod";
import { ConflictError, type DataRepository, type Row } from "@/data/repository";
import { BOOTSTRAP_ENV, CONNECTOR_FORMS, CONNECTOR_KEYS, allConnectorNames, checkValue, connectorForm, fieldOf, last4Of, resolveFieldName, type ConnectorField } from "@/domain/connectors";
import type { FounderKey } from "@/domain/constants";
import { childId } from "@/lib/ids";
import { connectorCacheFresh, connectorSource, invalidateConnectorCache, setConnectorCache, unreadableConnectors } from "../connector-env";
import { ForbiddenError, RuleError } from "../errors";
import { logger } from "../log";
import type { AppContext } from "../context";
import { fingerprint, generateSecret, keyRing, openSecret, sealSecret, type KeyRing } from "../vault-crypto";

/**
 * In-app connector setup (D087). Secrets: AES-256-GCM ciphertext only in IntegrationSecrets (the key stays in the
 * environment). Plain settings (ids, retention): SystemSettings "connector:NAME". Write-only: a saved secret is never
 * returned to the browser again — only "set · ends with 1234", who and when. Environment variables always win.
 * Every change goes through route() (founder session, same-origin, Zod, audit with field names only).
 */

type Env = Record<string, string | undefined>;
const processEnv = (): Env => (typeof process !== "undefined" && process.env ? process.env : {});

export const secretId = (name: string) => childId("connector-secret", name);
export const settingId = (name: string) => childId("connector-setting", name);
export const settingKey = (name: string) => `connector:${name}`;

const ringFor = (ctx: AppContext, env: Env) => keyRing(env, ctx.mode);

/* ---------------- loading (used by getContext through refreshConnectorEnv) ---------------- */

const inflight = new WeakMap<object, Promise<void>>();

/**
 * Loads the in-app values into the process cache (decrypted in memory only). Cached CONNECTOR_TTL_MS; a failure
 * (tab missing in an old spreadsheet, Sheets unavailable) keeps the environment-only behaviour and never throws.
 */
export async function refreshConnectorEnv(ctx: AppContext, opts: { force?: boolean; env?: Env } = {}): Promise<void> {
  if (!opts.force && connectorCacheFresh(ctx.repo)) return;
  const running = inflight.get(ctx.repo);
  if (running && !opts.force) return running;
  const p = (async () => {
    const values: Record<string, string> = {};
    const unreadable: string[] = [];
    try {
      const ring = await ringFor(ctx, opts.env ?? processEnv());
      const t = await ctx.repo.listMany(["IntegrationSecrets", "SystemSettings"]);
      const known = new Set(allConnectorNames());
      for (const r of t.SystemSettings.rows) {
        if (r.is_archived || !r.key.startsWith("connector:")) continue;
        const name = r.key.slice("connector:".length);
        if (known.has(name) && r.value) values[name] = r.value;
      }
      for (const r of t.IntegrationSecrets.rows) {
        if (r.is_archived || !r.ciphertext || !known.has(r.field)) continue;
        const v = await openSecret(ring, r);
        if (v === null) unreadable.push(r.field);
        else values[r.field] = v;
      }
    } catch (e) {
      logger.warn("connector_vault_unavailable", { error: e as Error });
    }
    setConnectorCache(ctx.repo, values, unreadable);
  })();
  inflight.set(ctx.repo, p);
  try {
    await p;
  } finally {
    if (inflight.get(ctx.repo) === p) inflight.delete(ctx.repo);
  }
}

/* ---------------- overview (GET) ---------------- */

function requireFounder(role: string | undefined) {
  if (role && role !== "founder") throw new ForbiddenError("Only a founder can change connectors.");
}

const visible = (f: ConnectorField, founder: FounderKey) => resolveFieldName(f.name, founder);

export async function vaultOverview(ctx: AppContext, founder: FounderKey, role?: string, env: Env = processEnv()) {
  requireFounder(role);
  await refreshConnectorEnv(ctx, { env });
  const ring = await ringFor(ctx, env);
  const t = await ctx.repo.listMany(["IntegrationSecrets", "SystemSettings"]);
  const secrets = new Map(t.IntegrationSecrets.rows.map((r) => [r.field, r]));
  const settings = new Map(t.SystemSettings.rows.filter((r) => r.key.startsWith("connector:")).map((r) => [r.key.slice(10), r]));
  const unreadable = new Set(unreadableConnectors());
  const connectors = CONNECTOR_FORMS.map((form) => ({
    key: form.key,
    fields: form.fields.map((f) => {
      const name = visible(f, founder);
      const fromEnv = Boolean(env[name]?.trim());
      if (f.kind === "secret") {
        const r = secrets.get(name);
        const saved = Boolean(r && !r.is_archived && r.ciphertext);
        return {
          name, template: f.name, kind: f.kind, source: fromEnv ? ("env" as const) : saved ? ("app" as const) : null,
          saved, last4: saved ? r!.last4 : "", value: "", unreadable: saved && unreadable.has(name),
          oldKey: saved && Boolean(ring.current) && r!.key_version !== ring.current!.version,
          updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? "", version: r?.version ?? 0,
        };
      }
      const r = settings.get(name);
      const saved = Boolean(r && !r.is_archived && r.value);
      return {
        name, template: f.name, kind: f.kind, source: fromEnv ? ("env" as const) : saved ? ("app" as const) : null,
        // Plain settings are not secret: the saved value is shown so it can be corrected; an env value is not echoed.
        saved, last4: "", value: saved ? r!.value : "", unreadable: false, oldKey: false,
        updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? "", version: r?.version ?? 0,
      };
    }),
  }));
  const oldKeyRows = t.IntegrationSecrets.rows.filter((r) => !r.is_archived && r.ciphertext && ring.current && r.key_version !== ring.current.version).length;
  return {
    mode: ctx.mode,
    baseUrl: ctx.baseUrl,
    key: { source: ring.current?.source ?? "none", ok: Boolean(ring.current) && !ring.problem, problem: ring.problem, oldKeyRows, dedicated: Boolean(env.CONNECTORS_ENCRYPTION_KEY?.trim()) },
    connectors,
    bootstrap: BOOTSTRAP_ENV.map((b) => ({ name: b.name, required: b.required, set: Boolean(env[b.name]?.trim()) })),
  };
}

/* ---------------- changes (POST) ---------------- */

const integration = z.enum(CONNECTOR_KEYS);
const fieldName = z.string().trim().regex(/^[A-Z0-9_{}]{3,80}$/);
export const vaultActionSchema = z.discriminatedUnion("action", [
  // `changes` holds variable names → values; route()'s audit keeps the NAMES only (D084), never the values.
  z.object({ action: z.literal("save"), integration, changes: z.record(fieldName, z.string().max(12_000)), expected_versions: z.record(fieldName, z.number().int().min(0)).default({}) }),
  z.object({ action: z.literal("generate"), integration, field: fieldName, expected_version: z.number().int().min(0) }),
  z.object({ action: z.literal("delete"), integration, field: fieldName, expected_version: z.number().int().min(0) }),
  z.object({ action: z.literal("rotate") }),
]);
export type VaultAction = z.infer<typeof vaultActionSchema>;

function fieldFor(key: string, template: string) {
  const form = connectorForm(key);
  const field = form?.fields.find((f) => f.name === template);
  if (!form || !field) throw new RuleError("Unknown field for this integration.");
  return field;
}

async function writeSecret(repo: DataRepository, ring: KeyRing, founder: FounderKey, key: string, name: string, value: string, expected: number) {
  const id = secretId(name);
  const cur = await repo.get("IntegrationSecrets", id, { fresh: true });
  if ((cur?.version ?? 0) !== expected) throw new ConflictError("IntegrationSecrets", id, expected, cur ? metaOnly(cur) : null);
  const k = ring.current!;
  const sealed = await sealSecret(k, { id, integration: key, field: name }, value);
  const patch = { ...sealed, last4: last4Of(value), fingerprint: await fingerprint(k, value), integration: key, field: name, is_archived: false };
  const row = cur ? await repo.update("IntegrationSecrets", id, cur.version, patch, { founder }) : (await repo.insert("IntegrationSecrets", [{ id, ...patch }], { founder }))[0];
  return row;
}

async function writeSetting(repo: DataRepository, founder: FounderKey, name: string, value: string, expected: number) {
  const id = settingId(name);
  const cur = await repo.get("SystemSettings", id, { fresh: true });
  if ((cur?.version ?? 0) !== expected) throw new ConflictError("SystemSettings", id, expected, cur ? { ...cur } : null);
  const patch = { key: settingKey(name), value, description: "Connector setting saved in the app (D087). Not a secret.", is_archived: !value };
  return cur ? repo.update("SystemSettings", id, cur.version, patch, { founder }) : (await repo.insert("SystemSettings", [{ id, ...patch }], { founder }))[0];
}

/** A conflict shows who changed what and when — never a ciphertext. */
const metaOnly = (r: Row<"IntegrationSecrets">) => ({ id: r.id, field: r.field, version: r.version, updated_at: r.updated_at, updated_by: r.updated_by, last4: r.last4 });

function guard(env: Env, name: string) {
  if (env[name]?.trim()) throw new RuleError("This value is set in the host's environment (Vercel) and wins: change it there, or remove it there to manage it here.", [name]);
}

export async function vaultAction(ctx: AppContext, founder: FounderKey, input: VaultAction, role?: string, env: Env = processEnv()) {
  requireFounder(role);
  const ring = await ringFor(ctx, env);
  const needKey = () => {
    if (ring.problem) throw new RuleError(ring.problem);
    if (!ring.current) throw new RuleError("No encryption key: set CONNECTORS_ENCRYPTION_KEY (or SESSION_SECRET) in the host's environment.");
  };
  try {
    if (input.action === "rotate") {
      needKey();
      const { rows } = await ctx.repo.list("IntegrationSecrets", { fresh: true });
      let rotated = 0;
      let unreadable = 0;
      for (const r of rows) {
        if (r.is_archived || !r.ciphertext || r.key_version === ring.current!.version) continue;
        const v = await openSecret(ring, r);
        if (v === null) { unreadable++; continue; }
        await writeSecret(ctx.repo, ring, founder, r.integration, r.field, v, r.version);
        rotated++;
      }
      return { ok: true, rotated, unreadable };
    }

    if (input.action === "save") {
      const form = connectorForm(input.integration)!;
      const plan: { field: ConnectorField; name: string; value: string; expected: number }[] = [];
      const errors: Record<string, string> = {};
      for (const [template, raw] of Object.entries(input.changes)) {
        const field = fieldFor(input.integration, template);
        const name = resolveFieldName(field.name, founder); // tracker: always the signed-in founder's own variable
        if (!raw.trim()) continue; // empty = keep what is saved (write-only fields are shown empty)
        guard(env, name);
        const c = checkValue(field, raw);
        if (!c.ok) { errors[template] = c.error; continue; }
        plan.push({ field, name, value: c.value, expected: input.expected_versions[template] ?? 0 });
      }
      const firstBad = Object.keys(errors)[0];
      if (firstBad) throw new RuleError(errors[firstBad], [firstBad]);
      if (!plan.length) throw new RuleError("Nothing to save: paste a value first.");
      if (plan.some((p) => p.field.kind === "secret")) needKey();
      for (const p of plan) {
        if (p.field.kind === "secret") await writeSecret(ctx.repo, ring, founder, form.key, p.name, p.value, p.expected);
        else await writeSetting(ctx.repo, founder, p.name, p.value, p.expected);
      }
      return { ok: true, saved: plan.map((p) => p.field.name) };
    }

    const field = fieldFor(input.integration, input.field);
    const name = resolveFieldName(field.name, founder);
    guard(env, name);
    if (input.action === "generate") {
      if (!field.generate) throw new RuleError("This value comes from the provider: paste it.");
      needKey();
      const value = generateSecret();
      const row = await writeSecret(ctx.repo, ring, founder, input.integration, name, value, input.expected_version);
      // The only time this value is ever sent to the browser: to copy it into the other service.
      return { ok: true, field: field.name, value, last4: row.last4, version: row.version };
    }
    // delete
    if (field.kind === "setting") {
      await writeSetting(ctx.repo, founder, name, "", input.expected_version);
      return { ok: true, deleted: field.name };
    }
    const id = secretId(name);
    const cur = await ctx.repo.get("IntegrationSecrets", id, { fresh: true });
    if (!cur) throw new RuleError("Nothing saved for this value.");
    if (cur.version !== input.expected_version) throw new ConflictError("IntegrationSecrets", id, input.expected_version, metaOnly(cur));
    await ctx.repo.update("IntegrationSecrets", id, cur.version, { ciphertext: "", iv: "", tag: "", last4: "", fingerprint: "", is_archived: true }, { founder });
    return { ok: true, deleted: field.name };
  } finally {
    invalidateConnectorCache();
  }
}

/** Whether a variable is configured (env or app) — for the hub. */
export const configuredSource = (name: string) => connectorSource(name);
export { fieldOf };
