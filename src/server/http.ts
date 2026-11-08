import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { ConflictError, NotFoundError, StorageError, ValidationError, type DataRepository } from "@/data/repository";
import { getConfig } from "./config";
import { getContext, SetupRequiredError } from "./repo";
import type { AppContext } from "./context";
import { ConsentRequiredError } from "@/data/google/ports";
import { SESSION_COOKIE, readSessionToken, type Session } from "./session";

import { BlockedError, ForbiddenError, RuleError } from "./errors";
export { BlockedError, ForbiddenError, RuleError };

const MAX_BODY = 1_200_000;

export interface Ctx<I> {
  session: Session;
  repo: DataRepository;
  app: AppContext;
  input: I;
  req: NextRequest;
  correlationId: string;
}

/**
 * Every API route goes through here: setup check, session, same-origin check on mutations,
 * body size limit, Zod validation, error mapping, structured log without personal data.
 */
export function route<S extends z.ZodTypeAny | undefined>(
  schema: S,
  handler: (ctx: Ctx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>,
) {
  return async (req: NextRequest) => {
    const started = Date.now();
    const correlationId = randomUUID();
    let status = 200;
    try {
      const cfg = getConfig();
      if (!cfg.ok) throw new SetupRequiredError(cfg.errors);
      const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
      if (!session) {
        status = 401;
        return NextResponse.json({ error: "unauthenticated" }, { status });
      }
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (mutating) {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== req.headers.get("host")) {
          status = 403;
          return NextResponse.json({ error: "bad_origin" }, { status });
        }
      }
      let input: unknown = undefined;
      if (schema) {
        let raw: unknown;
        if (mutating) {
          const text = await req.text();
          if (text.length > MAX_BODY) throw new ValidationError("Request too large");
          raw = text ? JSON.parse(text) : {};
        } else {
          raw = Object.fromEntries(req.nextUrl.searchParams.entries());
        }
        input = schema.parse(raw);
      }
      const app = await getContext();
      const result = await handler({ session, repo: app.repo, app, input: input as never, req, correlationId });
      if (result instanceof Response) {
        status = result.status;
        return result;
      }
      return NextResponse.json(result ?? { ok: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e) {
      const [s, body] = mapError(e);
      status = s;
      return NextResponse.json({ ...body, correlationId }, { status: s });
    } finally {
      // Structured log: no bodies, no personal data, no secrets.
      console.info(JSON.stringify({ at: new Date().toISOString(), correlationId, method: req.method, path: req.nextUrl.pathname, status, ms: Date.now() - started }));
    }
  };
}

function mapError(e: unknown): [number, Record<string, unknown>] {
  if (e instanceof ConsentRequiredError) return [409, { error: "consent_required", message: e.scope.includes("gmail") ? "Connect your Gmail first (send only, no inbox access)." : "Allow Valemont OS to create files in your Google Drive first.", url: e.url, scope: e.scope }];
  if (e instanceof SetupRequiredError) return [503, { error: "setup_required", message: "Setup required", details: e.errors }];
  if (e instanceof ZodError) return [400, { error: "validation_error", message: "Invalid input", issues: e.issues.map((i) => ({ path: i.path, message: i.message })) }];
  if (e instanceof SyntaxError) return [400, { error: "validation_error", message: "Malformed JSON" }];
  if (e instanceof ValidationError) return [400, { error: "validation_error", message: e.message, issues: e.issues }];
  if (e instanceof RuleError) return [422, { error: "rule", message: e.message, details: e.details }];
  if (e instanceof BlockedError) return [403, { error: "blocked", message: e.message }];
  if (e instanceof ForbiddenError) return [403, { error: "forbidden", message: e.message }];
  if (e instanceof ConflictError) return [409, { error: "conflict", message: "Someone else changed this record. Review both versions.", current: e.current }];
  if (e instanceof NotFoundError) return [404, { error: "not_found", message: "Record not found" }];
  if (e instanceof StorageError) return [503, { error: "storage", message: e.message, retryable: e.retryable }];
  console.error(JSON.stringify({ at: new Date().toISOString(), level: "error", name: (e as Error)?.name, message: (e as Error)?.message }));
  return [500, { error: "internal", message: "Unexpected error" }];
}
