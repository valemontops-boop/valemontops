import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/data/memory";
import { connectorEnvSync, connectorSource, resetConnectorCache } from "./connector-env";
import { decodeKeyMaterial, fingerprint, generateSecret, keyRing, openSecret, sealSecret, toB64 } from "./vault-crypto";
import { refreshConnectorEnv, secretId, vaultAction, vaultOverview } from "./services/vault";
import type { AppContext } from "./context";

/** Built at runtime: no provider-key-shaped literal in the repository (push protection). */
const fakeStripeKey = (body: string) => ["rk", "live", body].join("_");
const key = (fill: number) => toB64(new Uint8Array(32).fill(fill));
const SESSION = "unit-session-secret-long-enough-0123456789";
const row = { id: "0b3f0a52-6f43-5c8e-9d8f-2a7b1c4e5f60", integration: "stripe", field: "STRIPE_API_KEY" };
const ctxOf = (mode: "live" | "demo" = "live"): AppContext => ({ repo: new InMemoryRepository(), privateRepo: () => null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "https://app.example.com", mode });

beforeEach(() => resetConnectorCache());

describe("vault crypto (D087)", () => {
  it("round-trips with AES-256-GCM and a fresh IV each time", async () => {
    const ring = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(7), SESSION_SECRET: SESSION }, "live");
    expect(ring.source).toBe("dedicated");
    const a = await sealSecret(ring.current!, row, fakeStripeKey("fixtureexample"));
    const b = await sealSecret(ring.current!, row, fakeStripeKey("fixtureexample"));
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toContain("rk_live");
    expect(await openSecret(ring, { ...row, ...a })).toBe(fakeStripeKey("fixtureexample"));
  });

  it("fails closed on tampering: ciphertext, tag, IV, or a ciphertext moved to another row", async () => {
    const ring = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(7), SESSION_SECRET: SESSION }, "live");
    const s = await sealSecret(ring.current!, row, "secret-value-0123456789");
    const flip = (b64: string) => (b64[0] === "A" ? "B" : "A") + b64.slice(1);
    expect(await openSecret(ring, { ...row, ...s, ciphertext: flip(s.ciphertext) })).toBeNull();
    expect(await openSecret(ring, { ...row, ...s, tag: flip(s.tag) })).toBeNull();
    expect(await openSecret(ring, { ...row, ...s, iv: flip(s.iv) })).toBeNull();
    expect(await openSecret(ring, { ...row, ...s, field: "STRIPE_WEBHOOK_SECRET" })).toBeNull();
    expect(await openSecret(ring, { ...row, ...s, id: secretId("OTHER") })).toBeNull();
  });

  it("another key cannot open it; the previous key still can after a rotation (key_version)", async () => {
    const old = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(1), SESSION_SECRET: SESSION }, "live");
    const s = await sealSecret(old.current!, row, "value-sealed-with-the-old-key");
    const other = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(2), SESSION_SECRET: SESSION }, "live");
    expect(other.current!.version).not.toBe(s.key_version);
    expect(await openSecret(other, { ...row, ...s })).toBeNull();
    const rotated = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(2), CONNECTORS_ENCRYPTION_KEY_PREVIOUS: key(1), SESSION_SECRET: SESSION }, "live");
    expect(await openSecret(rotated, { ...row, ...s })).toBe("value-sealed-with-the-old-key");
  });

  it("falls back to SESSION_SECRET with its own label; an invalid dedicated key blocks writes instead of downgrading", async () => {
    const session = await keyRing({ SESSION_SECRET: SESSION }, "live");
    expect(session.source).toBe("session");
    expect(session.current!.version).toMatch(/^s1-/);
    const dedicatedFromSameBytes = await keyRing({ CONNECTORS_ENCRYPTION_KEY: toB64(new TextEncoder().encode(SESSION)), SESSION_SECRET: "x".repeat(40) }, "live");
    expect(dedicatedFromSameBytes.current!.version).not.toBe(session.current!.version); // distinct HKDF info label
    const bad = await keyRing({ CONNECTORS_ENCRYPTION_KEY: "too-short", SESSION_SECRET: SESSION }, "live");
    expect(bad.problem).toMatch(/CONNECTORS_ENCRYPTION_KEY is not valid/);
    expect(bad.current).toBeNull();
    expect(decodeKeyMaterial(key(3))?.length).toBe(32);
    expect(decodeKeyMaterial("c2hvcnQ=")).toBeNull();
  });

  it("DEMO uses a random in-memory key, never one from the environment", async () => {
    const demo = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(9), SESSION_SECRET: SESSION }, "demo");
    expect(demo.source).toBe("demo");
    const live = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(9), SESSION_SECRET: SESSION }, "live");
    expect(demo.current!.version).not.toBe(live.current!.version);
  });

  it("generates 64 hex characters and keyed fingerprints", async () => {
    const a = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSecret()).not.toBe(a);
    const ring = await keyRing({ CONNECTORS_ENCRYPTION_KEY: key(4) }, "live");
    expect(await fingerprint(ring.current!, "x")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("connector resolution (D087)", () => {
  const env = { CONNECTORS_ENCRYPTION_KEY: key(5), SESSION_SECRET: SESSION };

  it("the environment wins over a value saved in the app; the app fills what env leaves empty", async () => {
    const ctx = ctxOf();
    await vaultAction(ctx, "theo", { action: "save", integration: "stripe", changes: { STRIPE_API_KEY: fakeStripeKey("fixturefromtheapp") }, expected_versions: {} }, "founder", env);
    await refreshConnectorEnv(ctx, { env, force: true });
    expect(connectorEnvSync({})).toMatchObject({ STRIPE_API_KEY: fakeStripeKey("fixturefromtheapp") });
    expect(connectorEnvSync({ STRIPE_API_KEY: fakeStripeKey("fixturefromtheapp") }).STRIPE_API_KEY).toBe(fakeStripeKey("fixturefromtheapp"));
    expect(connectorEnvSync({ STRIPE_API_KEY: "  " }).STRIPE_API_KEY).toBe(fakeStripeKey("fixturefromtheapp")); // blank env = unset
    expect(connectorSource("STRIPE_API_KEY", {})).toBe("app");
    expect(connectorSource("STRIPE_API_KEY", { STRIPE_API_KEY: fakeStripeKey("fixturefromenv") })).toBe("env");
    // Saving over an env value is refused: it would never be used.
    await expect(vaultAction(ctx, "theo", { action: "save", integration: "stripe", changes: { STRIPE_API_KEY: fakeStripeKey("fixtureanother") }, expected_versions: { STRIPE_API_KEY: 1 } }, "founder", { ...env, STRIPE_API_KEY: fakeStripeKey("fixturefromenv") })).rejects.toThrow(/host's environment/);
  });

  it("never returns a plaintext secret after saving: overview shows the last 4 characters, who and when", async () => {
    const ctx = ctxOf();
    const secret = fakeStripeKey("fixtureneverbackWXYZ");
    await vaultAction(ctx, "pablo", { action: "save", integration: "stripe", changes: { STRIPE_API_KEY: secret }, expected_versions: {} }, "founder", env);
    const o = await vaultOverview(ctx, "theo", "founder", env);
    expect(JSON.stringify(o)).not.toContain(secret);
    expect(JSON.stringify(o)).not.toContain("neverback");
    const f = o.connectors.find((c) => c.key === "stripe")!.fields.find((x) => x.name === "STRIPE_API_KEY")!;
    expect(f).toMatchObject({ saved: true, last4: "WXYZ", source: "app", value: "", updatedBy: "pablo", version: 1 });
    const stored = (await ctx.repo.list("IntegrationSecrets")).rows[0];
    expect(JSON.stringify(stored)).not.toContain("neverback");
  });

  it("refuses a non-founder role and the other founder's tracker variables are out of reach", async () => {
    const ctx = ctxOf();
    await expect(vaultOverview(ctx, "theo", "admin", env)).rejects.toThrow(/Only a founder/);
    await vaultAction(ctx, "theo", { action: "save", integration: "tracker", changes: { "TRACKER_WEBHOOK_URL_{F}": "https://tracker.example.com/hook" }, expected_versions: {} }, "founder", env);
    expect((await ctx.repo.list("IntegrationSecrets")).rows.map((r) => r.field)).toEqual(["TRACKER_WEBHOOK_URL_THEO"]);
    await expect(vaultAction(ctx, "pablo", { action: "save", integration: "tracker", changes: { TRACKER_WEBHOOK_URL_THEO: "https://evil.example.com" }, expected_versions: {} }, "founder", env)).rejects.toThrow(/Unknown field/);
  });
});
