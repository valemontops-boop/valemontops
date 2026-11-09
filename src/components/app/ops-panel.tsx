"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Input, Panel, PanelTitle, Select, Skeleton } from "@/components/ui/form";
import { FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import { useDateTag, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { fmtDateTime, fmtDay, Pill } from "./bits";

/**
 * Settings › Diagnostics, Stage 4B (D084): health, backups and the audit log. Compact: one line of state per block,
 * details behind the table rows.
 */

type Health = {
  ready: boolean; mode: string; adapter: string;
  process: { uptimeSec: number; rssMb: number | null; logLevel: string };
  config: { ok: boolean; errors: string[] };
  sheets: { ok: boolean; ms: number; checkedAt: string; error: string };
  integrations: { integration: string; status: string; lastSuccessAt: string | null; lastError: string }[];
  audit: { pending: number; written: number; failed: number; dropped: number; lastError: string };
};

export function HealthPanel() {
  const t = useT();
  const tag = useDateTag();
  const q = useQuery({ queryKey: ["health-details"], queryFn: () => api<Health>("/api/health/details") });
  if (q.isPending) return <Skeleton className="h-32" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  const bad = h.integrations.filter((i) => i.status === "error");
  return (
    <Panel>
      <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => q.refetch()}>{t("Refresh")}</Button>}>{t("Health")}</PanelTitle>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={h.ready ? "good" : "bad"}>{h.ready ? t("Ready") : t("Not ready")}</Pill>
        <span className="text-text-2">{t("Google Sheets: {state} in {n} ms", { state: h.sheets.ok ? t("reachable") : t("unreachable"), n: h.sheets.ms })}</span>
      </p>
      <dl className="grid grid-cols-[180px_1fr] gap-y-1.5 text-sm">
        <dt className="text-text-3">{t("Configuration")}</dt><dd>{h.config.ok ? t("valid") : h.config.errors.map((e) => t(e)).join(" ")}</dd>
        {h.sheets.error ? <><dt className="text-text-3">{t("Last error")}</dt><dd className="text-bad">{h.sheets.error}</dd></> : null}
        <dt className="text-text-3">{t("Integrations")}</dt>
        <dd>{h.integrations.length ? (bad.length ? t("{n} in error: {names}", { n: bad.length, names: bad.map((b) => t(b.integration)).join(", ") }) : t("{n} connected, no error", { n: h.integrations.length })) : t("none connected")}</dd>
        <dt className="text-text-3">{t("Audit log")}</dt>
        <dd className="num">{t("{written} written · {pending} waiting · {failed} failed writes", { written: h.audit.written, pending: h.audit.pending, failed: h.audit.failed })}</dd>
        <dt className="text-text-3">{t("Checked")}</dt><dd>{fmtDateTime(h.sheets.checkedAt, undefined, tag)}</dd>
      </dl>
    </Panel>
  );
}

type Run = { day: string; status: string; trigger: string; file_id: string; file_url: string; tabs: number | null; rows: number | null; verify: string; detail: string; deleted: number | null; error: string; finished_at: string | null };
type BackupStatus = { mode: string; configured: boolean; retentionDays: number; folderUrl: string; schedulerConfigured: boolean; today: string; lastDone: Run | null; runs: Run[] };
type VerifyOut = { ok: boolean; tabs: number; rows: number; newerRows: number; issues: { tab: string; kind: string }[] };

