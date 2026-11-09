import { StorageError } from "../repository";

export interface SheetsClientOptions {
  baseUrl: string; // https://sheets.googleapis.com or the fake server
  spreadsheetId: string;
  getToken: () => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export type CellValue = string | number | boolean;

interface RequestOpts {
  query?: Record<string, string | string[]>;
  body?: unknown;
  /** Only idempotent operations are retried (spec 3.7). */
  idempotent: boolean;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Thin Sheets v4 REST client: timeouts on every call, bounded exponential backoff with full jitter. */
export class SheetsClient {
  readonly stats = {
    requests: 0,
    retries: 0,
    errors: 0,
    lastError: null as string | null,
    lastSuccessAt: null as string | null,
    recent: [] as number[],
  };
  private readonly o: Required<SheetsClientOptions>;

  constructor(opts: SheetsClientOptions) {
    this.o = {
      timeoutMs: 10_000,
      maxRetries: 4,
      baseDelayMs: 400,
      maxDelayMs: 8_000,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      random: Math.random,
      ...opts,
      baseUrl: opts.baseUrl.replace(/\/$/, ""),
    };
  }

  requestsLastMinute(): number {
    const cutoff = Date.now() - 60_000;
    this.stats.recent = this.stats.recent.filter((t) => t > cutoff);
    return this.stats.recent.length;
  }

  private async request<T>(method: string, path: string, opts: RequestOpts): Promise<T> {
    const url = new URL(`${this.o.baseUrl}/v4/spreadsheets/${encodeURIComponent(this.o.spreadsheetId)}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    const attempts = opts.idempotent ? this.o.maxRetries + 1 : 1;
    let lastErr: StorageError | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        this.stats.retries++;
        const cap = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** (attempt - 1));
        await this.o.sleep(Math.round(cap / 2 + this.o.random() * (cap / 2)));
      }
      this.stats.requests++;
      this.stats.recent.push(Date.now());
      let res: Response;
      try {
        const token = await this.o.getToken();
        res = await fetch(url, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.o.timeoutMs),
          cache: "no-store",
        });
      } catch (e) {
        const name = (e as Error)?.name;
        lastErr = new StorageError(
          name === "TimeoutError" ? "Google Sheets did not answer in time" : "Google Sheets is unreachable",
          undefined,
          true,
        );
        continue;
      }
      if (res.ok) {
        this.stats.lastSuccessAt = new Date().toISOString();
        return (await res.json()) as T;
      }
      const detail = await res.text().catch(() => "");
      const msg = safeMessage(detail);
      if (RETRYABLE.has(res.status)) {
        lastErr = new StorageError(`Google Sheets returned ${res.status}${msg ? `: ${msg}` : ""}`, res.status, true);
        continue;
      }
      lastErr = new StorageError(`Google Sheets returned ${res.status}${msg ? `: ${msg}` : ""}`, res.status, false);
      break;
    }
    this.stats.errors++;
    this.stats.lastError = lastErr?.message ?? "unknown";
    throw lastErr ?? new StorageError("Unknown Sheets error");
  }

  getMeta() {
    return this.request<{
      spreadsheetId: string;
      properties: { title: string };
      sheets: { properties: { sheetId: number; title: string; gridProperties?: { rowCount: number; columnCount: number; frozenRowCount?: number } } ; protectedRanges?: unknown[] }[];
    }>("GET", "", { idempotent: true, query: { fields: "spreadsheetId,properties.title,sheets(properties,protectedRanges)" } });
  }

  async batchGet(ranges: string[]): Promise<CellValue[][][]> {
    if (ranges.length === 0) return [];
    const res = await this.request<{ valueRanges?: { values?: CellValue[][] }[] }>("GET", "/values:batchGet", {
      idempotent: true,
      query: { ranges, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING", majorDimension: "ROWS" },
    });
    return ranges.map((_, i) => res.valueRanges?.[i]?.values ?? []);
  }

  /** Append is retried: records carry client UUIDs and readers de-duplicate (D006). */
  append(range: string, values: string[][]) {
    return this.request<{ updates?: { updatedRange?: string } }>("POST", `/values/${encodeURIComponent(range)}:append`, {
      idempotent: true,
      query: { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", includeValuesInResponse: "false" },
      body: { range, majorDimension: "ROWS", values },
    });
  }

  update(range: string, values: string[][]) {
    return this.request<unknown>("PUT", `/values/${encodeURIComponent(range)}`, {
      idempotent: true,
      query: { valueInputOption: "RAW" },
      body: { range, majorDimension: "ROWS", values },
    });
  }

  /** Several ranges in ONE write request (setup writes dozens of headers; Sheets allows 60 writes/min/user). */
  updateMany(data: { range: string; values: string[][] }[]) {
    if (data.length === 0) return Promise.resolve(undefined);
    return this.request<unknown>("POST", "/values:batchUpdate", {
      idempotent: true,
      body: { valueInputOption: "RAW", data: data.map((d) => ({ range: d.range, majorDimension: "ROWS", values: d.values })) },
    });
  }

  clear(range: string) {
    return this.request<unknown>("POST", `/values/${encodeURIComponent(range)}:clear`, { idempotent: true, body: {} });
  }

  batchUpdate(requests: unknown[]) {
    return this.request<{ replies?: unknown[] }>("POST", ":batchUpdate", { idempotent: false, body: { requests } });
  }
}

function safeMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    return (j.error?.message ?? "").slice(0, 200);
  } catch {
    return "";
  }
}
