/**
 * Connector vault cryptography (D087). AES-256-GCM with a 96-bit random IV and a 128-bit tag; the key is derived with
 * HKDF-SHA256 and never leaves this process (never in Sheets, logs or the browser):
 *   - CONNECTORS_ENCRYPTION_KEY (32+ random bytes, base64): the dedicated key (recommended);
 *   - otherwise SESSION_SECRET with a distinct HKDF info label (rotating SESSION_SECRET then makes stored values
 *     unreadable: they must be entered again — the documented trade-off);
 *   - DEMO: a random in-memory key per process (nothing survives a restart).
 * Rotation: the new key in CONNECTORS_ENCRYPTION_KEY, the old one(s) in CONNECTORS_ENCRYPTION_KEY_PREVIOUS (comma
 * separated) until "Re-encrypt" has rewritten every row; `key_version` names the key that sealed a row.
 * The additional authenticated data binds a ciphertext to its row id, integration, field and key version, so a
 * ciphertext copied into another row (or a tampered cell) fails to decrypt.
 * WebCrypto only (Node 20+ and browsers): the static review preview bundles this file.
 */

type Env = Record<string, string | undefined>;
export type KeySource = "dedicated" | "session" | "demo";

export interface VaultKey { version: string; source: KeySource; key: CryptoKey; fp: CryptoKey }
export interface KeyRing {
  /** Key used for new writes; null when no usable key exists (writes refused). */
  current: VaultKey | null;
  /** Every key that may open an existing row (current first). */
  all: VaultKey[];
  source: KeySource | "none";
  /** Set when CONNECTORS_ENCRYPTION_KEY is present but unusable (English source sentence). */
  problem: string | null;
}
export interface Sealed { ciphertext: string; iv: string; tag: string; key_version: string }

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode("valemont-os/connectors/v1");
const INFO_DEDICATED = "valemont-os connector vault: dedicated key";
const INFO_SESSION = "valemont-os connector vault: derived from SESSION_SECRET";
const INFO_DEMO = "valemont-os connector vault: demo";

/* ---------------- base64 without Buffer (browser-safe) ---------------- */
export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function fromB64(s: string): Uint8Array {
  const clean = s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Decodes a base64 key; null when it is not base64 or shorter than 32 bytes. */
export function decodeKeyMaterial(raw: string | undefined): Uint8Array | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!/^[A-Za-z0-9+/_=-]+$/.test(v)) return null;
  try {
    const b = fromB64(v);
    return b.length >= 32 ? b : null;
  } catch {
    return null;
  }
}

