import { createPublicKey, verify } from "node:crypto";

/**
 * Wise signs every webhook body with its RSA key (SHA-256), base64 in `X-Signature-SHA256`. We verify with
 * Wise's public key (WISE_WEBHOOK_PUBLIC_KEY_BASE64, copied from Wise's webhook documentation). No key → reject.
 */
export function verifyWiseSignature(rawBody: string, signatureB64: string | null, publicKeyPem: string | null): boolean {
  if (!signatureB64 || !publicKeyPem) return false;
  try {
    return verify("sha256", Buffer.from(rawBody, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
