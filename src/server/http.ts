import "server-only";
import { after, NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { ConflictError, NotFoundError, StorageError, ValidationError, type DataRepository } from "@/data/repository";
import { getConfig } from "./config";
import { getContext, SetupRequiredError } from "./repo";
import type { AppContext } from "./context";
import { ConsentRequiredError } from "@/data/google/ports";
import { SESSION_COOKIE, readSessionToken, type Session } from "./session";

import { BlockedError, ForbiddenError, RuleError } from "./errors";
import { LOCALE_OF, translate } from "@/i18n";
import type { FounderKey } from "@/domain/constants";
import { logger, requestIdFrom } from "./log";
import { BodyTooLargeError, clientIp, ipHash, isCrossOrigin, readCappedText } from "./guard";
import { enqueueAudit, flushAudit } from "./services/audit-log";
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
    // Correlation id (D084): the proxy's or the caller's x-request-id when it is a safe token, else a new UUID.
    const correlationId = requestIdFrom(req.headers.get("x-request-id"));
    const ids = { "x-request-id": correlationId, "x-correlation-id": correlationId };
    let status = 200;
    let founder: FounderKey | null = null;
    let input: unknown = undefined;
    let result: unknown = undefined;
    let auditRepo: DataRepository | null = null;
    let secret = "";
    const mutating = req.method !== "GET" && req.method !== "HEAD";
    try {
      const cfg = getConfig();
      if (!cfg.ok) throw new SetupRequiredError(cfg.errors);
      secret = cfg.sessionSecret;
      const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, cfg.sessionSecret, cfg.mode);
      founder = session?.founder ?? null;
      if (!session) {
        status = 401;
        return NextResponse.json({ error: "unauthenticated" }, { status, headers: ids });
      }
      const app = await getContext();
      auditRepo = app.repo; // from here on, a mutation attempt is audited, refused ones included
      if (mutating && isCrossOrigin(req)) {
        status = 403;
        return NextResponse.json({ error: "bad_origin" }, { status, headers: ids });
      }
      if (schema) {
        let raw: unknown;
        if (mutating) {
          const text = await readCappedText(req, MAX_BODY);
          raw = text ? JSON.parse(text) : {};
        } else {
          raw = Object.fromEntries(req.nextUrl.searchParams.entries());
        }
        input = schema.parse(raw);
      }
      result = await handler({ session, repo: app.repo, app, input: input as never, req, correlationId });
      if (result instanceof Response) {
        status = result.status;
        try {
          for (const [k, v] of Object.entries(ids)) result.headers.set(k, v);
        } catch {
          /* immutable headers (proxied response): the id is still in the log */
        }
        return result;
      }
      return NextResponse.json(result ?? { ok: true }, { headers: ids });
    } catch (e) {
      const [s, body] = mapError(e, correlationId);
      status = s;
      // Messages reach the founder in their own language (D048); unknown sentences stay as written.
      if (founder && typeof body.message === "string") body.message = translate(LOCALE_OF[founder], body.message);
      return NextResponse.json({ ...body, correlationId }, { status: s, headers: ids });
    } finally {
      // Structured log: no bodies, no personal data, no secrets (redacted by the logger anyway).
      const ms = Date.now() - started;
      logger[status >= 500 ? "error" : status >= 400 ? "warn" : "info"]("request", { correlationId, method: req.method, path: req.nextUrl.pathname, status, ms, founder });
      // Audit trail (spec 3.9, D084): every authenticated mutation, refused ones included, written after the response.
      if (mutating && founder && auditRepo) {
        const repo = auditRepo;
        enqueueAudit(repo, { founder, method: req.method, path: req.nextUrl.pathname, status, correlationId, input, result: result instanceof Response ? undefined : result, ipHash: ipHash(clientIp(req), secret), secret });
        const flush = () => flushAudit(repo);
        try {
          after(flush);
        } catch {
          void flush(); // outside a request scope (tests, scripts)
        }
      }
    }
  };
}

function mapError(e: unknown, correlationId = ""): [number, Record<string, unknown>] {
  if (e instanceof BodyTooLargeError) return [413, { error: "too_large", message: "Request too large" }];
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
  logger.error("unhandled", { correlationId, error: e as Error });
  return [500, { error: "internal", message: "Unexpected error" }];
}