export function BackupsPanel() {
  const t = useT();
  const tag = useDateTag();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["backups"], queryFn: () => api<BackupStatus>("/api/backups") });
  const run = useMutation({
    mutationFn: () => api<{ status: string; error?: string }>("/api/backups", { method: "POST", body: {} }),
    onSuccess: (r) => { toast(r.status === "done" ? t("Backup done and verified") : r.status === "skipped" ? t("Today's backup already exists") : r.status === "error" ? t("Backup failed") : t("Backup already running")); qc.invalidateQueries({ queryKey: ["backups"] }); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Error: retry")),
  });
  const verify = useMutation({
    mutationFn: (file_id: string) => api<VerifyOut>("/api/backups/verify", { method: "POST", body: { file_id } }),
    onSuccess: (r) => (r.ok ? toast(t("Backup verified: {tabs} tabs, {rows} rows ({n} newer rows in live)", { tabs: r.tabs, rows: r.rows, n: r.newerRows })) : toast.error(t("Backup differs from live: {issues}", { issues: r.issues.map((i) => `${i.tab} (${t(i.kind.replace(/_/g, " "))})`).join(", ") }))),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Error: retry")),
  });
  const [downloading, setDownloading] = React.useState(false);
  async function download() {
    setDownloading(true);
    try {
      const res = await fetch("/api/backups/bundle", { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "valemont-os-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch {
      toast.error(t("Error: retry"));
    } finally {
      setDownloading(false);
    }
  }
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  return (
    <Panel>
      <PanelTitle action={<div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={downloading} onClick={download}>{downloading ? t("Preparing…") : t("Download a copy (JSON)")}</Button>
        {b.configured ? <Button size="sm" variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? t("Backing up…") : t("Back up now")}</Button> : null}
      </div>}>{t("Backups")}</PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        {b.configured
          ? t("Daily copy of the Google Sheet in the backups folder, kept {n} days. Last verified backup: {day}.", { n: b.retentionDays, day: b.lastDone ? fmtDay(b.lastDone.day, tag) : t("none yet") })
          : b.mode === "live"
            ? t("Daily copies are off: set BACKUP_DRIVE_FOLDER_ID on the host (docs/DEPLOYMENT.md › Backups). The JSON copy works now.")
            : t("Demo: no copy of a real spreadsheet is made. The JSON copy contains the demo data.")}
        {b.configured && !b.schedulerConfigured ? ` ${t("No external scheduler: the first visit of the day starts it.")}` : ""}
      </p>
      {b.runs.length ? (
        <table className="w-full text-sm"><thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Day")}</th><th className="font-medium">{t("Result")}</th><th className="text-right font-medium">{t("Rows")}</th><th /></tr></thead>
          <tbody>{b.runs.map((r, i) => (
            <tr key={`${r.day}-${i}`} className="border-t border-hairline align-top">
              <td className="py-1.5">{fmtDay(r.day, tag)}</td>
              <td>{r.status === "done" ? <Pill tone="good">{t("verified")}</Pill> : <Pill tone="bad">{t("failed")}</Pill>} {r.error ? <span className="block text-[12px] text-bad">{t(r.error)}</span> : null}</td>
              <td className="num text-right">{r.rows ?? "—"}</td>
              <td className="text-right">{r.file_id ? <span className="flex justify-end gap-2">{r.file_url ? <a className="text-[13px] underline" href={r.file_url} target="_blank" rel="noopener noreferrer">{t("Open")}</a> : null}<Button size="sm" variant="ghost" disabled={verify.isPending} onClick={() => verify.mutate(r.file_id)}>{t("Verify")}</Button></span> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="text-sm text-text-3">{t("No backup yet.")}</p>}
      <p className="mt-3 text-[12px] text-text-3">{t("Restore: into a new spreadsheet with npm run restore:sheets, never over the live one (docs/DEPLOYMENT.md › Restore).")}</p>
    </Panel>
  );
}

type AuditOut = { total: number; entities: string[]; rows: { at: string; actor: string; action: string; entity: string; record_id: string; fields: string[]; status: number | null; correlation_id: string }[] };

export function AuditPanel() {
  const t = useT();
  const tag = useDateTag();
  const [f, setF] = React.useState({ entity: "", founder: "", from: "", to: "" });
  const params = new URLSearchParams({ ...f, limit: "50" }).toString();
  const q = useQuery({ queryKey: ["audit", params], queryFn: () => api<AuditOut>(`/api/audit?${params}`) });
  return (
    <Panel className="overflow-x-auto">
      <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => q.refetch()}>{t("Refresh")}</Button>}>{t("Audit log")}</PanelTitle>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select aria-label={t("Entity")} value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
          <option value="">{t("All entities")}</option>
          {(q.data?.entities ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Select aria-label={t("Founder")} value={f.founder} onChange={(e) => setF({ ...f, founder: e.target.value })}>
          <option value="">{t("Both founders")}</option>
          {FOUNDERS.map((x) => <option key={x} value={x}>{FOUNDER_NAMES[x]}</option>)}
        </Select>
        <Input type="date" aria-label={t("From (date)")} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" aria-label={t("To (date)")} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </div>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.rows.length ? (
        <>
          <table className="w-full text-sm"><thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("When")}</th><th className="font-medium">{t("Who")}</th><th className="font-medium">{t("Action")}</th><th className="font-medium">{t("Fields")}</th><th className="text-right font-medium">{t("Result")}</th></tr></thead>
            <tbody>{q.data.rows.map((r, i) => (
              <tr key={`${r.correlation_id}-${i}`} className="border-t border-hairline align-top" title={r.correlation_id}>
                <td className="whitespace-nowrap py-1.5 pr-2">{fmtDateTime(r.at, undefined, tag)}</td>
                <td className="pr-2">{FOUNDER_NAMES[r.actor as "theo"] ?? r.actor}</td>
                <td className="pr-2 font-mono text-[12px]">{r.action}{r.record_id ? <span className="block text-text-3">{r.record_id.slice(0, 8)}</span> : null}</td>
                <td className="pr-2 text-[12px] text-text-2">{r.fields.slice(0, 6).join(", ")}{r.fields.length > 6 ? " …" : ""}</td>
                <td className={`num text-right ${r.status && r.status >= 400 ? "text-bad" : ""}`}>{r.status ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-2 text-[12px] text-text-3">{t("{n} of {total} entries · field names only, never values", { n: q.data.rows.length, total: q.data.total })}</p>
        </>
      ) : <p className="text-sm text-text-3">{t("No entry for these filters.")}</p>}
    </Panel>
  );
}
