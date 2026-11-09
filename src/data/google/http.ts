import { StorageError } from "../repository";

/** Minimal Google REST helper: timeout on every call, bounded retry with jitter for idempotent calls only. */
export class GoogleHttp {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string>,
    private readonly opts: { timeoutMs?: number; maxRetries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {}

  async request<T>(method: string, path: string, init: { query?: Record<string, string>; body?: unknown; raw?: { contentType: string; data: Uint8Array }; idempotent: boolean; allow404?: boolean; allow409?: boolean }): Promise<{ status: number; data: T | null }> {
    const url = new URL(this.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const attempts = init.idempotent ? (this.opts.maxRetries ?? 3) + 1 : 1;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let last: StorageError | null = null;
    for (let a = 0; a < attempts; a++) {
      if (a > 0) {
        const cap = Math.min(8_000, (this.opts.baseDelayMs ?? 400) * 2 ** (a - 1));
        await sleep(Math.round(cap / 2 + Math.random() * (cap / 2)));
      }
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { authorization: `Bearer ${await this.getToken()}`, ...(init.raw ? { "content-type": init.raw.contentType } : init.body !== undefined ? { "content-type": "application/json" } : {}) },
          body: init.raw ? Buffer.from(init.raw.data) : init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
          cache: "no-store",
        });
      } catch {
        last = new StorageError("Google is unreachable", undefined, true);
        continue;
      }
      if (res.ok) return { status: res.status, data: res.status === 204 ? null : ((await res.json()) as T) };
      if (res.status === 404 && init.allow404) return { status: 404, data: null };
      if (res.status === 409 && init.allow409) return { status: 409, data: null };
      const msg = await res.text().then((t) => { try { return (JSON.parse(t) as { error?: { message?: string } }).error?.message ?? ""; } catch { return ""; } }).catch(() => "");
      last = new StorageError(`Google returned ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ""}`, res.status, [429, 500, 502, 503, 504].includes(res.status));
      if (!last.retryable) break;
    }
    throw last ?? new StorageError("Google request failed");
  }
}