async function derive(ikm: Uint8Array, info: string, source: KeySource, label: string): Promise<VaultKey> {
  const base = await subtle().importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveKey", "deriveBits"]);
  const hkdf = (i: string) => ({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(i) });
  const key = await subtle().deriveKey(hkdf(info), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const fp = await subtle().deriveKey(hkdf(`${info}|fingerprint`), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  // A short public id of the key (not the key): lets a row say which key sealed it, so rotation can find old rows.
  const kid = hex(await subtle().deriveBits(hkdf(`${info}|key-id`), base, 64)).slice(0, 10);
  return { version: `${label}-${kid}`, source, key, fp };
}

const g = globalThis as unknown as { __valemontVaultRing?: { sig: string; ring: Promise<KeyRing> }; __valemontDemoKey?: Uint8Array };

/** The key ring for this process. Memoised per configuration (a changed env builds a new ring). */
export function keyRing(env: Env, mode: "live" | "demo"): Promise<KeyRing> {
  const sig = [mode, env.CONNECTORS_ENCRYPTION_KEY ?? "", env.CONNECTORS_ENCRYPTION_KEY_PREVIOUS ?? "", env.SESSION_SECRET ?? ""].join("\u0000");
  if (g.__valemontVaultRing?.sig === sig) return g.__valemontVaultRing.ring;
  const ring = buildRing(env, mode);
  g.__valemontVaultRing = { sig, ring };
  return ring;
}

async function buildRing(env: Env, mode: "live" | "demo"): Promise<KeyRing> {
  if (mode === "demo") {
    // DEMO never uses a real key: a random one per process; nothing written in DEMO can be read after a restart.
    g.__valemontDemoKey ??= globalThis.crypto.getRandomValues(new Uint8Array(32));
    const k = await derive(g.__valemontDemoKey, INFO_DEMO, "demo", "d1");
    return { current: k, all: [k], source: "demo", problem: null };
  }
  const all: VaultKey[] = [];
  let current: VaultKey | null = null;
  let problem: string | null = null;
  const dedicatedRaw = (env.CONNECTORS_ENCRYPTION_KEY ?? "").trim();
  const dedicated = decodeKeyMaterial(dedicatedRaw);
  if (dedicatedRaw && !dedicated) problem = "CONNECTORS_ENCRYPTION_KEY is not valid: it must be 32+ random bytes in base64 (openssl rand -base64 32).";
  if (dedicated) all.push((current = await derive(dedicated, INFO_DEDICATED, "dedicated", "k1")));
  for (const old of (env.CONNECTORS_ENCRYPTION_KEY_PREVIOUS ?? "").split(",")) {
    const m = decodeKeyMaterial(old);
    if (m) all.push(await derive(m, INFO_DEDICATED, "dedicated", "k1"));
  }
  const session = env.SESSION_SECRET ?? "";
  if (session.length >= 32) {
    const s = await derive(enc.encode(session), INFO_SESSION, "session", "s1");
    all.push(s);
    // Fallback only when no dedicated key is configured; an invalid dedicated key blocks writes instead of silently downgrading.
    if (!current && !dedicatedRaw) current = s;
  }
  return { current, all, source: current?.source ?? "none", problem };
}

/** Associated data: the ciphertext only opens in the row it was written for. */
export const aadOf = (row: { id: string; integration: string; field: string }, keyVersion: string) => enc.encode(`${row.id}|${row.integration}|${row.field}|${keyVersion}`);

export async function sealSecret(k: VaultKey, row: { id: string; integration: string; field: string }, plaintext: string): Promise<Sealed> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aadOf(row, k.version), tagLength: 128 }, k.key, enc.encode(plaintext)));
  return { ciphertext: toB64(out.slice(0, out.length - 16)), tag: toB64(out.slice(out.length - 16)), iv: toB64(iv), key_version: k.version };
}

/** Plaintext, or null when no key of the ring opens the row (wrong key, tampered cell, row moved). Never throws. */
export async function openSecret(ring: KeyRing, row: { id: string; integration: string; field: string; ciphertext: string; iv: string; tag: string; key_version: string }): Promise<string | null> {
  const k = ring.all.find((x) => x.version === row.key_version);
  if (!k || !row.ciphertext || !row.iv || !row.tag) return null;
  try {
    const body = fromB64(row.ciphertext);
    const tag = fromB64(row.tag);
    const joined = new Uint8Array(body.length + tag.length);
    joined.set(body);
    joined.set(tag, body.length);
    const out = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(row.iv) as BufferSource, additionalData: aadOf(row, k.version), tagLength: 128 }, k.key, joined);
    return dec.decode(out);
  } catch {
    return null;
  }
}

/** Keyed fingerprint (HMAC, 12 hex): recognises an unchanged value without storing anything reversible. */
export async function fingerprint(k: VaultKey, value: string): Promise<string> {
  return hex(await subtle().sign("HMAC", k.fp, enc.encode(value))).slice(0, 12);
}

/** A new random secret for values WE create (webhook / job / feed secrets): 32 random bytes as 64 hex characters. */
export function generateSecret(): string {
  return hex(globalThis.crypto.getRandomValues(new Uint8Array(32)).buffer);
}
