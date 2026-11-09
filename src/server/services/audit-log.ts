import { createHmac } from "node:crypto";
import { z } from "zod";
import type { DataRepository, NewRow, Row } from "@/data/repository";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import { newId } from "@/lib/ids";
import { logger } from "../log";

/**
 * Append-only audit trail (spec 3.9, Stage 4B, D084). route() records every authenticated mutation here, after the
 * response, without blocking it: who, when, action (method + path), entity, record id, changed field NAMES, status,
 * correlation id, a keyed hash of the input and of the caller's IP. Never values, never secrets, never private data:
 * a private mutation (private task, private sheet) keeps only actor, action, status and time.
 */

const SKIP_FIELDS = new Set(["expected_version", "version", "idempotency_key", "id", "write_id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditEvent {
  founder: FounderKey;
  method: string;
  path: string;
  status: number;
  correlationId: string;
  input: unknown;
  result?: unknown;
  ipHash?: string;
  /** Keyed-hash secret (SESSION_SECRET on the server). */
  secret?: string;
}

/** "/api/crm/opportunities" → "crm/opportunities". */
export function entityOf(path: string): string {
  return path.replace(/^\/api\//, "").replace(/\/+$/, "").slice(0, 60);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Field names a mutation touched (names only): top-level keys, or the keys of a `patch` / `task` object. */
export function changedFields(input: unknown): string[] {
  if (!isObj(input)) return [];
  const names = new Set<string>();
  for (const [k, v] of Object.entries(input)) {
    if (SKIP_FIELDS.has(k)) continue;
    if ((k === "patch" || k === "task" || k === "changes") && isObj(v)) for (const p of Object.keys(v)) { if (!SKIP_FIELDS.has(p)) names.add(p); }
    else names.add(k);
  }
  return [...names].slice(0, 40);
}

/** Record id: the input's id (or *_id of an update), else the id the handler returned. Only UUIDs are kept. */
export function recordIdOf(input: unknown, result?: unknown): string {
  const pick = (o: unknown): string => {
    if (!isObj(o)) return "";
    for (const k of ["id", "record_id"]) if (typeof o[k] === "string" && UUID.test(o[k] as string)) return o[k] as string;
    for (const k of ["row", "record", "item", "task", "account", "opportunity", "contact", "quote"]) {
      const inner = o[k];
      if (isObj(inner) && typeof inner.id === "string" && UUID.test(inner.id)) return inner.id;
    }
    return "";
  };
  return pick(input) || pick(result);
}

/** A mutation of private data (spec 4.7): its audit row carries no record id, fields or input hash. */
export function isPrivateMutation(path: string, input: unknown): boolean {
  if (/private/i.test(path)) return true;
  if (!isObj(input)) return false;
  return input.private === true || (isObj(input.task) && input.task.private === true) || input.visibility === "private";
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** Keyed hash of the input: the same request can be recognised, the values cannot be recovered. */
export function inputHash(input: unknown, secret: string): string {
  if (input === undefined) return "";
  return createHmac("sha256", `audit:${secret}`).update(stable(input)).digest("hex").slice(0, 16);
}

/** Connector vault mutations carry secrets in their input: never hashed into the audit row. */
export const isVaultPath = (path: string) => /^\/api\/integrations\/vault\b/.test(path);

export function auditRow(e: AuditEvent): NewRow<"AuditLog"> {
  const priv = isPrivateMutation(e.path, e.input);
  return {
    id: newId(),
    actor: e.founder,
    action: `${e.method} /${entityOf(e.path)}`.slice(0, 60),
    table_name: priv ? "private" : entityOf(e.path),
    record_id: priv ? "" : recordIdOf(e.input, e.result),
    fields: priv ? "" : changedFields(e.input).join(","),
    correlation_id: e.correlationId.slice(0, 40),
    http_status: e.status,
    audit_scope: priv ? "private" : "team",
    // Connector vault (D087): field names only, not even a keyed hash of the values.
    input_hash: priv || isVaultPath(e.path) ? "" : inputHash(e.input, e.secret ?? ""),
    ip_hash: (e.ipHash ?? "").slice(0, 20),
  };
}

/* ---------------- buffered, non-blocking writer ---------------- */

const MAX_QUEUE = 500;
interface Q { rows: NewRow<"AuditLog">[]; flushing: Promise<void> | null }
const g = globalThis as unknown as { __valemontAudit?: WeakMap<DataRepository, Q> };
const queues = () => (g.__valemontAudit ??= new WeakMap());
const qOf = (repo: DataRepository) => {
  let q = queues().get(repo);
  if (!q) queues().set(repo, (q = { rows: [], flushing: null }));
  return q;
};

export const auditStats = { written: 0, failed: 0, dropped: 0, lastError: "" as string };

/** Queues one audit row. Concurrent mutations collapse into one append (one Sheets request per flush, spec 4.1). */
export function enqueueAudit(repo: DataRepository, e: AuditEvent): void {
  const q = qOf(repo);
  q.rows.push(auditRow(e));
  if (q.rows.length > MAX_QUEUE) {
    auditStats.dropped += q.rows.length - MAX_QUEUE;
    q.rows.splice(0, q.rows.length - MAX_QUEUE);
  }
}

/** Writes everything queued. Never throws: a failure is logged and the rows stay queued for the next flush. */
export async function flushAudit(repo: DataRepository): Promise<void> {
  const q = qOf(repo);
  while (q.flushing) await q.flushing;
  if (!q.rows.length) return;
  const batch = q.rows.splice(0, q.rows.length);
  q.flushing = (async () => {
    try {
      await repo.insert("AuditLog", batch, { founder: "system", quiet: true });
      auditStats.written += batch.length;
    } catch (err) {
      auditStats.failed++;
      auditStats.lastError = (err as Error)?.message?.slice(0, 200) ?? "unknown";
      q.rows.unshift(...batch.slice(0, MAX_QUEUE - q.rows.length));
      logger.error("audit_flush_failed", { rows: batch.length, error: err as Error });
    }
  })();
  try {
    await q.flushing;
  } finally {
    q.flushing = null;
  }
}

export function pendingAudit(repo: DataRepository): number {
  return qOf(repo).rows.length;
}

/* ---------------- viewer (Settings › Diagnostics) ---------------- */

export const auditQuerySchema = z.object({
  entity: z.string().trim().max(60).optional().default(""),
  founder: z.enum(["", ...FOUNDERS]).optional().default(""),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).default(""),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).default(""),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditView {
  at: string;
  actor: string;
  action: string;
  entity: string;
  record_id: string;
  fields: string[];
  status: number | null;
  correlation_id: string;
}

/** Newest first. Private rows are shown only to the founder who made them. Dates are UTC days. */
export async function listAudit(repo: DataRepository, viewer: FounderKey, q: AuditQuery) {
  const { rows } = await repo.list("AuditLog", { fresh: true });
  const visible = rows.filter((r) => !r.is_archived && (r.audit_scope !== "private" || r.actor === viewer));
  const entities = [...new Set(visible.map((r) => r.table_name).filter(Boolean))].sort();
  const hit = visible
    .filter((r) => (!q.entity || r.table_name === q.entity) && (!q.founder || r.actor === q.founder))
    .filter((r) => (!q.from || r.created_at.slice(0, 10) >= q.from) && (!q.to || r.created_at.slice(0, 10) <= q.to))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { total: hit.length, entities, rows: hit.slice(0, q.limit).map(view) };
}

function view(r: Row<"AuditLog">): AuditView {
  return { at: r.created_at, actor: r.actor, action: r.action, entity: r.table_name, record_id: r.record_id, fields: r.fields ? r.fields.split(",").filter(Boolean) : [], status: r.http_status ?? null, correlation_id: r.correlation_id };
}
