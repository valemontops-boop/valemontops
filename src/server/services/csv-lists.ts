import Papa from "papaparse";
import { z } from "zod";
import type { Row } from "@/data/schema/tables";
import type { FounderKey } from "@/domain/constants";
import { dedupeEvents } from "@/domain/activity";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, toCsv, type ExportColumn } from "@/domain/csv";
import { CONTENT_FORMATS } from "@/domain/content-studio";
import { childId } from "@/lib/ids";
import { LOCALE_OF, translate } from "@/i18n";
import { RuleError } from "../errors";
import type { AppContext } from "../context";
import { createTask } from "./tasks";
import { createPiece, createPieceSchema } from "./content-studio";

/**
 * CSV everywhere (Stage 4A, D083). One safe export per main list, through toCsv(): free text has a leading = + - @
 * tab or CR neutralised with an apostrophe (spec 4.5), typed columns stay intact. Private data: tasks include only the
 * signed-in founder's own private tasks; calls never include a dialled number (only the business name).
 */
export const CSV_LISTS = ["accounts", "contacts", "deals", "calls", "tasks", "content", "quotes", "projects", "bank", "local_usage"] as const;
export type CsvList = (typeof CSV_LISTS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const csvExportSchema = z.object({ list: z.enum(CSV_LISTS), from: day.optional(), to: day.optional() }).refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from must be before to", path: ["from"] });

const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));
const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const live = <R extends { is_archived?: boolean }>(rows: R[]) => rows.filter((r) => !r.is_archived);

