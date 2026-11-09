/**
 * Backups (Stage 4B, D084): pure rules, no I/O. A backup is a copy of the live spreadsheet; verifying it compares
 * per-tab headers and row counts. Retention keeps N days of daily copies.
 */

export const BACKUP_PREFIX = "Valemont OS backup ";
export const BUNDLE_FORMAT = "valemont-os-backup";
/** Tabs never compared or restored as data: rebuilt by setup (revision tokens, doctor marker). */
export const SYSTEM_TABS = new Set(["_Revisions", "_Doctor"]);

export type Grid = (string | number | boolean | null | undefined)[][];
export interface TabStat { header: string[]; rows: number }
export type Stats = Record<string, TabStat>;

const blank = (c: unknown) => c === "" || c === null || c === undefined;

/** Header (trimmed) and the number of non-empty data rows of one tab. */
export function tabStat(grid: Grid): TabStat {
  const header = (grid[0] ?? []).map((h) => String(h ?? "").trim());
  while (header.length && header[header.length - 1] === "") header.pop();
  const rows = grid.slice(1).filter((r) => (r ?? []).some((c) => !blank(c))).length;
  return { header, rows };
}

export function statsOf(tabs: Record<string, Grid>): Stats {
  return Object.fromEntries(Object.entries(tabs).filter(([t]) => !SYSTEM_TABS.has(t)).map(([t, g]) => [t, tabStat(g)]));
}

export interface VerifyIssue { tab: string; kind: "missing_tab" | "header_changed" | "fewer_rows" | "more_rows"; expected?: number; actual?: number }
export interface VerifyResult { ok: boolean; tabs: number; rows: number; issues: VerifyIssue[] }

/**
 * Exact check (restore): the copy has every tab, the same header and the same row count as the source.
 * Window check (backup taken while the app runs): `before` ≤ copy ≤ `after` for each tab, because a founder may
 * append rows while Drive copies the file. Tabs that only exist in the copy are ignored.
 */
export function verifyStats(copy: Stats, before: Stats, after: Stats = before): VerifyResult {
  const issues: VerifyIssue[] = [];
  for (const [tab, b] of Object.entries(before)) {
    const c = copy[tab];
    if (!c) { issues.push({ tab, kind: "missing_tab" }); continue; }
    if (c.header.join("\u0001") !== b.header.join("\u0001")) issues.push({ tab, kind: "header_changed" });
    const hi = Math.max(b.rows, after[tab]?.rows ?? b.rows);
    if (c.rows < b.rows) issues.push({ tab, kind: "fewer_rows", expected: b.rows, actual: c.rows });
    else if (c.rows > hi) issues.push({ tab, kind: "more_rows", expected: hi, actual: c.rows });
  }
  const tabs = Object.keys(before).filter((t) => copy[t]).length;
  const rows = Object.keys(before).reduce((n, t) => n + (copy[t]?.rows ?? 0), 0);
  return { ok: issues.length === 0, tabs, rows, issues };
}

/** One line per issue, for BackupRuns.verify_detail and the restore script. */
export function describeIssues(r: VerifyResult): string {
  if (r.ok) return `${r.tabs} tabs, ${r.rows} rows`;
  return r.issues.map((i) => (i.kind === "fewer_rows" || i.kind === "more_rows" ? `${i.tab}: ${i.kind} (${i.actual} vs ${i.expected})` : `${i.tab}: ${i.kind}`)).join("; ").slice(0, 1_000);
}

export const backupName = (day: string) => `${BACKUP_PREFIX}${day}`;

/** Day of a backup file from its name, or null for files that are not ours. */
export function backupDay(name: string): string | null {
  if (!name.startsWith(BACKUP_PREFIX)) return null;
  const d = name.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * Files to trash: our backups older than `retentionDays` before `today`, never the newest one (a long outage must
 * not delete the last good copy). Files whose name we did not write are never touched.
 */
export function expiredBackups<F extends { id: string; name: string }>(files: F[], today: string, retentionDays: number): F[] {
  const ours = files.map((f) => ({ f, day: backupDay(f.name) })).filter((x): x is { f: F; day: string } => x.day !== null);
  if (ours.length <= 1) return [];
  const newest = ours.reduce((a, b) => (b.day > a.day ? b : a));
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - retentionDays * 86_400_000).toISOString().slice(0, 10);
  return ours.filter((x) => x.day < cutoff && x.f.id !== newest.f.id).map((x) => x.f);
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  schema_hash: string;
  exported_at: string;
  source: "sheets" | "memory";
  tabs: Record<string, string[][]>;
}

export function isBundle(v: unknown): v is Bundle {
  const b = v as Partial<Bundle> | null;
  return Boolean(b && b.format === BUNDLE_FORMAT && b.version === 1 && b.tabs && typeof b.tabs === "object" && Object.values(b.tabs).every((g) => Array.isArray(g) && g.every((r) => Array.isArray(r))));
}

/**
 * An older backup against the live spreadsheet now: live may only have grown. Every live tab must exist in the copy
 * with the same header (a tab created after the backup is reported, not failed), and the copy must not hold MORE
 * rows than live (that would mean rows were lost in live since the backup: restore them from this copy).
 */
export function compareToLive(copy: Stats, live: Stats): VerifyResult & { newerRows: number } {
  const issues: VerifyIssue[] = [];
  let newerRows = 0;
  for (const [tab, l] of Object.entries(live)) {
    const c = copy[tab];
    if (!c) { if (l.rows > 0) issues.push({ tab, kind: "missing_tab" }); continue; }
    const shared = Math.min(c.header.length, l.header.length);
    if (c.header.slice(0, shared).join("\u0001") !== l.header.slice(0, shared).join("\u0001")) issues.push({ tab, kind: "header_changed" });
    if (c.rows > l.rows) issues.push({ tab, kind: "more_rows", expected: l.rows, actual: c.rows });
    else newerRows += l.rows - c.rows;
  }
  const tabs = Object.keys(copy).length;
  const rows = Object.values(copy).reduce((n, s) => n + s.rows, 0);
  return { ok: issues.length === 0, tabs, rows, issues, newerRows };
}
