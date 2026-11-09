import { randomUUID } from "node:crypto";
import {
  DOMAINS,
  REVISIONS_TAB,
  columnsOf,
  domainOf,
  type Domain,
  type NewRow,
  type Row,
  type TableName,
} from "../schema/tables";
import {
  ConflictError,
  NotFoundError,
  StorageError,
  completeRow,
  nowIso,
  parseGrid,
  rowToCells,
  validateRow,
  type Actor,
  type DataRepository,
  type IntegrityWarning,
  type Patch,
  type ReadOptions,
  type ReadResult,
  type RepoStats,
} from "../repository";
import { colLetters, quoteSheet } from "./a1";
import type { CellValue, SheetsClient } from "./client";

interface CacheEntry {
  grid: CellValue[][];
  token: string;
  fetchedAt: number;
  parsed: { rows: Row<TableName>[]; warnings: IntegrityWarning[] };
}

export interface SheetsRepoOptions {
  tableTtlMs?: number; // catch manual edits (spec 4.1: "a TTL of a few minutes")
  revisionsTtlMs?: number; // collapse concurrent polls (30 s: one service account shares 60 reads/min across both founders)
  extraColumns?: number; // read a few columns beyond the schema to detect unknown headers
}

/**
 * Google Sheets adapter (spec 4). Reads are batched by domain and refetched only when the
 * domain revision token changed or the TTL expired. Writes use RAW input and conditional
 * updates with version + write_id confirmation.
 */
export class GoogleSheetsRepository implements DataRepository {
  readonly kind = "sheets" as const;
  private cache = new Map<TableName, CacheEntry>();
  private revCache: { value: Record<Domain, string>; at: number } | null = null;
  private revInflight: Promise<Record<Domain, string>> | null = null;
  private readInflight = new Map<string, Promise<void>>();
  private readonly tableTtl: number;
  private readonly revTtl: number;
  private readonly extra: number;

  constructor(private readonly client: SheetsClient, opts: SheetsRepoOptions = {}) {
    this.tableTtl = opts.tableTtlMs ?? 180_000;
    this.revTtl = opts.revisionsTtlMs ?? 30_000;
    this.extra = opts.extraColumns ?? 4;
  }

  private rangeFor(table: TableName, row?: number): string {
    const last = colLetters(columnsOf(table).length - 1 + this.extra);
    return row ? `${quoteSheet(table)}!A${row}:${last}${row}` : `${quoteSheet(table)}!A1:${last}`;
  }

  /* ---------------- revisions ---------------- */

  async revisions(opts: ReadOptions = {}): Promise<Record<Domain, string>> {
    // A "fresh" read accepts tokens read in the last few seconds: several fresh reads in one action cost one request.
    const maxAge = opts.fresh ? FRESH_WINDOW_MS : this.revTtl;
    if (this.revCache && Date.now() - this.revCache.at < maxAge) return this.revCache.value;
    if (this.revInflight) return this.revInflight;
    const p = (async () => {
      let grid: Awaited<ReturnType<SheetsClient["batchGet"]>>[number];
      try {
        [grid] = await this.client.batchGet([`${quoteSheet(REVISIONS_TAB)}!A1:C${DOMAINS.length + 10}`]);
      } catch (e) {
        // Over the per-minute read quota: keep the last known tokens for another TTL instead of failing every screen.
        if (isQuota(e) && this.revCache && Date.now() - this.revCache.at < QUOTA_FALLBACK_MS) {
          this.revCache = { value: this.revCache.value, at: Date.now() };
          return this.revCache.value;
        }
        throw e;
      }
      const value = Object.fromEntries(DOMAINS.map((d) => [d, "missing"])) as Record<Domain, string>;
      for (const r of grid.slice(1)) {
        const d = String(r[0] ?? "") as Domain;
        if ((DOMAINS as readonly string[]).includes(d)) value[d] = String(r[1] ?? "");
      }
      this.revCache = { value, at: Date.now() };
      return value;
    })();
    this.revInflight = p;
    try {
      return await p;
    } finally {
      this.revInflight = null;
    }
  }