/** Rows and columns of one list, already filtered by period (inclusive, on the list's own date). */
export async function exportList(ctx: AppContext, founder: FounderKey, input: z.infer<typeof csvExportSchema>): Promise<{ filename: string; csv: string; rows: number }> {
  const inPeriod = (d: string | null | undefined) => (!input.from || (d ?? "") >= input.from) && (!input.to || (d ?? "").slice(0, 10) <= input.to) && (!(input.from || input.to) || Boolean(d));
  // Column names in the founder's language (D048); Local usage keeps its import headers so it can be imported back.
  const label = (l: string) => (input.list === "local_usage" ? l : translate(LOCALE_OF[founder], l));
  const out = <R>(rows: R[], cols: ExportColumn<R>[]) => ({ csv: toCsv(rows, cols.map((c) => ({ ...c, label: label(c.label) }))), rows: rows.length });
  const r = await (async () => {
    switch (input.list) {
      case "accounts": {
        const t = await ctx.repo.listMany(["Accounts"]);
        return out(live(t.Accounts.rows).filter((a) => inPeriod(dayOf(a.created_at))), [
          { label: "id", kind: "id", get: (a) => a.id }, { label: "Company", kind: "text", get: (a) => a.name }, { label: "Country", kind: "text", get: (a) => a.country },
          { label: "City", kind: "text", get: (a) => a.city }, { label: "Sector", kind: "text", get: (a) => a.sector }, { label: "Niche", kind: "text", get: (a) => a.niche },
          { label: "Website", kind: "text", get: (a) => a.website }, { label: "Phone", kind: "phone", get: (a) => a.phone }, { label: "Email", kind: "text", get: (a) => a.email },
          { label: "Lead type", kind: "text", get: (a) => a.lead_type }, { label: "Lead source", kind: "text", get: (a) => a.lead_source }, { label: "Owner", kind: "text", get: (a) => a.owner_founder },
          { label: "Status", kind: "text", get: (a) => a.lead_status }, { label: "Created", kind: "date", get: (a) => dayOf(a.created_at) }, { label: "Notes", kind: "text", get: (a) => a.notes },
        ]);
      }
      case "contacts": {
        const t = await ctx.repo.listMany(["Accounts", "Contacts"]);
        const acc = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));
        return out(live(t.Contacts.rows).filter((c) => inPeriod(dayOf(c.created_at))), [
          { label: "id", kind: "id", get: (c) => c.id }, { label: "Company", kind: "text", get: (c) => acc.get(c.account_id) }, { label: "Name", kind: "text", get: (c) => c.full_name },
          { label: "Role", kind: "text", get: (c) => c.role }, { label: "Phone", kind: "phone", get: (c) => c.phone }, { label: "Email", kind: "text", get: (c) => c.email },
          { label: "Type", kind: "text", get: (c) => c.contact_type }, { label: "Consent", kind: "text", get: (c) => c.consent_status }, { label: "Lawful basis", kind: "text", get: (c) => c.lawful_basis },
          { label: "Source", kind: "text", get: (c) => c.source }, { label: "Created", kind: "date", get: (c) => dayOf(c.created_at) },
        ]);
      }
      case "deals": {
        const t = await ctx.repo.listMany(["Accounts", "Opportunities"]);
        const acc = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));
        return out(live(t.Opportunities.rows).filter((o) => inPeriod(dayOf(o.created_at))), [
          { label: "id", kind: "id", get: (o) => o.id }, { label: "Deal", kind: "text", get: (o) => o.name }, { label: "Company", kind: "text", get: (o) => acc.get(o.account_id) },
          { label: "Offer", kind: "text", get: (o) => o.brand }, { label: "Stage", kind: "text", get: (o) => o.stage }, { label: "Owner", kind: "text", get: (o) => o.owner_founder },
          { label: "Value", kind: "amount", get: (o) => money(o.value_minor) }, { label: "Currency", kind: "text", get: (o) => o.currency }, { label: "Expected close", kind: "date", get: (o) => o.expected_close },
          { label: "Next action", kind: "text", get: (o) => o.next_action }, { label: "Next action due", kind: "date", get: (o) => o.next_action_due }, { label: "Lost reason", kind: "text", get: (o) => o.lost_reason },
          { label: "Created", kind: "date", get: (o) => dayOf(o.created_at) },
        ]);
      }
      case "calls": {
        const t = await ctx.repo.listMany(["Accounts", "ActivityEvents"]);
        const acc = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));
        const calls = dedupeEvents(t.ActivityEvents.rows).filter((e) => ["cold_call", "connected_call", "voicemail"].includes(e.activity_type) && inPeriod(e.local_date)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
        return out(calls, [
          { label: "Date", kind: "date", get: (e) => e.local_date }, { label: "Time", kind: "date", get: (e) => e.occurred_at }, { label: "Founder", kind: "text", get: (e) => e.founder_key },
          { label: "Type", kind: "text", get: (e) => e.activity_type }, { label: "Outcome", kind: "text", get: (e) => e.outcome }, { label: "Objection", kind: "text", get: (e) => e.objection },
          { label: "Company", kind: "text", get: (e) => acc.get(e.account_id) ?? "" }, { label: "Duration (s)", kind: "amount", get: (e) => e.duration_sec }, { label: "Notes", kind: "text", get: (e) => e.notes },
        ]);
      }
      case "tasks": {
        const shared = live((await ctx.repo.list("Tasks")).rows).filter((x) => x.visibility === "team" || x.created_by_founder === founder);
        const own = ctx.privateRepo(founder);
        const priv = own ? live((await own.list("PrivateTasks")).rows) : [];
        const rows = [...shared.map((x) => ({ ...x, private: false })), ...priv.map((x) => ({ ...(x as unknown as Row<"Tasks">), private: true }))].filter((x) => inPeriod(x.due_at ?? dayOf(x.created_at)));
        return out(rows, [
          { label: "Title", kind: "text", get: (x) => x.title }, { label: "Owner", kind: "text", get: (x) => x.owner }, { label: "Priority", kind: "text", get: (x) => x.priority },
          { label: "Status", kind: "text", get: (x) => x.status }, { label: "Due", kind: "date", get: (x) => x.due_at }, { label: "Area", kind: "text", get: (x) => x.area },
          { label: "Recurrence", kind: "text", get: (x) => x.recurrence }, { label: "Estimated minutes", kind: "amount", get: (x) => x.estimated_minutes }, { label: "Private", kind: "text", get: (x) => (x.private ? "1" : "") },
          { label: "Completed", kind: "date", get: (x) => x.completed_at }, { label: "Description", kind: "text", get: (x) => x.description },
        ]);
      }
      case "content": {
        const t = await ctx.repo.listMany(["ContentPieces", "ContentVariants"]);
        const piece = new Map(t.ContentPieces.rows.map((p) => [p.id, p]));
        const rows = live(t.ContentVariants.rows).filter((v) => piece.has(v.piece_id) && inPeriod(v.scheduled_date ?? dayOf(v.published_at) ?? dayOf(v.created_at)));
        return out(rows, [
          { label: "Title", kind: "text", get: (v) => piece.get(v.piece_id)?.title }, { label: "Brand", kind: "text", get: (v) => piece.get(v.piece_id)?.brand }, { label: "Format", kind: "text", get: (v) => piece.get(v.piece_id)?.format },
          { label: "Stage", kind: "text", get: (v) => piece.get(v.piece_id)?.stage }, { label: "Language", kind: "text", get: (v) => v.language }, { label: "Network", kind: "text", get: (v) => v.platform },
          { label: "Owner", kind: "text", get: (v) => v.owner_founder }, { label: "Status", kind: "text", get: (v) => v.status }, { label: "Scheduled", kind: "date", get: (v) => v.scheduled_date },
          { label: "Published", kind: "date", get: (v) => v.published_at }, { label: "Hook", kind: "text", get: (v) => piece.get(v.piece_id)?.hook }, { label: "Caption", kind: "text", get: (v) => v.caption },
          { label: "UTM campaign", kind: "text", get: (v) => v.utm_campaign }, { label: "Post link", kind: "text", get: (v) => v.platform_post_url },
        ]);
      }
      case "quotes": {
        const t = await ctx.repo.listMany(["Accounts", "Quotes"]);
        const acc = new Map(t.Accounts.rows.map((a) => [a.id, a.name]));
        return out(live(t.Quotes.rows).filter((q) => inPeriod(dayOf(q.created_at))).sort((a, b) => a.reference.localeCompare(b.reference) || a.quote_version - b.quote_version), [
          { label: "Reference", kind: "text", get: (q) => q.reference }, { label: "Version", kind: "amount", get: (q) => q.quote_version }, { label: "Company", kind: "text", get: (q) => acc.get(q.account_id) },
          { label: "Status", kind: "text", get: (q) => q.status }, { label: "Author", kind: "text", get: (q) => q.author }, { label: "Currency", kind: "text", get: (q) => q.currency },
          { label: "Language", kind: "text", get: (q) => q.language }, { label: "Term (months)", kind: "amount", get: (q) => q.term_months }, { label: "Discount (%)", kind: "amount", get: (q) => (q.discount_bp / 100).toFixed(2) },
          { label: "Valid until", kind: "date", get: (q) => q.valid_until }, { label: "Sent on", kind: "date", get: (q) => q.sent_at }, { label: "Decided on", kind: "date", get: (q) => q.decided_at },
          { label: "Created", kind: "date", get: (q) => dayOf(q.created_at) },
        ]);
      }
      case "projects": {
        const t = await ctx.repo.listMany(["Clients", "Projects"]);
        const cl = new Map(t.Clients.rows.map((c) => [c.id, c.name]));
        return out(live(t.Projects.rows).filter((p) => inPeriod(p.start_date)), [
          { label: "Project", kind: "text", get: (p) => p.name }, { label: "Client", kind: "text", get: (p) => cl.get(p.client_id) }, { label: "Offer", kind: "text", get: (p) => p.brand },
          { label: "Status", kind: "text", get: (p) => p.status }, { label: "Owner", kind: "text", get: (p) => p.owner_founder }, { label: "Start", kind: "date", get: (p) => p.start_date },
          { label: "Due", kind: "date", get: (p) => p.due_date }, { label: "One-off revenue", kind: "amount", get: (p) => money(p.revenue_one_off_minor) }, { label: "MRR", kind: "amount", get: (p) => money(p.mrr_minor) },
          { label: "Term (months)", kind: "amount", get: (p) => p.term_months }, { label: "Estimated founder hours", kind: "amount", get: (p) => p.est_founder_hours },
        ]);
      }
      case "bank": {
        const rows = live((await ctx.repo.list("BankTransactions")).rows).filter((x) => inPeriod(x.date)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
        return out(rows, [
          { label: "Date", kind: "date", get: (x) => x.date }, { label: "Bank", kind: "text", get: (x) => x.bank }, { label: "Direction", kind: "text", get: (x) => x.direction },
          { label: "Amount", kind: "amount", get: (x) => money(x.amount_minor) }, { label: "Fee", kind: "amount", get: (x) => money(x.fee_minor) }, { label: "Currency", kind: "text", get: (x) => x.currency },
          { label: "Description", kind: "text", get: (x) => x.description }, { label: "Counterparty", kind: "text", get: (x) => x.counterparty }, { label: "Category", kind: "text", get: (x) => x.category },
          { label: "Origin", kind: "text", get: (x) => x.origin }, { label: "Note", kind: "text", get: (x) => x.note },
        ]);
      }
      case "local_usage": {
        const t = await ctx.repo.listMany(["Clients", "LocalSubscriptionUsage"]);
        const cl = new Map(t.Clients.rows.map((c) => [c.id, c.name]));
        // Same headers as the Local usage import, so an export can be edited and imported back.
        return out(live(t.LocalSubscriptionUsage.rows).filter((u) => inPeriod(`${u.month}-01`)).sort((a, b) => a.month.localeCompare(b.month)), [
          { label: "client", kind: "text", get: (u) => cl.get(u.client_id) }, { label: "month", kind: "date", get: (u) => u.month }, { label: "conversations", kind: "amount", get: (u) => u.conversations },
          { label: "qualified_requests", kind: "amount", get: (u) => u.qualified_requests }, { label: "automated_emails", kind: "amount", get: (u) => u.automated_emails }, { label: "support_minutes", kind: "amount", get: (u) => u.support_minutes },
          { label: "locations", kind: "amount", get: (u) => u.locations }, { label: "actual_cost", kind: "amount", get: (u) => money(u.actual_cost_minor) }, { label: "note", kind: "text", get: (u) => u.note },
        ]);
      }
    }
  })();
  const period = input.from || input.to ? `-${input.from ?? "start"}_${input.to ?? "today"}` : `-${new Date().toISOString().slice(0, 10)}`;
  return { filename: `valemont-${input.list.replace("_", "-")}${period}.csv`, ...r };
}

