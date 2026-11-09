import { beforeEach, describe, expect, it } from "vitest";
import Papa from "papaparse";
import { InMemoryRepository } from "@/data/memory";
import type { DataRepository } from "@/data/repository";
import type { AppContext } from "@/server/context";
import { seedBaseline } from "@/server/services/baseline";
import { seedDemo, seedDemoWork } from "@/server/services/demo-seed";
import { seedDemoContent } from "@/server/services/demo-content";
import { CSV_LISTS, commitListImport, exportList, previewListImport } from "@/server/services/csv-lists";
import { integrationHub, syncIntegration, testIntegration } from "@/server/services/integrations";
import { recordIntegration } from "@/server/services/integration-status";
import { hubStatus, envPresence, INTEGRATIONS } from "@/domain/integrations";
import { escapeCsvCell } from "@/domain/csv";
import { MemoryBank, demoWiseStore } from "@/fake-wise/store";
import { RuleError } from "@/server/errors";
import { newId } from "@/lib/ids";

const EVIL = "=HYPERLINK(\"http://x.example\")"; // ≤ 40 characters: fits every exported column
let repo: DataRepository;
let priv: Record<string, InMemoryRepository>;
let ctx: AppContext;
const ctxOf = (r: DataRepository, mode: "live" | "demo" = "demo"): AppContext => ({ repo: r, privateRepo: (f) => priv[f] ?? null, calendar: null, drive: null, uploaderFor: () => null, mailerFor: () => null, baseUrl: "", mode });

beforeEach(async () => {
  repo = new InMemoryRepository();
  priv = { theo: new InMemoryRepository(), pablo: new InMemoryRepository() };
  await seedBaseline(repo, { theo: "Europe/Paris", pablo: "Europe/Madrid" });
  await seedDemo(repo);
  await seedDemoWork(repo, (f) => priv[f] ?? null);
  await seedDemoContent(repo);
  ctx = ctxOf(repo);
});

/** Puts a formula-like value in one free-text field of the first row of a table. */
async function poison<T extends Parameters<DataRepository["list"]>[0]>(table: T, field: string) {
  const row = (await repo.list(table, { fresh: true })).rows.find((r) => !r.is_archived);
  if (!row) return false;
  await repo.update(table, row.id, row.version, { [field]: EVIL } as never, { founder: "theo" });
  return true;
}

