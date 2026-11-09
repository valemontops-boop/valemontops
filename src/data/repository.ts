import { CREATE_DEFAULTS, columnsOf, tableSchema, type Domain, type NewRow, type Row, type TableName } from "./schema/tables";
export type { NewRow, Row, TableName } from "./schema/tables";
import { serializeCell } from "./schema/codecs";

export interface IntegrityWarning {
  table: string;
  kind: "malformed_row" | "duplicate_id" | "missing_column" | "unknown_column" | "missing_tab";
  detail: string;
  rowNumber?: number;
}

export interface ReadResult<T extends TableName> {
  rows: Row<T>[];
  warnings: IntegrityWarning[];
  /** ISO timestamp of the underlying fetch (cache age is visible to the UI). */
  fetchedAt: string;
}

export interface ReadOptions {
  /** Bypass caches (used before conditional writes, spec 4.3). */
  fresh?: boolean;
}

export interface Actor {
  founder: string; // founder key, "system" for scripts
  correlationId?: string;
  /** Skip the domain revision bump (append-only operational rows nobody polls, e.g. AuditLog, D084). */
  quiet?: boolean;
}

export type Patch<T extends TableName> = Partial<Omit<Row<T>, "id" | "created_at" | "version" | "write_id">>;

export interface DataRepository {
  readonly kind: "memory" | "sheets";
  list<T extends TableName>(table: T, opts?: ReadOptions): Promise<ReadResult<T>>;
  listMany<T extends TableName>(tables: T[], opts?: ReadOptions): Promise<{ [K in T]: ReadResult<K> }>;
  get<T extends TableName>(table: T, id: string, opts?: ReadOptions): Promise<Row<T> | null>;
  /** Appends records. Idempotent by id at read time (D006). */
  insert<T extends TableName>(table: T, records: NewRow<T>[], actor: Actor): Promise<Row<T>[]>;
  /** Conditional update (spec 4.3). Throws ConflictError on version mismatch. */
  update<T extends TableName>(
    table: T,
    id: string,
    expectedVersion: number,
    patch: Patch<T>,
    actor: Actor,
  ): Promise<Row<T>>;
  revisions(opts?: ReadOptions): Promise<Record<Domain, string>>;
  stats(): RepoStats;
}

export interface RepoStats {
  requests: number;
  requestsLastMinute: number;
  retries: number;
  errors: number;
  lastError: string | null;
  lastSuccessAt: string | null;
}

export class ConflictError extends Error {
  readonly code = "conflict";
  constructor(
    readonly table: string,
    readonly id: string,
    readonly expectedVersion: number,
    readonly current: Record<string, unknown> | null,
  ) {
    super(`Conflict on ${table}/${id}: expected version ${expectedVersion}, found ${String(current?.version ?? "none")}`);
  }
}

export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor(readonly table: string, readonly id: string) {
    super(`${table}/${id} not found`);
  }
}

/** Remote storage unreachable after bounded retries: the UI shows "Error: retry". */
export class StorageError extends Error {
  readonly code = "storage_error";
  constructor(message: string, readonly status?: number, readonly retryable = true) {
    super(message);
  }
}

export class ValidationError extends Error {
  readonly code = "validation_error";
  constructor(message: string, readonly issues?: unknown) {
    super(message);
  }
}

/* ---------- shared row helpers (used by every adapter) ---------- */

export function nowIso(): string {
  return new Date().toISOString();
}

export function completeRow<T extends TableName>(table: T, rec: NewRow<T>, actor: Actor, writeId: string): Row<T> {
  const ts = nowIso();
  const defaults = Object.fromEntries(columnsOf(table).filter((c) => c in CREATE_DEFAULTS && !(c in rec)).map((c) => [c, CREATE_DEFAULTS[c]]));
  const full = {
    ...defaults,
    ...rec,
    created_at: ts,
    updated_at: ts,
    updated_by: actor.founder,
    version: 1,
    is_archived: false,
    write_id: writeId,
  };
  return validateRow(table, full);
}

export function validateRow<T extends TableName>(table: T, rec: Record<string, unknown>): Row<T> {
  const cells = Object.fromEntries(columnsOf(table).map((c) => [c, serializeCell(rec[c])]));
  const parsed = tableSchema(table).safeParse(cells);
  if (!parsed.success) {
    throw new ValidationError(`Invalid ${table} record`, parsed.error.issues);
  }
  return parsed.data as Row<T>;
}

export function rowToCells(table: TableName, row: Record<string, unknown>, header: string[]): string[] {
  return header.map((h) => serializeCell(row[h]));
}

/**
 * Parse raw grid values (header + rows) into typed records.
 * Malformed rows become warnings, never crashes (spec 4.9). Duplicate ids keep the earliest created_at.
 */
export function parseGrid<T extends TableName>(table: T, grid: unknown[][]): { rows: Row<T>[]; warnings: IntegrityWarning[] } {
  const warnings: IntegrityWarning[] = [];
  const header = (grid[0] ?? []).map((h) => String(h ?? "").trim());
  const expected = columnsOf(table);
  for (const col of expected) {
    if (!header.includes(col)) warnings.push({ table, kind: "missing_column", detail: col });
  }
  for (const h of header) {
    if (h && !expected.includes(h)) warnings.push({ table, kind: "unknown_column", detail: h });
  }
  const schema = tableSchema(table);
  const byId = new Map<string, Row<T>>();
  for (let i = 1; i < grid.length; i++) {
    const raw = grid[i] ?? [];
    if (raw.every((c) => c === "" || c === null || c === undefined)) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      if (h) obj[h] = raw[idx] ?? "";
    });
    const parsed = schema.safeParse(obj);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      warnings.push({
        table,
        kind: "malformed_row",
        rowNumber: i + 1,
        detail: `${first?.path.join(".") ?? "?"}: ${first?.message ?? "invalid"}`,
      });
      continue;
    }
    const row = parsed.data as Row<T>;
    const prev = byId.get(row.id);
    if (prev) {
      warnings.push({ table, kind: "duplicate_id", rowNumber: i + 1, detail: row.id });
      // For mutable rows the highest version is current; ties keep the earliest created_at.
      if (row.version > prev.version) byId.set(row.id, row);
      continue;
    }
    byId.set(row.id, row);
  }
  return { rows: [...byId.values()], warnings };
}
