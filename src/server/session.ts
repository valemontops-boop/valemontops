import "server-only";
import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { FOUNDERS, type FounderKey } from "@/domain/constants";
import type { AppMode } from "./config";

export const SESSION_COOKIE = "vos_session";
export const OAUTH_COOKIE = "vos_oauth";
const SESSION_TTL_S = 60 * 60 * 24 * 7;

export interface Session {
  founder: FounderKey;
  role: "founder" | "admin";
  mode: AppMode;
}

function key(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export async function seal(payload: Record<string, unknown>, secret: string, ttlSeconds: number): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(key(secret));
}

export async function unseal<T>(token: string | undefined, secret: string): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key(secret));
    return payload as T;
  } catch {
    return null;
  }
}

export async function createSessionToken(s: Session, secret: string) {
  return seal({ f: s.founder, r: s.role, m: s.mode }, secret, SESSION_TTL_S);
}

/** Stateless encrypted session (spec 3.6). A DEMO session is never valid in LIVE mode and vice versa. */
export async function readSessionToken(token: string | undefined, secret: string, mode: AppMode | null): Promise<Session | null> {
  const p = await unseal<{ f?: string; r?: string; m?: string }>(token, secret);
  if (!p || !mode || p.m !== mode) return null;
  if (!FOUNDERS.includes(p.f as FounderKey)) return null;
  return { founder: p.f as FounderKey, role: p.r === "admin" ? "admin" : "founder", mode };
}

export function sessionCookieOptions(production: boolean, maxAge = SESSION_TTL_S) {
  return { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/", maxAge };
}
