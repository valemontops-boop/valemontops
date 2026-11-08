"use client";

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { error?: string; message?: string; current?: Record<string, unknown>; details?: string[]; issues?: unknown }) {
    super(body.message ?? `Request failed (${status})`);
  }
  get isConflict() {
    return this.status === 409;
  }
  get isBlocked() {
    return this.status === 403 && this.body.error === "blocked";
  }
  get isRetryable() {
    return this.status >= 500 || this.status === 0;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal ?? AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, { error: "network", message: "Network error. Check your connection and retry." });
  }
  if (res.status === 401) {
    // Outside React: a hard navigation also clears client caches after the session ended.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
    throw new ApiError(401, { error: "unauthenticated", message: "Signed out" });
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
