import { randomUUID } from "node:crypto";
import { DOMAINS, domainOf, type Domain, type NewRow, type Row, type TableName } from "./schema/tables";
import {
  ConflictError,
  NotFoundError,
  completeRow,
  nowIso,
  validateRow,
  type Actor,
  type DataRepository,
  type Patch,
  type ReadOptions,
  type ReadResult,
  type RepoStats,
} from "./repository";

/** In-memory adapter for DEMO and tests. Same contract as the Sheets adapter. */
export class InMemoryRepository implements DataRepository {
  readonly kind = "memory" as const;
  private tables = new Map<TableName, Row<TableName>[]>();
  private revs: Record<Domain, string>;
  private counters = { requests: 0, errors: 0 };

  constructor() {
    this.revs = Object.fromEntries(DOMAINS.map((d) => [d, randomUUID()])) as Record<Domain, string>;
  }

  private rowsOf<T extends TableName>(table: T): Row<T>[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as unknown as Row<T>[];
  }

  async list<T extends TableName>(table: T): Promise<ReadResult<T>> {
    this.counters.requests++;
    const seen = new Set<string>();
    const rows: Row<T>[] = [];
    for (const r of this.rowsOf(table)) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(structuredClone(r));
    }
    return { rows, warnings: [], fetchedAt: nowIso() };
  }

  async listMany<T extends TableName>(tables: T[], opts?: ReadOptions) {
    const out = {} as { [K in T]: ReadResult<K> };
    for (const t of tables) (out as Record<string, unknown>)[t] = await this.list(t);
    void opts;
    return out;
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const r = this.rowsOf(table).find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }

  async insert<T extends TableName>(table: T, records: NewRow<T>[], actor: Actor): Promise<Row<T>[]> {
    this.counters.requests++;
    const writeId = randomUUID();
    const rows = records.map((r) => completeRow(table, r, actor, writeId));
    this.rowsOf(table).push(...rows.map((r) => structuredClone(r) as Row<T>));
    this.bump(domainOf(table));
    return rows;
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    expectedVersion: number,
    patch: Patch<T>,
    actor: Actor,
  ): Promise<Row<T>> {
    this.counters.requests++;
    const rows = this.rowsOf(table);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new NotFoundError(table, id);
    const current = rows[idx];
    if (current.version !== expectedVersion) {
      throw new ConflictError(table, id, expectedVersion, structuredClone(current) as Record<string, unknown>);
    }
    const next = validateRow(table, {
      ...current,
      ...patch,
      id,
      created_at: current.created_at,
      updated_at: nowIso(),
      updated_by: actor.founder,
      version: current.version + 1,
      write_id: randomUUID(),
    });
    rows[idx] = next;
    this.bump(domainOf(table));
    return structuredClone(next);
  }

  async revisions(): Promise<Record<Domain, string>> {
    return { ...this.revs };
  }

  stats(): RepoStats {
    return {
      requests: this.counters.requests,
      requestsLastMinute: 0,
      retries: 0,
      errors: this.counters.errors,
      lastError: null,
      lastSuccessAt: nowIso(),
    };
  }

  /** Test helper: raw duplicate append to simulate a race. */
  _appendRaw<T extends TableName>(table: T, row: Row<T>) {
    this.rowsOf(table).push(structuredClone(row));
  }

  private bump(d: Domain) {
    this.revs[d] = randomUUID();
  }
}
