import { afterEach, describe, expect, it } from "vitest";
import { log, redact, redactText, requestIdFrom, setLogSink } from "./log";

describe("structured logs (D084)", () => {
  afterEach(() => { setLogSink(null); delete process.env.LOG_LEVEL; });

  it("redacts emails, phone numbers and secret shapes, keeps dates, UUIDs and numbers", () => {
    const key = "-----BEGIN " + "PRIVATE KEY-----\nabc\n-----END " + "PRIVATE KEY-----";
    const s = redactText(`mail theo@example.com phone +33612345678 or 06 12 34 56 78 bearer Bearer abcdefghijkl ${key} on 2026-11-09 id 6f1c1d9e-3b7a-5d2e-9a64-2c8f0b7e4a11`);
    expect(s).not.toMatch(/example\.com|612345678|12 34 56|abcdefghijkl|PRIVATE/);
    expect(s).toContain("[email]");
    expect(s).toContain("[phone]");
    expect(s).toContain("2026-11-09");
    expect(s).toContain("6f1c1d9e-3b7a-5d2e-9a64-2c8f0b7e4a11");
    expect(redactText("sk_" + "live_abcdefgh12345678 whsec_" + "abcdefgh1234")).toBe("[redacted] [redacted]");
  });

  it("drops values of secret-looking keys at any depth", () => {
    expect(redact({ authorization: "x", nested: { client_secret: "y", ok: 3, list: ["a@example.com"] }, cookie: "z" })).toEqual({ authorization: "[redacted]", nested: { client_secret: "[redacted]", ok: 3, list: ["[email]"] }, cookie: "[redacted]" });
  });

  it("writes one JSON line per event with level threshold", () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    process.env.LOG_LEVEL = "warn";
    log("info", "hidden");
    log("error", "shown", { correlationId: "req-12345678", email: "pablo@example.com" });
    expect(lines).toHaveLength(1);
    const j = JSON.parse(lines[0]);
    expect(j).toMatchObject({ level: "error", event: "shown", correlationId: "req-12345678", email: "[email]" });
    expect(typeof j.at).toBe("string");
  });

  it("keeps a safe x-request-id and replaces anything else", () => {
    expect(requestIdFrom("abc-12345678")).toBe("abc-12345678");
    expect(requestIdFrom("bad id with spaces")).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom("x".repeat(200))).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
