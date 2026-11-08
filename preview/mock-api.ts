/**
 * In-browser stand-in for the Next.js route handlers, for the static feedback preview only.
 * Same services, same Zod schemas, same error mapping; storage is InMemoryRepository (resets on reload).
 */
import { z, ZodError } from "zod";
import { InMemoryRepository } from "@/data/memory";
import { ConflictError, NotFoundError, StorageError, ValidationError } from "@/data/repository";
import { BlockedError, ForbiddenError, RuleError } from "@/server/errors";
import { WORK_MODES, RULE_STATUSES, type FounderKey } from "@/domain/constants";
import { isValidTimeZone } from "@/domain/time";
import { seedBaseline } from "@/server/services/baseline";
import { seedDemo } from "@/server/services/demo-seed";
import { logActivity, logActivitySchema } from "@/server/services/activities";
import { getMyDay, getTargetsForEdit, profileSchema, setMode, setModeSchema, setTargets, setTargetsSchema, whatsappReport } from "@/server/services/myday";
import {
  accountTimeline, addSuppression, createAccount, createAccountSchema, createContact, createContactSchema, createOpportunity,
  createOpportunitySchema, crmSnapshot, optOutContact, optOutSchema, suppressSchema, updateAccount, updateAccountSchema,
  updateContact, updateContactSchema, updateOpportunity, updateOpportunitySchema,
} from "@/server/services/crm";
import { commit, commitSchema, exportAccountsCsv, preview, previewSchema } from "@/server/services/imports";
import { diagnostics } from "@/server/services/diagnostics";
import { userRow } from "@/server/services/common";

export const repo = new InMemoryRepository();
export let founder: FounderKey = "theo";
export function setFounder(f: FounderKey) {
  founder = f;
}

export async function seed() {
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  await seedDemo(repo);
  // Preview only: every day is a workday so the meters are visible whenever someone opens it.
  for (const f of ["theo", "pablo"] as const) {
    const u = await userRow(repo, f);
    await repo.update("Users", u.id, u.version, { workdays: [0, 1, 2, 3, 4, 5, 6] }, { founder: "system" });
  }
}

type Handler = (input: unknown, f: FounderKey) => Promise<unknown>;
const routes: Record<string, [z.ZodTypeAny | null, Handler]> = {
  "GET /api/sync": [null, async () => ({ revisions: await repo.revisions(), at: new Date().toISOString() })],
  "GET /api/my-day": [null, async (_, f) => getMyDay(repo, f)],
  "POST /api/activities": [logActivitySchema, async (i, f) => logActivity(repo, f, i as never)],
  "POST /api/report": [z.object({ next_day_priority: z.string().trim().max(300).default("") }), async (i, f) => ({ text: await whatsappReport(repo, f, (i as { next_day_priority: string }).next_day_priority) })],
  "POST /api/settings/mode": [setModeSchema, async (i, f) => setMode(repo, f, i as never)],
  "GET /api/settings/targets": [z.object({ mode: z.enum(WORK_MODES) }), async (i, f) => getTargetsForEdit(repo, f, (i as { mode: never }).mode)],
  "POST /api/settings/targets": [setTargetsSchema, async (i, f) => setTargets(repo, f, i as never)],
  "GET /api/settings/profile": [null, async (_, f) => userRow(repo, f)],
  "POST /api/settings/profile": [profileSchema, async (i, f) => {
    const v = i as z.infer<typeof profileSchema>;
    if (!isValidTimeZone(v.timezone)) throw new RuleError("Unknown time zone");
    const u = await userRow(repo, f);
    const { expected_version, ...patch } = v;
    return repo.update("Users", u.id, expected_version, patch, { founder: f });
  }],
  "GET /api/settings/channel-rules": [null, async () => (await repo.list("ChannelRules")).rows],
  "POST /api/settings/channel-rules": [
    z.object({ id: z.string().uuid(), expected_version: z.number().int(), status: z.enum(RULE_STATUSES), note: z.string().trim().max(1000), source_url: z.string().trim().max(300), review_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]) }),
    async (i, f) => {
      const v = i as { id: string; expected_version: number; status: never; note: string; source_url: string; review_date: string };
      return repo.update("ChannelRules", v.id, v.expected_version, { status: v.status, note: v.note, source_url: v.source_url, review_date: v.review_date || null }, { founder: f });
    },
  ],
  "GET /api/crm": [null, async () => crmSnapshot(repo)],
  "POST /api/crm/accounts": [createAccountSchema, async (i, f) => createAccount(repo, f, i as never)],
  "PATCH /api/crm/accounts": [updateAccountSchema, async (i, f) => updateAccount(repo, f, i as never)],
  "POST /api/crm/opportunities": [createOpportunitySchema, async (i, f) => createOpportunity(repo, f, i as never)],
  "PATCH /api/crm/opportunities": [updateOpportunitySchema, async (i, f) => updateOpportunity(repo, f, i as never)],
  "POST /api/crm/contacts": [createContactSchema, async (i, f) => createContact(repo, f, i as never)],
  "PATCH /api/crm/contacts": [updateContactSchema, async (i, f) => updateContact(repo, f, i as never)],
  "POST /api/crm/opt-out": [optOutSchema, async (i, f) => optOutContact(repo, f, i as never)],
  "POST /api/crm/suppression": [suppressSchema, async (i, f) => addSuppression(repo, f, i as never)],
  "GET /api/crm/timeline": [z.object({ account_id: z.string().uuid() }), async (i) => accountTimeline(repo, (i as { account_id: string }).account_id)],
  "POST /api/crm/import/preview": [previewSchema, async (i) => preview(repo, (i as { csv: string }).csv)],
  "POST /api/crm/import/commit": [commitSchema, async (i, f) => commit(repo, f, i as never)],
  "GET /api/diagnostics": [null, async () => diagnostics(repo)],
};

export function exportCsv() {
  return exportAccountsCsv(repo);
}

function mapError(e: unknown): [number, Record<string, unknown>] {
  if (e instanceof ZodError) return [400, { error: "validation_error", message: "Invalid input", issues: e.issues.map((i) => ({ path: i.path, message: i.message })) }];
  if (e instanceof ValidationError) return [400, { error: "validation_error", message: e.message }];
  if (e instanceof RuleError) return [422, { error: "rule", message: e.message, details: e.details }];
  if (e instanceof BlockedError) return [403, { error: "blocked", message: e.message }];
  if (e instanceof ForbiddenError) return [403, { error: "forbidden", message: e.message }];
  if (e instanceof ConflictError) return [409, { error: "conflict", message: "Someone else changed this record. Review both versions.", current: e.current }];
  if (e instanceof NotFoundError) return [404, { error: "not_found", message: "Record not found" }];
  if (e instanceof StorageError) return [503, { error: "storage", message: e.message, retryable: true }];
  console.error(e);
  return [500, { error: "internal", message: "Unexpected error" }];
}

/** Replaces window.fetch for /api/* with a small latency, so saving states are visible. */
export function installMockFetch() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    await new Promise((r) => setTimeout(r, method === "GET" ? 120 : 450));
    const route = routes[`${method} ${url.pathname}`];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (!route) return json(404, { error: "not_found", message: `${method} ${url.pathname} is not available in the preview` });
    try {
      const [schema, handler] = route;
      const raw = method === "GET" ? Object.fromEntries(url.searchParams.entries()) : init?.body ? JSON.parse(String(init.body)) : {};
      const input = schema ? schema.parse(raw) : undefined;
      return json(200, (await handler(input, founder)) ?? { ok: true });
    } catch (e) {
      const [s, b] = mapError(e);
      return json(s, b);
    }
  };
}
