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
import type { AppContext } from "@/server/context";
import { ConsentRequiredError } from "@/data/google/ports";
import { MemoryCalendar, MemoryDrive, MemoryDriveUploader, MemoryMailer } from "@/fake-google/store";
import { demoGoogleStore } from "@/server/services/demo-google";
import { seedDemoWork, seedPreviewRecentCalls } from "@/server/services/demo-seed";
import { createTask, createTaskSchema, listTasks, updateTask, updateTaskSchema, addComment, commentSchema, listComments } from "@/server/services/tasks";
import { applyLateCorrection, correctionSchema, getReview, reviewSchema, saveReview, streakSummary } from "@/server/services/results";
import { createSprint, sprintProgress, sprintSchema } from "@/server/services/sprints";
import { commandCenter, dismissNotification, dismissSchema, nba, notifications, saveWeekly, scorecard, scorecardCsv, weeklyReview, weeklySchema } from "@/server/services/insights";
import { addCalendarSource, addPointItem, itemToggleSchema, listCalendarSources, listPoints, pointItemSchema, pointSchema, pointUpdateSchema, proposeSlots, removeCalendarSource, schedulePoint, slotsSchema, sourceSchema, toggleItem, updatePoint, upcomingEvents } from "@/server/services/agenda";
import { addIdea, convertIdea, convertSchema, ideaSchema, ideaUpdateSchema, listIdeas, updateIdea } from "@/server/services/ideas";
import { filesFor, linkFile, linkSchema, listFolder, uploadFile, uploadSchema } from "@/server/services/files";
import { addManualEntry, addSocialAccount, audienceOverview, audienceSeries, importLinkedIn, importSchema, listAccounts, manualEntrySchema, seriesSchema, socialAccountSchema } from "@/server/services/audience";
import { childId } from "@/lib/ids";
import { MemoryBank, demoWiseStore } from "@/fake-wise/store";
import { categorySchema, csvSchema, importBankCsv, moneyOverview, setCategory, syncBank, syncStripe } from "@/server/services/bank";
import { MemoryStripe, demoStripeStore } from "@/fake-stripe";
import { LOCALE_OF, translate } from "@/i18n";
import { callLog, callLogSchema, callQueue, callSchema, callLists, endSession, endSessionSchema, listSessions, logCall, objectionReport, sessionSummary, startSession, startSessionSchema, undoCall, undoSchema } from "@/server/services/calls";
import { linkedinLog, linkedinLogSchema, linkedinQueue, linkedinSchema, linkedinSessions, linkedinSummary, linkedinSummarySchema, logLinkedIn } from "@/server/services/linkedin";
import { seedDemoLinkedIn } from "@/server/services/demo-linkedin";
import { contentLogSchema, logContent, marketingWeek } from "@/server/services/marketing-week";
import { funnelsSchema, marketingFunnels, addBreakdown, addTraffic, breakdownSchema, importTraffic, marketingOverview, overviewSchema, trafficImportSchema, trafficManualSchema } from "@/server/services/marketing";
import { dashboardSchema, reportsDashboard } from "@/server/services/dashboard";
import { exportFile, exportSchema } from "@/server/services/export";
import { trackerAction, trackerActionSchema, trackerStatus } from "@/server/services/tracker";
import { createFolder, folderSchema } from "@/server/services/files";
import { getPlaybook, playbookEditSchema, savePlaybookItem } from "@/server/services/playbook";
import { addInboxItem, inboxAddSchema, inboxListSchema, inboxStatusSchema, listInbox, setInboxStatus } from "@/server/services/inbox";
import { batchSchema, followUpQueue, sendBatch, benchmarks as emailBenchmarksFor, listSends, markReply, replySchema, sendFollowUp, sendSchema } from "@/server/services/email";

export const repo = new InMemoryRepository();
const store = demoGoogleStore();
const privates: Record<string, InMemoryRepository> = { theo: new InMemoryRepository(), pablo: new InMemoryRepository() };
export let driveGrant = false;
/** Preview stand-in for the per-founder gmail.send cookie. */
export const gmailGrant: Record<string, boolean> = { theo: false, pablo: false };
export function grantGmail() {
  gmailGrant[founder] = true;
}
export function grantDrive() {
  driveGrant = true;
}
export const ctx: AppContext = {
  repo,
  privateRepo: (f) => privates[f] ?? null,
  calendar: new MemoryCalendar(store),
  drive: new MemoryDrive(store),
  uploaderFor: (f, grant) => (grant ? new MemoryDriveUploader(store, f) : null),
  mailerFor: (f, grant) => (grant ? new MemoryMailer(store, f) : null),
  bank: new MemoryBank(demoWiseStore()),
  payments: new MemoryStripe(demoStripeStore()),
  baseUrl: "https://preview.example.com",
  mode: "demo",
};
export let founder: FounderKey = "theo";
export function setFounder(f: FounderKey) {
  founder = f;
}

