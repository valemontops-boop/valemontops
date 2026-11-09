import { JWT } from "google-auth-library";

export const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/** Decodes GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 (spec 3.5: base64 avoids newline issues on hosts). */
export function decodeServiceAccountKey(b64: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64.trim(), "base64").toString("utf8"));
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON");
  }
  const k = parsed as Partial<ServiceAccountKey>;
  if (!k.client_email || !k.private_key) {
    throw new Error("Service account key must contain client_email and private_key");
  }
  return { client_email: k.client_email, private_key: k.private_key };
}

export function serviceAccountTokenProvider(key: ServiceAccountKey, scopes = SHEETS_SCOPES) {
  const jwt = new JWT({ email: key.client_email, key: key.private_key, scopes });
  return async () => {
    const t = await jwt.getAccessToken();
    if (!t.token) throw new Error("Could not obtain a Google access token");
    return t.token;
  };
}
