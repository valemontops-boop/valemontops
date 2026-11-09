import type { FounderKey } from "@/domain/constants";
import { ENTRIES } from "./dict";

/**
 * UI language per founder (D048): Théo reads French, Pablo reads Spanish. There is no English UI.
 * Source strings in code are English keys; `translate` maps them to FR/ES. Keys may hold `{placeholders}`,
 * which also lets dynamic sentences built on the server ("No answer on {date}") be translated on screen.
 */
export type Locale = "fr" | "es";
export const LOCALE_OF: Record<FounderKey, Locale> = { theo: "fr", pablo: "es" };
export const dateTag = (l: Locale) => (l === "fr" ? "fr-FR" : "es-ES");

type Vars = Record<string, string | number | null | undefined>;
const exact = new Map<string, readonly [string, string]>(Object.entries(ENTRIES));
const patterns = [...exact.entries()]
  .filter(([k]) => /\{[a-zA-Z_]+\}/.test(k))
  .map(([k, v]) => {
    const names: string[] = [];
    const src = k.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{([a-zA-Z_]+)\\?\}/g, (_m, n: string) => { names.push(n); return "(.+?)"; });
    return { re: new RegExp(`^${src}$`), names, v, len: k.length };
  })
  .sort((a, b) => b.len - a.len); // most specific first

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{([a-zA-Z_]+)\}/g, (m, n: string) => (vars[n] === undefined || vars[n] === null ? m : String(vars[n]))) : s);
const idx = (l: Locale) => (l === "fr" ? 0 : 1);

/** Missing keys seen at runtime (dev/test aid). */
export const MISSING = new Set<string>();

export function translate(locale: Locale, text: string | null | undefined, vars?: Vars): string {
  if (text === null || text === undefined || text === "") return text ?? "";
  const hit = exact.get(text);
  if (hit) return fill(hit[idx(locale)], vars);
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const got: Vars = {};
    p.names.forEach((n, i) => { got[n] = translate(locale, m[i + 1]); });
    return fill(p.v[idx(locale)], { ...got, ...vars });
  }
  if (/[A-Za-z]{2}/.test(text)) MISSING.add(text);
  return fill(text, vars);
}
export type T = (text: string | null | undefined, vars?: Vars) => string;
export const tFor = (l: Locale): T => (text, vars) => translate(l, text, vars);
