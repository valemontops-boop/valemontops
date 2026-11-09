/** Business-rule errors shared by services (no server-only imports, so services stay portable). */
export class BlockedError extends Error {
  readonly code = "blocked";
}
export class ForbiddenError extends Error {
  readonly code = "forbidden";
}
export class RuleError extends Error {
  readonly code = "rule";
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}