  private async bump(domain: Domain): Promise<void> {
    const [col] = await this.client.batchGet([`${quoteSheet(REVISIONS_TAB)}!A1:A${DOMAINS.length + 10}`]);
    const idx = col.findIndex((r, i) => i > 0 && String(r[0] ?? "") === domain);
    const values = [[domain, randomUUID(), nowIso()]];
    if (idx > 0) {
      await this.client.update(`${quoteSheet(REVISIONS_TAB)}!A${idx + 1}:C${idx + 1}`, values);
    } else {
      await this.client.append(`${quoteSheet(REVISIONS_TAB)}!A1`, values);
    }
    this.revCache = null;
  }

  /* ---------------- reads ---------------- */

  async list<T extends TableName>(table: T, opts: ReadOptions = {}): Promise<ReadResult<T>> {
    const res = await this.listMany([table], opts);
    return res[table];
  }

  async listMany<T extends TableName>(tables: T[], opts: ReadOptions = {}): Promise<{ [K in T]: ReadResult<K> }> {
    const revs = await this.revisions(opts);
    const now = Date.now();
    const stale = tables.filter((t) => {
      const c = this.cache.get(t);
      if (!c) return true;
      if (opts.fresh) return now - c.fetchedAt > FRESH_WINDOW_MS;
      return c.token !== revs[domainOf(t)] || now - c.fetchedAt > this.tableTtl;
    });
    if (stale.length > 0) {
      const key = [...stale].sort().join("|");
      let p = this.readInflight.get(key);
      if (!p) {
        p = (async () => {
          let grids: Awaited<ReturnType<SheetsClient["batchGet"]>>;
          try {
            grids = await this.client.batchGet(stale.map((t) => this.rangeFor(t)));
          } catch (e) {
            // Over quota but every table is cached: serve the cached rows (at most a minute old in practice).
            // Over the per-minute quota but every table was read recently: serve those rows instead of failing.
            if (isQuota(e) && stale.every((t) => now - (this.cache.get(t)?.fetchedAt ?? 0) < QUOTA_FALLBACK_MS)) return;
            throw e;
          }
          stale.forEach((t, i) => {
            const grid = grids[i];
            this.cache.set(t, {
              grid,
              token: revs[domainOf(t)],
              fetchedAt: Date.now(),
              parsed: parseGrid(t, grid) as unknown as CacheEntry["parsed"],
            });
          });
        })();
        this.readInflight.set(key, p);
        p.finally(() => this.readInflight.delete(key)).catch(() => undefined);
      }
      await p;
    }
    const out = {} as Record<string, ReadResult<TableName>>;
    for (const t of tables) {
      const c = this.cache.get(t)!;
      out[t] = {
        rows: structuredClone(c.parsed.rows),
        warnings: c.parsed.warnings,
        fetchedAt: new Date(c.fetchedAt).toISOString(),
      };
    }
    return out as { [K in T]: ReadResult<K> };
  }

  async get<T extends TableName>(table: T, id: string, opts: ReadOptions = {}): Promise<Row<T> | null> {
    const { rows } = await this.list(table, opts);
    return (rows.find((r) => r.id === id) as Row<T> | undefined) ?? null;
  }

  private async header(table: TableName): Promise<string[]> {
    const cached = this.cache.get(table)?.grid[0];
    if (cached && cached.length) return cached.map((h) => String(h ?? "").trim());
    const [grid] = await this.client.batchGet([`${quoteSheet(table)}!1:1`]);
    const header = (grid[0] ?? []).map((h) => String(h ?? "").trim());
    if (!header.includes("id")) {
      throw new StorageError(`Tab ${table} has no header row. Run npm run setup:sheets.`, undefined, false);
    }
    return header;
  }

  /* ---------------- writes ---------------- */