export async function seed() {
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  await seedDemo(repo);
  await seedDemoWork(repo, (f) => privates[f] ?? null);
  await seedPreviewRecentCalls(repo);
  await seedDemoLinkedIn(repo);
  // Preview only: every day is a workday so the meters are visible whenever someone opens it.
  for (const f of ["theo", "pablo"] as const) {
    const u = await userRow(repo, f);
    await repo.update("Users", u.id, u.version, { workdays: [0, 1, 2, 3, 4, 5, 6] }, { founder: "system" });
  }
}

type Handler = (input: unknown, f: FounderKey) => Promise<unknown>;
const routes: Record<string, [z.ZodTypeAny | null, Handler]> = {
  "GET /api/sync": [null, async (_, f) => ({ revisions: { ...(await repo.revisions()), mine: (await privates[f].revisions()).private }, at: new Date().toISOString() })],
  "GET /api/tasks": [z.object({ view: z.enum(["mine", "theo", "pablo", "unassigned", "overdue", "all"]).default("all") }), async (i, f) => listTasks(ctx, f, (i as { view: never }).view)],
  "POST /api/tasks": [createTaskSchema, async (i, f) => createTask(ctx, f, i as never)],
  "PATCH /api/tasks": [updateTaskSchema, async (i, f) => updateTask(ctx, f, i as never)],
  "GET /api/tasks/comments": [z.object({ task_id: z.string().uuid() }), async (i) => listComments(ctx, (i as { task_id: string }).task_id)],
  "POST /api/tasks/comments": [commentSchema, async (i, f) => addComment(ctx, f, i as never)],
  "GET /api/streaks": [null, async (_, f) => streakSummary(ctx, f)],
  "POST /api/streaks/correction": [correctionSchema, async (i, f) => applyLateCorrection(ctx, f, i as never)],
  "GET /api/review": [null, async (_, f) => ({ review: await getReview(ctx, f) })],
  "POST /api/review": [reviewSchema, async (i, f) => saveReview(ctx, f, i as never)],
  "GET /api/sprints": [null, async () => ({ progress: await sprintProgress(ctx) })],
  "POST /api/sprints": [sprintSchema, async (i, f) => createSprint(ctx, f, i as never)],
  "GET /api/nba": [null, async (_, f) => nba(ctx, f)],
  "GET /api/notifications": [null, async (_, f) => notifications(ctx, f)],
  "POST /api/notifications": [dismissSchema, async (i, f) => dismissNotification(ctx, f, (i as { key: string }).key)],
  "GET /api/command-center": [null, async (_, f) => commandCenter(ctx, f)],
  "GET /api/weekly": [z.object({ week: z.string().optional() }), async (i, f) => weeklyReview(ctx, f, (i as { week?: string }).week)],
  "POST /api/weekly": [weeklySchema, async (i, f) => saveWeekly(ctx, f, i as never)],
  "GET /api/reports/scorecard": [z.object({ week: z.string().optional(), format: z.enum(["json", "csv"]).default("json") }), async (i, f) => scorecard(ctx, f, (i as { week?: string }).week)],
  "GET /api/agenda": [null, async (_, f) => upcomingEvents(ctx, f)],
  "GET /api/calendar-sources": [null, async () => listCalendarSources(ctx)],
  "POST /api/calendar-sources": [sourceSchema, async (i, f) => addCalendarSource(ctx, f, i as never)],
  "PATCH /api/calendar-sources": [z.object({ id: z.string().uuid(), expected_version: z.number().int() }), async (i, f) => removeCalendarSource(ctx, f, (i as { id: string }).id, (i as { expected_version: number }).expected_version)],
  "GET /api/points": [null, async () => listPoints(ctx)],
  "POST /api/points": [pointSchema, async (i, f) => schedulePoint(ctx, f, i as never)],
  "PATCH /api/points": [pointUpdateSchema, async (i, f) => updatePoint(ctx, f, i as never)],
  "GET /api/points/slots": [slotsSchema, async (i) => proposeSlots(ctx, (i as { duration_min: number }).duration_min)],
  "POST /api/points/items": [pointItemSchema, async (i, f) => addPointItem(ctx, f, i as never)],
  "PATCH /api/points/items": [itemToggleSchema, async (i, f) => toggleItem(ctx, f, i as never)],
  "GET /api/ideas": [null, async () => listIdeas(ctx)],
  "POST /api/ideas": [ideaSchema, async (i, f) => addIdea(ctx, f, i as never)],
  "PATCH /api/ideas": [ideaUpdateSchema, async (i, f) => updateIdea(ctx, f, i as never)],
  "POST /api/ideas/convert": [convertSchema, async (i, f) => convertIdea(ctx, f, i as never)],
  "GET /api/files": [z.object({ folder: z.string().optional(), q: z.string().default(""), view: z.enum(["folder", "recent", "search"]).default("folder") }), async (i) => listFolder(ctx, (i as { folder?: string }).folder ?? null, (i as { q: string }).q, (i as { view: "folder" }).view)],
  "POST /api/files/folder": [folderSchema, async (i, f) => createFolder(ctx, f, driveGrant ? `preview-grant-${f}` : null, i as never)],
  "POST /api/calls": [callSchema, async (i, f) => logCall(ctx, f, i as never)],
  "POST /api/calls/undo": [undoSchema, async (i, f) => undoCall(ctx, f, i as never)],
  "POST /api/linkedin": [linkedinSchema, async (i, f) => logLinkedIn(ctx, f, i as never)],
  "GET /api/linkedin/queue": [z.object({ list_id: z.string().max(40).default("") }), async (i, f) => linkedinQueue(ctx, f, (i as { list_id: string }).list_id)],
  "GET /api/linkedin/summary": [linkedinSummarySchema, async (i, f) => linkedinSummary(ctx, f, (i as { id: string }).id)],
  "GET /api/linkedin/log": [linkedinLogSchema, async (i, f) => linkedinLog(ctx, f, i as never)],
  "GET /api/linkedin/sessions": [null, async (_, f) => linkedinSessions(ctx, f)],
  "GET /api/calls/sessions": [null, async (_, f) => listSessions(ctx, f)],
  "POST /api/calls/sessions": [startSessionSchema, async (i, f) => startSession(ctx, f, i as never)],
  "PATCH /api/calls/sessions": [endSessionSchema, async (i, f) => endSession(ctx, f, (i as { id: string }).id)],
  "GET /api/calls/queue": [z.object({ list_id: z.string().max(40).default("") }), async (i, f) => callQueue(ctx, f, (i as { list_id: string }).list_id)],
  "GET /api/calls/summary": [z.object({ id: z.string().uuid() }), async (i, f) => sessionSummary(ctx, f, (i as { id: string }).id)],
  "GET /api/call-lists": [null, async () => callLists(ctx)],
  "GET /api/marketing/week": [null, async (_, f) => marketingWeek(ctx, f)],
  "POST /api/marketing/week": [contentLogSchema, async (i, f) => logContent(ctx, f, i as never)],
  "GET /api/marketing/overview": [overviewSchema, async (i, f) => marketingOverview(ctx, f, i as never)],
  "POST /api/marketing/traffic": [trafficImportSchema, async (i, f) => importTraffic(ctx, f, i as never)],
  "PUT /api/marketing/traffic": [trafficManualSchema, async (i, f) => addTraffic(ctx, f, i as never)],
  "POST /api/marketing/breakdown": [breakdownSchema, async (i, f) => addBreakdown(ctx, f, i as never)],
  "GET /api/reports/dashboard": [dashboardSchema, async (i, f) => reportsDashboard(ctx, f, i as never)],
  "GET /api/files/link": [z.object({ record_type: z.string(), record_id: z.string().uuid() }), async (i) => filesFor(ctx, (i as { record_type: string }).record_type, (i as { record_id: string }).record_id)],
  "POST /api/files/link": [linkSchema, async (i, f) => linkFile(ctx, f, i as never)],
  "POST /api/files/upload": [uploadSchema, async (i, f) => uploadFile(ctx, f, driveGrant ? `preview-grant-${f}` : null, i as never)],
  "GET /api/audience/accounts": [null, async (_, f) => listAccounts(ctx, f)],
  "POST /api/audience/accounts": [socialAccountSchema, async (i, f) => addSocialAccount(ctx, f, i as never)],
  "POST /api/audience/manual": [manualEntrySchema, async (i, f) => addManualEntry(ctx, f, i as never)],
  "POST /api/audience/import": [importSchema, async (i, f) => importLinkedIn(ctx, f, i as never)],
  "GET /api/audience/overview": [null, async (_, f) => audienceOverview(ctx, f)],
  "GET /api/audience/series": [seriesSchema, async (i, f) => audienceSeries(ctx, f, i as never)],
  "GET /api/settings/system": [null, async () => {
    const rows = (await repo.list("SystemSettings")).rows;
    return Object.fromEntries(["drive_folder_id", "founder_point_video_link", "ideas_testing_limit", "hot_lead_stale_days", "conversion_min_sample", "company_name", "calendly_url_theo", "calendly_url_pablo", "deck_url_fr", "deck_url_es", "signature_theo", "signature_pablo", "offer_consulting_value_eur", "offer_local_monthly_eur", "linkedin_daily_invitation_limit", "linkedin_weekly_invitation_limit", "time_split_target"].map((k) => [k, rows.find((r) => r.key === k)?.value ?? ""]));
  }],
  "POST /api/settings/system": [z.object({ key: z.string(), value: z.string().max(500) }), async (i, f) => {
    const { key, value } = i as { key: string; value: string };
    const id = childId("setting", key);
    const cur = await repo.get("SystemSettings", id);
    return cur ? repo.update("SystemSettings", id, cur.version, { value }, { founder: f }) : repo.insert("SystemSettings", [{ id, key, value, description: "" }], { founder: f });
  }],
  "GET /api/my-day": [null, async (_, f) => getMyDay(repo, f)],
  "GET /api/playbook": [null, async (_, f) => getPlaybook(ctx, f)],
  "POST /api/playbook": [playbookEditSchema, async (i, f) => savePlaybookItem(ctx, f, i as never)],
  "GET /api/calls/log": [callLogSchema, async (i, f) => callLog(ctx, f, i as never)],
  "GET /api/calls/objections": [null, async (_, f) => objectionReport(ctx, f)],
  "GET /api/email/status": [null, async (_, f) => ({ connected: gmailGrant[f], mode: "demo" })],
  "DELETE /api/email/status": [null, async (_, f) => { gmailGrant[f] = false; return { connected: false }; }],
  "POST /api/email/send": [sendSchema, async (i, f) => sendFollowUp(ctx, f, gmailGrant[f] ? `preview-gmail-${f}` : null, i as never)],
  "GET /api/email/sends": [null, async () => listSends(ctx)],
  "PATCH /api/email/sends": [replySchema, async (i, f) => markReply(ctx, f, i as never)],
  "GET /api/email/benchmarks": [null, async (_, f) => emailBenchmarksFor(ctx, f)],
  "GET /api/money": [null, async (_, f) => moneyOverview(ctx, f)],
  "POST /api/money/sync": [null, async (_, f) => syncBank(ctx, { founder: f })],
  "POST /api/money/stripe-sync": [null, async (_, f) => syncStripe(ctx, { founder: f })],
  "PATCH /api/money/category": [categorySchema, async (i, f) => setCategory(ctx, f, i as never)],
  "POST /api/money/import": [csvSchema, async (i, f) => importBankCsv(ctx, f, i as never)],
  "GET /api/marketing/funnels": [funnelsSchema, async (i, f) => marketingFunnels(ctx, f, i as never)],
  "GET /api/inbox": [inboxListSchema, async (i, f) => listInbox(ctx, f, i as never)],
  "POST /api/inbox": [inboxAddSchema, async (i, f) => addInboxItem(ctx, f, i as never)],
  "PATCH /api/inbox": [inboxStatusSchema, async (i, f) => setInboxStatus(ctx, f, i as never)],
  "GET /api/email/queue": [null, async (_, f) => followUpQueue(ctx, f)],
  "POST /api/email/batch": [batchSchema, async (i, f) => sendBatch(ctx, f, gmailGrant[f] ? `preview-gmail-${f}` : null, i as never)],
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
  // Export for AI: Markdown downloads in the preview (Excel needs the installed app).
  "GET /api/export": [exportSchema, async (i, f) => {
    const x = await exportFile(ctx, f, i as never);
    return new Response(x.body as BodyInit, { headers: { "content-type": x.contentType, "content-disposition": `attachment; filename="${x.filename}"` } });
  }],
  "GET /api/tracker": [null, async (_, f) => trackerStatus(ctx, f, {})],
  "POST /api/tracker": [trackerActionSchema, async (i, f) => trackerAction(ctx, f, i as never, {})],
};

export function exportCsv(href = "/api/crm/export") {
  if (href.startsWith("/api/reports/scorecard")) return scorecardCsv(ctx, founder);
  return exportAccountsCsv(repo);
}

function mapError(e: unknown): [number, Record<string, unknown>] {
  if (e instanceof ConsentRequiredError) return [409, { error: "consent_required", message: "Allow Valemont OS to create files in your Google Drive first.", url: e.url }];
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
      const out = await handler(input, founder);
      return out instanceof Response ? out : json(200, out ?? { ok: true });
    } catch (e) {
      const [s, b] = mapError(e);
      if (typeof b.message === "string") b.message = translate(LOCALE_OF[founder], b.message);
      return json(s, b);
    }
  };
}
