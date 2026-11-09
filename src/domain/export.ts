/**
 * "Export everything for AI analysis" (iteration 8): a period of Valemont data as one document,
 * rendered as Markdown (for Claude or another AI) or Excel. Pure helpers only: the server builds the document
 * through the repository, these render it. Texts arrive already translated (FR for Théo, ES for Pablo).
 */
import { neutralizeFormula } from "./csv";
import { addDays } from "./time";

export type CellKind = "text" | "int" | "num" | "money" | "pct" | "date";
export type Cell = string | number | null;
export interface ExportColumn { label: string; kind: CellKind }
export interface ExportTable { title: string; columns: ExportColumn[]; rows: Cell[][]; note?: string }
export interface ExportSection {
  key: string;
  title: string;
  intro?: string;
  bullets?: string[];
  /** Free text written by the founders (weekly reviews), shown as quotes. */
  quotes?: { heading: string; text: string }[];
  tables: ExportTable[];
}
export interface ExportDoc {
  title: string;
  meta: [string, string][];
  definitionsTitle: string;
  definitions: [string, string][];
  sections: ExportSection[];
  questionsTitle: string;
  questions: string[];
  /** Header labels used by the renderers ("Metric", "Definition", "Value"). */
  labels: { term: string; definition: string; field: string; value: string; empty: string; readme: string };
}

/* ---------------- period ---------------- */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: string) => DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** True when the date (or the date part of an ISO timestamp) falls in [from, to], both inclusive. */
export function inPeriod(date: string | null | undefined, from: string, to: string): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= from && d <= to;
}
export function filterPeriod<R>(rows: R[], dateOf: (r: R) => string | null | undefined, from: string, to: string): R[] {
  return rows.filter((r) => inPeriod(dateOf(r), from, to));
}
/** Number of days in [from, to], both inclusive. */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export type PeriodPreset = "7d" | "30d" | "month" | "sprint" | "custom";
/** Dates for the dialog presets; "sprint" needs the active sprint, "custom" keeps the given dates. */
export function presetPeriod(preset: PeriodPreset, today: string, opts: { sprint?: { start_date: string; end_date: string } | null; from?: string; to?: string } = {}): { from: string; to: string } | null {
  if (preset === "7d") return { from: addDays(today, -6), to: today };
  if (preset === "30d") return { from: addDays(today, -29), to: today };
  if (preset === "month") return { from: today.slice(0, 8) + "01", to: today };
  if (preset === "sprint") return opts.sprint ? { from: opts.sprint.start_date, to: opts.sprint.end_date < today ? opts.sprint.end_date : today } : null;
  if (opts.from && opts.to && isDay(opts.from) && isDay(opts.to) && opts.from <= opts.to) return { from: opts.from, to: opts.to };
  return null;
}

/* ---------------- markdown ---------------- */

/** One table cell: backslashes and pipes escaped, line breaks turned into <br>, so a cell never breaks the table. */
export function mdEscape(v: Cell): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>").trim();
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
/** Plain, unambiguous numbers for a model: dot decimals, no thousands separator. */
export function formatCell(v: Cell, kind: CellKind): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (kind === "money") return v.toFixed(2);
  if (kind === "pct") return `${round(v * 100, 1)}%`;
  if (kind === "num") return String(round(v, 2));
  return String(v);
}

export function mdTable(t: ExportTable, empty = "—"): string {
  if (!t.rows.length) return `_${mdEscape(empty)}_`;
  const head = `| ${t.columns.map((c) => mdEscape(c.label)).join(" | ")} |`;
  const sep = `| ${t.columns.map((c) => (c.kind === "text" || c.kind === "date" ? "---" : "---:")).join(" | ")} |`;
  const body = t.rows.map((r) => `| ${t.columns.map((c, i) => mdEscape(formatCell(r[i] ?? null, c.kind))).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

/** Founder text as a Markdown quote: every line prefixed, so a "#" typed by a founder never becomes a heading. */
const quote = (s: string) => s.split(/\r\n|\r|\n/).map((l) => `> ${l}`).join("\n");

export function renderMarkdown(doc: ExportDoc): string {
  const out: string[] = [`# ${doc.title}`, ""];
  for (const [k, v] of doc.meta) out.push(`- **${mdEscape(k)}:** ${mdEscape(v)}`);
  out.push("", `## ${doc.definitionsTitle}`, "");
  out.push(mdTable({ title: "", columns: [{ label: doc.labels.term, kind: "text" }, { label: doc.labels.definition, kind: "text" }], rows: doc.definitions }, doc.labels.empty));
  doc.sections.forEach((s, i) => {
    out.push("", `## ${i + 1}. ${s.title}`, "");
    if (s.intro) out.push(s.intro, "");
    if (s.bullets?.length) out.push(...s.bullets.map((b) => `- ${b}`), "");
    for (const t of s.tables) {
      if (t.title) out.push(`### ${t.title}`, "");
      out.push(mdTable(t, doc.labels.empty), "");
      if (t.note) out.push(`_${t.note}_`, "");
    }
    for (const q of s.quotes ?? []) out.push(`**${mdEscape(q.heading)}**`, "", quote(q.text), "");
  });
  out.push("", `## ${doc.questionsTitle}`, "");
  doc.questions.forEach((q, i) => out.push(`${i + 1}. ${q}`));
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/* ---------------- spreadsheet ---------------- */

/** Excel cell value: numbers stay numbers; text that a spreadsheet could read as a formula is neutralised. */
export function sheetValue(v: Cell, kind: CellKind): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return kind === "text" ? neutralizeFormula(String(v)) : v;
  return neutralizeFormula(v);
}

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ], unique within the workbook. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

/** Valemont minor units (cents) → euros as a number with two decimals. */
export const major = (minor: number | null | undefined) => (minor === null || minor === undefined ? null : Math.round(minor) / 100);