  async insert<T extends TableName>(table: T, records: NewRow<T>[], actor: Actor): Promise<Row<T>[]> {
    if (records.length === 0) return [];
    const writeId = randomUUID();
    const rows = records.map((r) => completeRow(table, r, actor, writeId));
    const header = await this.header(table);
    await this.client.append(`${quoteSheet(table)}!A1`, rows.map((r) => rowToCells(table, r, header)));
    if (actor.quiet) {
      // Keep the header for the next quiet append (one request per flush, spec 4.1); rows are re-read on the next list.
      const kept = this.cache.get(table);
      if (kept) this.cache.set(table, { ...kept, fetchedAt: 0 });
      return rows;
    }
    this.cache.delete(table);
    await this.bump(domainOf(table));
    return rows;
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    expectedVersion: number,
    patch: Patch<T>,
    actor: Actor,
  ): Promise<Row<T>> {
    // 1. Fresh read bypassing the cache; resolve the row number by scanning ids (never trust positions).
    const [grid] = await this.client.batchGet([this.rangeFor(table)]);
    const header = (grid[0] ?? []).map((h) => String(h ?? "").trim());
    const idCol = header.indexOf("id");
    if (idCol < 0) throw new StorageError(`Tab ${table} lost its id column`, undefined, false);
    const rowIdx = grid.findIndex((r, i) => i > 0 && String(r[idCol] ?? "").trim() === id);
    if (rowIdx < 0) throw new NotFoundError(table, id);
    const { rows } = parseGrid(table, [grid[0], grid[rowIdx]]);
    const current = rows[0] as Row<T> | undefined;
    if (!current) throw new StorageError(`Row ${rowIdx + 1} of ${table} is malformed; fix it in the Sheet`, undefined, false);
    // 2. Version check.
    if (current.version !== expectedVersion) {
      throw new ConflictError(table, id, expectedVersion, current as Record<string, unknown>);
    }
    // 3. Write version + 1 with a fresh write_id.
    const writeId = randomUUID();
    const next = validateRow(table, {
      ...current,
      ...patch,
      id,
      created_at: current.created_at,
      updated_at: nowIso(),
      updated_by: actor.founder,
      version: current.version + 1,
      write_id: writeId,
    });
    const sheetRow = rowIdx + 1;
    const lastCol = colLetters(header.length - 1);
    await this.client.update(`${quoteSheet(table)}!A${sheetRow}:${lastCol}${sheetRow}`, [rowToCells(table, next, header)]);
    // 4. Confirm our write survived (detects a concurrent overwrite in the residual race window).
    const [confirm] = await this.client.batchGet([`${quoteSheet(table)}!A${sheetRow}:${lastCol}${sheetRow}`]);
    const confirmed = parseGrid(table, [grid[0], confirm[0] ?? []]).rows[0] as Row<T> | undefined;
    this.cache.delete(table);
    if (!confirmed || confirmed.id !== id || confirmed.write_id !== writeId) {
      throw new ConflictError(table, id, expectedVersion, (confirmed as Record<string, unknown>) ?? null);
    }
    await this.bump(domainOf(table));
    return next;
  }

  stats(): RepoStats {
    const s = this.client.stats;
    return {
      requests: s.requests,
      requestsLastMinute: this.client.requestsLastMinute(),
      retries: s.retries,
      errors: s.errors,
      lastError: s.lastError,
      lastSuccessAt: s.lastSuccessAt,
    };
  }
}

/** A fresh read accepts data read this recently (one action often reads the same tabs several times). */
const FRESH_WINDOW_MS = 3_000;
/** When Google refuses reads (per-minute quota), data read this recently is served instead of an error. */
const QUOTA_FALLBACK_MS = 5 * 60_000;

/** Google Sheets per-minute quota exceeded (HTTP 429). */
function isQuota(e: unknown): boolean {
  return e instanceof StorageError && e.status === 429;
}