/* ---------------- generic import with preview and dedupe (tasks, content ideas) ---------------- */

export const CSV_IMPORTS = ["tasks", "content_ideas"] as const;
export type CsvImport = (typeof CSV_IMPORTS)[number];

const opt = (n: number) => z.string().trim().max(n).default("");
const OWNER: Record<string, FounderKey> = { theo: "theo", "théo": "theo", pablo: "pablo" };
const date = z.string().trim().default("").transform((s, c) => {
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const eu = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const v = iso ? s : eu ? `${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}` : "";
  if (!v || Number.isNaN(Date.parse(v))) { c.addIssue({ code: "custom", message: "Date: YYYY-MM-DD or DD/MM/YYYY" }); return z.NEVER; }
  return v;
});
const taskRow = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: opt(4_000),
  owner: z.string().trim().default("").transform((s, c) => { const k = s.toLowerCase(); if (k && !OWNER[k]) { c.addIssue({ code: "custom", message: "Owner: Théo, Pablo or empty" }); return z.NEVER; } return OWNER[k] ?? null; }),
  priority: z.string().trim().toUpperCase().default("P2").transform((s) => s || "P2").pipe(z.enum(["P0", "P1", "P2", "P3"])),
  due: date,
  area: z.string().trim().toLowerCase().default("sales").transform((s) => s || "sales").pipe(z.enum(["sales", "marketing", "ops"])),
  estimated_minutes: z.string().trim().default("").transform((s, c) => { if (!s) return null; const n = Number(s); if (!Number.isInteger(n) || n < 0 || n > 2_400) { c.addIssue({ code: "custom", message: "Minutes: 0 to 2400" }); return z.NEVER; } return n; }),
});
const ideaRow = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  format: z.string().trim().toLowerCase().default("reel").transform((s) => s || "reel").pipe(z.enum(CONTENT_FORMATS)),
  brand: z.string().trim().toLowerCase().default("").transform((s, c) => { if (!s) return "thirty" as const; if (["valemont", "consulting"].includes(s)) return "consulting" as const; if (["30/30", "thirty", "3030"].includes(s)) return "thirty" as const; c.addIssue({ code: "custom", message: "Brand: Valemont or 30/30" }); return z.NEVER; }),
  hook: opt(500),
  persona: opt(200),
});
const ALIASES: Record<CsvImport, Record<string, string[]>> = {
  tasks: {
    title: ["title", "task", "titre", "tâche", "tache", "tarea", "título", "titulo"], description: ["description", "details", "détails", "descripción", "descripcion"],
    owner: ["owner", "assignee", "responsable", "pour"], priority: ["priority", "priorité", "priorite", "prioridad"], due: ["due", "due date", "échéance", "echeance", "date", "fecha", "vencimiento"],
    area: ["area", "domaine", "área"], estimated_minutes: ["estimated minutes", "minutes", "minutos", "durée", "duree"],
  },
  content_ideas: {
    title: ["title", "idea", "idée", "idee", "titre", "idea", "título", "titulo"], format: ["format", "formato"], brand: ["brand", "marque", "marca"],
    hook: ["hook", "accroche", "gancho"], persona: ["persona", "target", "cible", "público", "publico"],
  },
};

