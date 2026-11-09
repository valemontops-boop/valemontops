import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { rateLimit } from "@/server/guard";
import { vaultAction, vaultActionSchema, vaultOverview } from "@/server/services/vault";

/** At most 20 connector changes per founder per minute (per server instance): an abuse brake on the vault. */
const VAULT_RATE = { limit: 20, windowMs: 60_000 };

/**
 * Settings › Integrations › Configure (D087). GET: what is configured, where it comes from (Vercel or the app), the
 * last 4 characters of long secrets, who changed it and when — never a secret value. POST: save / generate / delete /
 * re-encrypt. Founder session, same-origin, Zod and audit (names only) through route().
 */
export const GET = route(undefined, async ({ app, session }) => vaultOverview(app, session.founder, session.role));

export const POST = route(vaultActionSchema, async ({ app, session, input }) => {
  const wait = rateLimit("connector-vault", session.founder, VAULT_RATE);
  if (wait) return NextResponse.json({ error: "rate_limited", message: "Too many changes: wait a minute." }, { status: 429, headers: { "retry-after": String(wait), "cache-control": "no-store" } });
  const r = await vaultAction(app, session.founder, input, session.role);
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
});
