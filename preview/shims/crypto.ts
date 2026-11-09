// Browser stand-in for node:crypto used by shared modules in the preview build only.
export function randomUUID(): string {
  return crypto.randomUUID();
}
export function createHash() {
  let data = "";
  const api = {
    update(s: string) {
      data += s;
      return api;
    },
    digest() {
      // FNV-1a, enough for the schema label shown in diagnostics; the server uses real SHA-256.
      let h = 0x811c9dc5;
      for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data.charCodeAt(i), 0x01000193) >>> 0;
      return h.toString(16).padStart(16, "0");
    },
  };
  return api;
}

export function createHmac(_alg: string, key: string) {
  const h = createHash();
  h.update(key);
  return h;
}

/** Not available in the browser preview (Wise SCA signing runs on the server only). */
export function createPrivateKey(): never { throw new Error("Not available in the preview"); }
export function createPublicKey(): never { throw new Error("Not available in the preview"); }
export function sign(): never { throw new Error("Not available in the preview"); }
export function verify(): never { throw new Error("Not available in the preview"); }
