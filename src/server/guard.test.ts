import { describe, expect, it } from "vitest";
import { BodyTooLargeError, ipHash, isCrossOrigin, rateLimit, readCappedText, resetRateLimits, safeBackPath } from "./guard";

const req = (headers: Record<string, string>, body?: string) => new Request("https://app.example.com/api/x", { method: "POST", headers, body });

describe("request guards (D084)", () => {
  it("refuses open redirects in return paths", () => {
    expect(safeBackPath("/files?x=1", "/f")).toBe("/files?x=1");
    for (const bad of ["//evil.example.com", "/\\evil.example.com", "/\t/evil.example.com", "https://evil.example.com", "javascript:alert(1)", "", null]) expect(safeBackPath(bad, "/f")).toBe("/f");
  });

  it("same-origin check: cross-site and malformed origins are refused, same host passes", () => {
    expect(isCrossOrigin(req({ host: "app.example.com", origin: "https://app.example.com" }))).toBe(false);
    expect(isCrossOrigin(req({ host: "app.example.com", origin: "https://evil.example.com" }))).toBe(true);
    expect(isCrossOrigin(req({ host: "app.example.com", origin: "null" }))).toBe(true);
    expect(isCrossOrigin(req({ host: "app.example.com", "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossOrigin(req({ host: "app.example.com" }))).toBe(false);
  });

  it("caps bodies by Content-Length and while streaming", async () => {
    await expect(readCappedText(req({ "content-length": "999999" }, "x"), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readCappedText(req({}, "x".repeat(11)), 10)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(await readCappedText(req({}, "héllo"), 10)).toBe("héllo");
  });

  it("rate limits per endpoint and client", () => {
    resetRateLimits();
    const rule = { limit: 3, windowMs: 60_000 };
    const now = 1_000_000;
    expect([1, 2, 3].map(() => rateLimit("t", "a", rule, now))).toEqual([0, 0, 0]);
    expect(rateLimit("t", "a", rule, now)).toBeGreaterThan(0);
    expect(rateLimit("t", "b", rule, now)).toBe(0);
    expect(rateLimit("u", "a", rule, now)).toBe(0);
    expect(rateLimit("t", "a", rule, now + 61_000)).toBe(0);
  });

  it("hashes client addresses with a key", () => {
    expect(ipHash("203.0.113.5", "k1")).toMatch(/^[0-9a-f]{16}$/);
    expect(ipHash("203.0.113.5", "k1")).not.toBe(ipHash("203.0.113.5", "k2"));
  });
});