const EXPORT_LABEL: Record<string, string> = { title: "Title", description: "Description", owner: "Owner", priority: "Priority", due: "Due", area: "Area", estimated_minutes: "Estimated minutes", format: "Format", brand: "Brand", hook: "Hook" };

export interface ListPreviewRow { index: number; status: "new" | "duplicate" | "invalid"; title: string; errors: string[]; duplicateOf: "existing" | number | null }
export const csvImportPreviewSchema = z.object({ kind: z.enum(CSV_IMPORTS), csv: z.string().max(IMPORT_MAX_BYTES) });
export const csvImportCommitSchema = csvImportPreviewSchema.extend({ import_id: z.string().uuid() });

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function parse(ctx: AppContext, founder: FounderKey, kind: CsvImport, text: string) {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const [headers = [], ...data] = parsed.data;
  if (data.length > IMPORT_MAX_ROWS) throw new RuleError("Too many rows (max 2000).");
  // An exported list can be imported back: its translated column names are accepted too.
  const aliases = Object.fromEntries(Object.entries(ALIASES[kind]).map(([f, a]) => [f, [...a, ...(EXPORT_LABEL[f] ? (["fr", "es"] as const).map((l) => translate(l, EXPORT_LABEL[f]).toLowerCase()) : [])]]));
  const mapping: Record<number, string> = {};
  const unrecognized: string[] = [];
  headers.forEach((h, i) => {
    const k = h.trim().toLowerCase().replace(/_/g, " ");
    const f = Object.keys(aliases).find((field) => !Object.values(mapping).includes(field) && aliases[field].includes(k));
    if (f) mapping[i] = f; else if (h.trim()) unrecognized.push(h.trim());
  });
  if (!Object.values(mapping).includes("title")) throw new RuleError("The file needs a title column.");
  // Dedupe: same title (and same due date for tasks) as an existing task (any status) / an existing piece, or earlier in the file.
  const existing = new Set<string>();
  if (kind === "tasks") {
    const shared = (await ctx.repo.list("Tasks")).rows;
    const own = ctx.privateRepo(founder);
    const priv = own ? (await own.list("PrivateTasks")).rows : [];
    for (const x of [...shared, ...priv]) if (!x.is_archived) existing.add(`${key(x.title)}|${x.due_at ?? ""}`);
  } else {
    for (const p of (await ctx.repo.list("ContentPieces")).rows) if (!p.is_archived) existing.add(key(p.title));
  }
  const seen = new Map<string, number>();
  const rows = data.map((cells, index) => {
    const obj: Record<string, string> = {};
    for (const [i, f] of Object.entries(mapping)) obj[f] = String(cells[Number(i)] ?? "");
    const res = (kind === "tasks" ? taskRow : ideaRow).safeParse(obj);
    if (!res.success) return { index, status: "invalid" as const, title: (obj.title ?? "").slice(0, 120), errors: res.error.issues.map((x) => x.message), duplicateOf: null, data: null };
    const d = res.data as z.infer<typeof taskRow> & z.infer<typeof ideaRow>;
    const k = kind === "tasks" ? `${key(d.title)}|${d.due || ""}` : key(d.title);
    const dup = existing.has(k) ? ("existing" as const) : seen.has(k) ? seen.get(k)! : null;
    if (dup === null) seen.set(k, index);
    return { index, status: dup === null ? ("new" as const) : ("duplicate" as const), title: d.title, errors: [], duplicateOf: dup, data: res.data };
  });
  return { headers, mapped: Object.fromEntries(Object.entries(mapping).map(([i, f]) => [headers[Number(i)], f])), unrecognized, rows };
}

