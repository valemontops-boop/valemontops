import Papa from "papaparse";
import { z } from "zod";
import { CONTACT_TYPES, MARKETS } from "./constants";
import { isFreeMailDomain, normalizeDomain, normalizeEmail, normalizePhone } from "./normalize";

/* ---------------- export ---------------- */

export type ColumnKind = "text" | "phone" | "amount" | "date" | "id";
export interface ExportColumn<R> {
  label: string;
  kind: ColumnKind;
  get: (r: R) => string | number | null | undefined;
}

/**
 * Formula-injection escaping for free text (spec 4.5): a leading = + - @ tab or CR is neutralised
 * with an apostrophe. Typed columns (phone, amount, date, id) are left intact and always quoted.
 */
/** True when a spreadsheet would read this text as a formula (spec 4.5). Shared by the CSV and Excel exports. */
export const looksLikeFormula = (s: string) => /^[=+\-@\t\r]/.test(s);
/** Neutralises a leading = + - @ tab or CR with an apostrophe. */
export const neutralizeFormula = (s: string) => (looksLikeFormula(s) ? "'" + s : s);

export function escapeCsvCell(value: string | number | null | undefined, kind: ColumnKind): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (kind === "text") s = neutralizeFormula(s);
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv<R>(rows: R[], columns: ExportColumn<R>[]): string {
  const head = columns.map((c) => escapeCsvCell(c.label, "text")).join(",");
  const body = rows.map((r) => columns.map((c) => escapeCsvCell(c.get(r), c.kind)).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

/* ---------------- import ---------------- */

export const IMPORT_MAX_ROWS = 2_000;
export const IMPORT_MAX_BYTES = 1_000_000;

const ALIASES: Record<string, string[]> = {
  company: ["company", "company name", "business", "name", "entreprise", "empresa", "société", "societe", "account"],
  website: ["website", "site", "url", "web", "site web", "sitio web"],
  phone: ["phone", "telephone", "téléphone", "telefono", "teléfono", "tel", "mobile"],
  email: ["email", "e-mail", "mail", "correo"],
  contact_name: ["contact", "contact name", "full name", "nom", "nombre", "decision maker"],
  role: ["role", "title", "job title", "poste", "cargo"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile"],
  country: ["country", "pays", "país", "pais", "market"],
  city: ["city", "ville", "ciudad", "town"],
  sector: ["sector", "industry", "secteur"],
  niche: ["niche", "segment", "trade"],
  contact_type: ["contact type", "contact_type"],
  language: ["language", "langue", "idioma"],
  notes: ["notes", "note", "comments"],
};

export type ImportField = keyof typeof ALIASES;

export function mapHeaders(headers: string[]): { mapping: Record<number, ImportField>; unrecognized: string[] } {
  const mapping: Record<number, ImportField> = {};
  const unrecognized: string[] = [];
  const used = new Set<ImportField>();
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase().replace(/_/g, " ");
    const field = (Object.keys(ALIASES) as ImportField[]).find((f) => !used.has(f) && ALIASES[f].includes(key));
    if (field) {
      mapping[i] = field;
      used.add(field);
    } else if (h.trim()) unrecognized.push(h.trim());
  });
  return { mapping, unrecognized };
}

const countrySchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .transform((s) => (["FRANCE", "FR"].includes(s) ? "FR" : ["SPAIN", "ESPAÑA", "ESPANA", "ES", "ESPAGNE"].includes(s) ? "ES" : s))
  .pipe(z.enum(MARKETS).or(z.literal("")));

export const importRowSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(200),
  website: z.string().trim().max(300).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.union([z.literal(""), z.string().trim().max(200).email("Invalid email")]).default(""),
  contact_name: z.string().trim().max(200).default(""),
  role: z.string().trim().max(120).default(""),
  linkedin_url: z.string().trim().max(300).default(""),
  country: countrySchema.default(""),
  city: z.string().trim().max(120).default(""),
  sector: z.string().trim().max(120).default(""),
  niche: z.string().trim().max(120).default(""),
  contact_type: z.union([z.literal(""), z.enum(CONTACT_TYPES)]).default(""),
  language: z.string().trim().max(10).default(""),
  notes: z.string().trim().max(2_000).default(""),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export interface ExistingKeys {
  domains: Map<string, string>; // normalized -> account id
  emails: Map<string, string>;
  phones: Map<string, string>;
}

export interface PreviewRow {
  index: number;
  status: "new" | "duplicate" | "invalid";
  data: ImportRow | null;
  errors: string[];
  duplicateOf: { reason: "domain" | "email" | "phone"; existingAccountId: string | null; inFileRow: number | null } | null;
}

export interface ImportPreview {
  headers: string[];
  mapped: Record<string, string>;
  unrecognized: string[];
  rows: PreviewRow[];
  counts: { new: number; duplicate: number; invalid: number };
}

export function previewImport(csvText: string, existing: ExistingKeys): ImportPreview {
  if (csvText.length > IMPORT_MAX_BYTES) throw new Error(`File too large (max ${IMPORT_MAX_BYTES / 1_000_000} MB)`);
  const parsed = Papa.parse<string[]>(csvText.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const [headers = [], ...data] = parsed.data;
  if (data.length > IMPORT_MAX_ROWS) throw new Error(`Too many rows (max ${IMPORT_MAX_ROWS})`);
  const { mapping, unrecognized } = mapHeaders(headers);
  const seen = { domains: new Map<string, number>(), emails: new Map<string, number>(), phones: new Map<string, number>() };
  const rows: PreviewRow[] = data.map((cells, i) => {
    const obj: Record<string, string> = {};
    for (const [idx, field] of Object.entries(mapping)) obj[field] = String(cells[Number(idx)] ?? "");
    const res = importRowSchema.safeParse(obj);
    if (!res.success) {
      return { index: i, status: "invalid", data: null, errors: res.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`), duplicateOf: null };
    }
    const r = res.data;
    const market = r.country === "" ? null : r.country;
    const domain = normalizeDomain(r.website) || (r.email && !isFreeMailDomain(normalizeDomain(r.email)) ? normalizeDomain(r.email) : "");
    const email = normalizeEmail(r.email);
    const phone = normalizePhone(r.phone, market);
    const checks: ["domain" | "email" | "phone", string, Map<string, string>, Map<string, number>][] = [
      ["domain", domain, existing.domains, seen.domains],
      ["email", email, existing.emails, seen.emails],
      ["phone", phone, existing.phones, seen.phones],
    ];
    let dup: PreviewRow["duplicateOf"] = null;
    for (const [reason, key, ex, inFile] of checks) {
      if (!key) continue;
      if (ex.has(key)) {
        dup = { reason, existingAccountId: ex.get(key) ?? null, inFileRow: null };
        break;
      }
      if (inFile.has(key)) {
        dup = { reason, existingAccountId: null, inFileRow: inFile.get(key)! };
        break;
      }
    }
    if (!dup) {
      for (const [, key, , inFile] of checks) if (key) inFile.set(key, i);
    }
    return { index: i, status: dup ? "duplicate" : "new", data: r, errors: [], duplicateOf: dup };
  });
  const counts = { new: 0, duplicate: 0, invalid: 0 };
  for (const r of rows) counts[r.status]++;
  const mapped = Object.fromEntries(Object.entries(mapping).map(([i, f]) => [headers[Number(i)], f]));
  return { headers, mapped, unrecognized, rows, counts };
}
