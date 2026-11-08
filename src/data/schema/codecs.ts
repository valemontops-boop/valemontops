import { z } from "zod";

/**
 * Cell codecs. Every cell is stored as a string written with valueInputOption=RAW (D004)
 * and parsed back here. Sheets may still return numbers/booleans if a human typed them,
 * so every parser accepts unknown input.
 */
export const MAX_CELL_CHARS = 45_000; // Google Sheets hard limit is 50,000 per cell.

const toStr = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const text = (max = 5_000) =>
  z.preprocess(toStr, z.string().max(Math.min(max, MAX_CELL_CHARS)));

export const reqText = (max = 500) =>
  z.preprocess(toStr, z.string().trim().min(1).max(max));

export const int = () =>
  z.preprocess((v) => (typeof v === "number" ? v : Number(toStr(v).trim())), z.number().int());

export const optInt = () =>
  z.preprocess((v) => {
    const s = toStr(v).trim();
    return s === "" ? null : Number(s);
  }, z.number().int().nullable());

export const bool = () =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    const s = toStr(v).trim().toUpperCase();
    return s === "TRUE" || s === "1" || s === "YES";
  }, z.boolean());

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const iso = () => z.preprocess(toStr, z.string().regex(ISO, "ISO 8601 timestamp expected"));
export const optIso = () =>
  z.preprocess((v) => (toStr(v).trim() === "" ? null : toStr(v).trim()), z.string().regex(ISO).nullable());
export const day = () => z.preprocess(toStr, z.string().regex(DAY, "YYYY-MM-DD expected"));
export const optDay = () =>
  z.preprocess((v) => (toStr(v).trim() === "" ? null : toStr(v).trim()), z.string().regex(DAY).nullable());

export const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => toStr(v).trim(), z.enum(values));

export const optOneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (toStr(v).trim() === "" ? null : toStr(v).trim()), z.enum(values).nullable());

export const json = <S extends z.ZodTypeAny>(schema: S, fallback: z.infer<S>) =>
  z.preprocess((v) => {
    const s = toStr(v).trim();
    if (s === "") return fallback;
    try {
      return JSON.parse(s);
    } catch {
      return Symbol.for("invalid-json");
    }
  }, schema);

/** Serialise a typed value back to the string stored in a cell. */
export function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number cannot be stored");
    return String(value);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