describe("CSV export everywhere (spec 4.5)", () => {
  const FIELD: Record<(typeof CSV_LISTS)[number], [string, string]> = {
    accounts: ["Accounts", "notes"], contacts: ["Contacts", "full_name"], deals: ["Opportunities", "next_action"], calls: ["ActivityEvents", "notes"], tasks: ["Tasks", "title"],
    content: ["ContentVariants", "caption"], quotes: ["Quotes", "reference"], projects: ["Projects", "name"], bank: ["BankTransactions", "description"], local_usage: ["LocalSubscriptionUsage", "note"],
  };
  it.each(CSV_LISTS)("%s: formula-like text is neutralised, the file parses back", async (list) => {
    const [table, field] = FIELD[list];
    // Lists without demo rows get one row through the same path as founders (bank: a demo statement row).
    if (list === "bank") await repo.insert("BankTransactions", [{ id: newId(), bank: "wise", source_id: "tx-test-1", origin: "csv", balance_id: "b1", currency: "EUR", amount_minor: -1234, fee_minor: 0, direction: "debit", date: "2026-11-05", occurred_at: "2026-11-05T10:00:00.000Z", description: "Test", counterparty: "+Fournisseur", bank_type: "", merchant_category: "", category: "other_expense", category_source: "auto", running_balance_minor: null, note: "" }], { founder: "theo" });
    if (list === "quotes") {
      const opp = (await repo.list("Opportunities")).rows[0];
      await repo.insert("Quotes", [{ id: newId(), quote_group_id: newId(), quote_version: 1, reference: "Q-TEST-1", opportunity_id: opp.id, account_id: opp.account_id, audit_session_id: "", status: "draft", author: "theo", currency: "EUR", language: "FR", client_country: "FR", valid_until: null, payment_terms: "", term_months: null, discount_bp: 0, contingency_bp: 0, hour_cost_minor: 3000, tax_rule: null, approval_required: false, approvals: [], trade_recorded: "", scope: "", exclusions: "", milestones: [], risks: "", pilot_terms: "", notes: "", lines_rev: "", sent_at: null, sent_by: null, decided_at: null, decided_by: null, decline_reason: "", superseded_by: "", pdf_drive_file_id: "" } as never], { founder: "theo" });
    }
    if (list === "calls" && !(await repo.list("ActivityEvents")).rows.some((e) => ["cold_call", "connected_call", "voicemail"].includes(e.activity_type))) throw new Error("no demo call");
    const poisoned = list === "calls"
      ? await (async () => { const e = (await repo.list("ActivityEvents", { fresh: true })).rows.find((x) => ["cold_call", "connected_call", "voicemail"].includes(x.activity_type))!; await repo.update("ActivityEvents", e.id, e.version, { notes: EVIL }, { founder: "theo" }); return true; })()
      : await poison(table as never, field);
    expect(poisoned).toBe(true);
    const x = await exportList(ctx, "theo", { list });
    expect(x.rows).toBeGreaterThan(0);
    expect(x.filename).toMatch(/^valemont-[a-z-]+-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(x.csv).toContain(`"'${EVIL.replace(/"/g, '""')}"`);
    expect(x.csv).not.toMatch(/(^|,)"=HYPERLINK/m);
    const parsed = Papa.parse<string[]>(x.csv, { skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.length).toBe(x.rows + 1);
  });
  it("phone columns keep +33 numbers but neutralise anything that is not a phone", () => {
    expect(escapeCsvCell("+33 6 12 34 56 78", "phone")).toBe('"+33 6 12 34 56 78"');
    expect(escapeCsvCell("=1+1", "phone")).toBe(`"'=1+1"`);
    expect(escapeCsvCell("@SUM(A1)", "text")).toBe(`"'@SUM(A1)"`);
  });
  it("period filter keeps only rows inside the period; tasks include only my own private tasks", async () => {
    const all = await exportList(ctx, "theo", { list: "calls" });
    const none = await exportList(ctx, "theo", { list: "calls", from: "2001-01-01", to: "2001-01-31" });
    expect(none.rows).toBe(0);
    expect(all.rows).toBeGreaterThan(0);
    expect(none.filename).toContain("2001-01-01_2001-01-31");
    await priv.pablo.insert("PrivateTasks", [{ id: newId(), title: "Secret de Pablo", description: "", owner: "pablo", created_by_founder: "pablo", account_id: "", opportunity_id: "", project_id: "", client_id: "", priority: "P2", status: "todo", estimated_minutes: null, due_at: null, recurrence: "none", recurrence_days: [], recurrence_parent_id: "", dependency_ids: [], completion_evidence: "", completed_at: null, visibility: "private", snoozed_until: null, snooze_reason: "", area: "sales", source: "manual", source_id: "" }], { founder: "pablo" });
    expect((await exportList(ctx, "theo", { list: "tasks" })).csv).not.toContain("Secret de Pablo");
    expect((await exportList(ctx, "pablo", { list: "tasks" })).csv).toContain("Secret de Pablo");
  });
  it("calls never carry a phone number", async () => {
    const x = await exportList(ctx, "theo", { list: "calls" });
    expect(x.csv.split("\r\n")[0]).not.toMatch(/phone|téléphone/i);
  });
});

describe("CSV import with preview and dedupe (tasks, content ideas)", () => {
  const tasksCsv = "title,owner,priority,due,area,estimated minutes\nAppeler le comptable,Théo,P1,15/11/2026,ops,30\nAppeler le comptable,Théo,P1,2026-11-15,ops,30\n,Pablo,P2,,sales,\nRelancer devis,Martin,P2,,sales,\nPréparer le salon,,,,marketing,abc\n";
  it("previews without writing, dedupes in the file and against existing tasks, then commits only new rows, once", async () => {
    const before = (await repo.list("Tasks", { fresh: true })).rows.length;
    const p = await previewListImport(ctx, "theo", { kind: "tasks", csv: tasksCsv });
    expect(p.rows.map((r) => r.status)).toEqual(["new", "duplicate", "invalid", "invalid", "invalid"]);
    expect(p.rows[1].duplicateOf).toBe(0);
    expect(p.rows[3].errors).toContain("Owner: Théo, Pablo or empty");
    expect((await repo.list("Tasks", { fresh: true })).rows.length).toBe(before);
    const import_id = newId();
    expect(await commitListImport(ctx, "theo", { kind: "tasks", csv: tasksCsv, import_id })).toEqual({ imported: 1, skipped: 4 });
    const t = (await repo.list("Tasks", { fresh: true })).rows.find((x) => x.title === "Appeler le comptable")!;
    expect(t).toMatchObject({ owner: "theo", priority: "P1", due_at: "2026-11-15", area: "ops", estimated_minutes: 30, visibility: "team" });
    // Same import again: nothing more; a new import of the same file: the row is now a duplicate of an existing task.
    expect((await commitListImport(ctx, "theo", { kind: "tasks", csv: tasksCsv, import_id })).imported).toBe(0);
    expect((await previewListImport(ctx, "theo", { kind: "tasks", csv: tasksCsv })).rows[0]).toMatchObject({ status: "duplicate", duplicateOf: "existing" });
    expect((await repo.list("Tasks", { fresh: true })).rows.length).toBe(before + 1);
  });
  it("content ideas become pieces at the idea stage with their language versions", async () => {
    const csv = "idea,format,brand,hook\n=Les 3 erreurs des artisans,reel,30/30,Vous perdez des appels\nIdée deux,carousel,Valemont,\nIdée trois,podcast,,\n";
    const p = await previewListImport(ctx, "theo", { kind: "content_ideas", csv });
    expect(p.counts).toEqual({ new: 2, duplicate: 0, invalid: 1 });
    const r = await commitListImport(ctx, "theo", { kind: "content_ideas", csv, import_id: newId() });
    expect(r.imported).toBe(2);
    const pieces = (await repo.list("ContentPieces", { fresh: true })).rows.filter((x) => x.title === "=Les 3 erreurs des artisans" || x.title === "Idée deux");
    expect(pieces.map((x) => [x.title, x.stage, x.brand]).sort()).toEqual([["=Les 3 erreurs des artisans", "idea", "thirty"], ["Idée deux", "idea", "consulting"]]);
  });
  it("column names follow the founder's language, and an exported task list imports back (all duplicates)", async () => {
    const fr = await exportList(ctx, "theo", { list: "tasks" });
    const es = await exportList(ctx, "pablo", { list: "tasks" });
    expect(fr.csv.split("\r\n")[0]).toContain('"Titre"');
    expect(es.csv.split("\r\n")[0]).toContain('"Título"');
    const p = await previewListImport(ctx, "theo", { kind: "tasks", csv: fr.csv });
    expect(p.unrecognized).not.toContain("Titre");
    expect(p.counts.new).toBe(0);
    expect((await exportList(ctx, "theo", { list: "local_usage" })).csv.split("\r\n")[0]).toBe('"client","month","conversations","qualified_requests","automated_emails","support_minutes","locations","actual_cost","note"');
  });
  it("refuses a file without a title column", async () => {
    await expect(previewListImport(ctx, "theo", { kind: "tasks", csv: "name,owner\nx,theo\n" })).rejects.toBeInstanceOf(RuleError);
  });
});

describe("Integrations Hub status mapping (spec 7, 4.12)", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const row = (status: string) => ({ status, last_success_at: "2026-11-09T09:00:00Z", last_error: status === "error" ? "401 Unauthorized" : "", updated_at: "2026-11-09T09:30:00Z" });
  it("maps honestly: import-only, approval, demo, not configured, renewal, error, connected", () => {
    expect(hubStatus({ mode: "live", kind: "import", configured: true, row: row("ok"), now }).status).toBe("import_only");
    expect(hubStatus({ mode: "live", kind: "approval", configured: true, row: null, now }).status).toBe("pending_approval");
    expect(hubStatus({ mode: "demo", kind: "credential", configured: true, row: row("ok"), now }).status).toBe("demo");
    expect(hubStatus({ mode: "live", kind: "credential", configured: false, row: row("ok"), now }).status).toBe("not_configured");
    expect(hubStatus({ mode: "live", kind: "credential", configured: true, row: row("ok"), expiresAt: "2026-11-20", now })).toEqual({ status: "needs_renewal", daysLeft: 10 });
    expect(hubStatus({ mode: "live", kind: "credential", configured: true, row: row("ok"), expiresAt: "2027-02-01", now }).status).toBe("connected");
    expect(hubStatus({ mode: "live", kind: "credential", configured: true, row: row("error"), now }).status).toBe("error");
    expect(hubStatus({ mode: "live", kind: "credential", configured: true, row: null, now }).status).toBe("connected");
  });
  it("env presence by name only, never the value", () => {
    const e = envPresence([{ name: "TRACKER_WEBHOOK_URL_{F}", required: true }, { name: "X_OPT", required: false }], { TRACKER_WEBHOOK_URL_PABLO: "https://tracker.example.com/hook" }, "PABLO");
    expect(e).toEqual([{ name: "TRACKER_WEBHOOK_URL_PABLO", required: true, set: true }, { name: "X_OPT", required: false, set: false }]);
    expect(JSON.stringify(e)).not.toContain("tracker.example.com");
  });
  it("lists every integration of spec 7 once", () => {
    expect(INTEGRATIONS.map((i) => i.key)).toEqual(["sheets", "signin", "drive", "calendar", "gmail", "wise", "stripe", "instagram", "linkedin", "ga4", "search_console", "website", "inbox", "tracker", "snapshot", "backup"]);
  });
  it("DEMO: no integration claims a real connection; LinkedIn is awaiting approval; actions never sync", async () => {
    const h = await integrationHub(ctx, "theo", { gmail: true, drive: false }, { WEBSITE_WEBHOOK_SECRET: "s".repeat(40) });
    expect(h.items.some((i) => i.status === "connected")).toBe(false);
    expect(h.items.find((i) => i.key === "linkedin")!.status).toBe("pending_approval");
    expect(h.items.find((i) => i.key === "ga4")!.status).toBe("import_only");
    expect(h.items.flatMap((i) => i.actions)).not.toContain("sync");
    expect(JSON.stringify(h)).not.toContain("s".repeat(40));
    await expect(syncIntegration(ctx, "theo", { key: "wise" })).rejects.toBeInstanceOf(RuleError);
  });
  it("LIVE: secrets missing → not configured with the missing names; errors recorded with time; Gmail by grant", async () => {
    const live = ctxOf(repo, "live");
    live.bank = new MemoryBank(demoWiseStore());
    const env = { WEBSITE_WEBHOOK_SECRET: "w".repeat(40), WISE_API_TOKEN: "x" };
    await recordIntegration(repo, "website", false, "storage unavailable");
    const h = await integrationHub(live, "pablo", { gmail: false, drive: false }, env);
    const by = Object.fromEntries(h.items.map((i) => [i.key, i]));
    expect(by.website).toMatchObject({ status: "error", lastError: "storage unavailable" });
    expect(by.website.lastErrorAt).toBeTruthy();
    expect(by.wise.status).toBe("connected");
    expect(by.wise.actions).toEqual(["test", "sync"]);
    expect(by.stripe).toMatchObject({ status: "not_configured", actions: [] });
    expect(by.stripe.env.find((e: { name: string }) => e.name === "STRIPE_API_KEY")).toMatchObject({ set: false, required: true });
    expect(by.gmail.status).toBe("not_configured");
    expect(by.gmail.actions).toEqual(["reauthorize"]);
    expect(by.tracker.env.map((e: { name: string }) => e.name)).toContain("TRACKER_WEBHOOK_URL_PABLO");
    expect(by.sheets.status).toBe("connected");
    expect(by.linkedin.status).toBe("pending_approval");
    // A successful test clears the error.
    expect((await testIntegration(live, "pablo", { key: "website" }, env)).ok).toBe(true);
    expect((await testIntegration(live, "pablo", { key: "wise" }, env)).ok).toBe(true);
    expect((await testIntegration(live, "pablo", { key: "stripe" }, env))).toMatchObject({ ok: false });
    expect((await testIntegration(live, "pablo", { key: "inbox" }, { INBOX_WEBHOOK_SECRET: "short" }))).toMatchObject({ ok: false, message: "The secret is too short: use 32+ random characters (openssl rand -hex 32)." });
    await recordIntegration(repo, "website", true);
    expect((await integrationHub(live, "pablo", { gmail: true, drive: false }, env)).items.find((i) => i.key === "gmail")!.status).toBe("connected");
  });
  it("Instagram token within 14 days of expiry → needs renewal", async () => {
    const live = ctxOf(repo, "live");
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    live.instagram = [{ key: "ig-valemont", expiresAt: soon, port: {} as never }];
    const ig = (await integrationHub(live, "theo", { gmail: false, drive: false }, {})).items.find((i) => i.key === "instagram")!;
    expect(ig.status).toBe("needs_renewal");
    expect(ig.daysLeft).toBeLessThanOrEqual(5);
  });
});
