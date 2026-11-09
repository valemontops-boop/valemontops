/**
 * Structured JSON logs (Stage 4, D084). One line per event: `{ at, level, event, correlationId, ... }`.
 * Levels: debug < info < warn < error, threshold LOG_LEVEL (default info; "silent" turns logging off).
 * Every value is redacted before it is written: secrets (by key name and by shape), email addresses and phone
 * numbers never reach the logs. No server-only import: the browser preview bundles services that log.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const SECRET_KEY = /(secret|token|password|passwd|authorization|cookie|api[-_]?key|private[-_]?key|signature|credential|session|grant|code_verifier)/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// International or national phone numbers: 8+ digits with optional separators (UUIDs and ISO dates do not match: see tests).
const PHONE = /(?<![\w-])\+?\d(?:[\s.()-]?\d){7,14}(?![\w-])/g;
const SHAPES: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe keys
  /\bwhsec_[A-Za-z0-9]{8,}/g,
  /\bya29\.[A-Za-z0-9._-]{10,}/g, // Google access tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{5,})*/g, // JWT / JWE
  /\b[A-Za-z0-9+/_-]{48,}={0,2}/g, // long opaque base64 blobs (service-account keys, tokens)
];

/** Redacts one string: secret shapes first, then emails and phone numbers. */
export function redactText(s: string): string {
  let out = s;
  for (const re of SHAPES) out = out.replace(re, "[redacted]");
  return out.replace(EMAIL, "[email]").replace(PHONE, (m) => (/^\d{4}-\d{2}-\d{2}$/.test(m) ? m : "[phone]"));
}

/** Deep redaction of a log payload: keys that look like secrets are dropped to "[redacted]" whatever their value. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return String(value);
}

function threshold(): number {
  const raw = (typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined)?.toLowerCase() as LogLevel | "silent" | undefined;
  return ORDER[raw ?? "info"] ?? ORDER.info;
}

/** Test hook: captured lines instead of the console. */
let sink: ((line: string, level: LogLevel) => void) | null = null;
export function setLogSink(fn: ((line: string, level: LogLevel) => void) | null) {
  sink = fn;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) });
  if (sink) return sink(line, level);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
};

/** Correlation id: a caller's `x-request-id` is kept when it is a short safe token, otherwise a new UUID is made. */
export function requestIdFrom(header: string | null | undefined): string {
  const v = (header ?? "").trim();
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(v)) return v;
  return globalThis.crypto.randomUUID();
}