export async function previewListImport(ctx: AppContext, founder: FounderKey, input: z.infer<typeof csvImportPreviewSchema>) {
  const p = await parse(ctx, founder, input.kind, input.csv);
  const rows: ListPreviewRow[] = p.rows.map((r) => ({ index: r.index, status: r.status, title: r.title, errors: r.errors, duplicateOf: r.duplicateOf }));
  return { headers: p.headers, mapped: p.mapped, unrecognized: p.unrecognized, rows, counts: { new: rows.filter((r) => r.status === "new").length, duplicate: rows.filter((r) => r.status === "duplicate").length, invalid: rows.filter((r) => r.status === "invalid").length } };
}

/**
 * Commits only the rows the server itself classifies as new. Ids derive from import_id + row index and the existing
 * create services are idempotent by id, so re-sending the same import adds nothing.
 */
export async function commitListImport(ctx: AppContext, founder: FounderKey, input: z.infer<typeof csvImportCommitSchema>) {
  const p = await parse(ctx, founder, input.kind, input.csv);
  let imported = 0;
  for (const r of p.rows) {
    if (r.status !== "new" || !r.data) continue;
    const id = childId(input.import_id, "row", String(r.index));
    if (input.kind === "tasks") {
      const d = r.data as z.infer<typeof taskRow>;
      const res = await createTask(ctx, founder, { id, source: "manual", source_id: "", task: { title: d.title, description: d.description, owner: d.owner, priority: d.priority, due_at: d.due, estimated_minutes: d.estimated_minutes, recurrence: "none", account_id: "", opportunity_id: "", dependency_ids: [], private: false, area: d.area } });
      if (!res.duplicate) imported += 1;
    } else {
      const d = r.data as z.infer<typeof ideaRow>;
      // Parsed by the Content Studio schema itself, so its defaults (languages, networks) apply exactly as for a new piece.
      const res = await createPiece(ctx, founder, createPieceSchema.parse({ id, title: d.title, format: d.format, brand: d.brand, hook: d.hook, target_persona: d.persona, stage: "idea" }));
      if (!res.duplicate) imported += 1;
    }
  }
  return { imported, skipped: p.rows.length - imported };
}
