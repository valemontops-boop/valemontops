"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, SegmentedSwitch, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { presetPeriod, type PeriodPreset } from "@/domain/export";
import { localDate } from "@/domain/time";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { newId } from "@/lib/ids";

export type CsvListKey = "accounts" | "contacts" | "deals" | "calls" | "tasks" | "content" | "quotes" | "projects" | "bank" | "local_usage";
const LIST_LABELS: Record<CsvListKey, string> = {
  accounts: "Businesses", contacts: "Contacts", deals: "Deals", calls: "Call log", tasks: "Tasks", content: "Content posts",
  quotes: "Quotes", projects: "Projects", bank: "Bank movements", local_usage: "Local usage",
};
type Preset = "all" | Exclude<PeriodPreset, "sprint">;

/**
 * One small CSV export per list (Stage 4A, D083), same style as "Export for AI": a ghost button, then the period
 * (all, 7 days, 30 days, this month, custom) and a plain download link. The server neutralises formula-like text.
 */
export function CsvExportButton({ list, periodic = true }: { list: CsvListKey; periodic?: boolean }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const today = React.useMemo(() => localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris"), []);
  const [preset, setPreset] = React.useState<Preset>("all");
  const [from, setFrom] = React.useState(today.slice(0, 8) + "01");
  const [to, setTo] = React.useState(today);
  const period = preset === "all" ? null : presetPeriod(preset, today, { from, to });
  const href = `/api/csv/export?list=${list}${period ? `&from=${period.from}&to=${period.to}` : ""}`;
  if (!periodic) {
    return <Button asChild size="sm" variant="ghost"><a href={href} download data-testid={`csv-export-${list}`}><Download /> {t("CSV")}</a></Button>;
  }
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`csv-export-${list}`}><Download /> {t("CSV")}</Button>
      <Modal open={open} onOpenChange={setOpen} title={t("Export {list} (CSV)", { list: t(LIST_LABELS[list]) })} description={t("Text that a spreadsheet could read as a formula is neutralised.")}>
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <SegmentedSwitch size="sm" label={t("Period")} value={preset} onChange={setPreset} options={[
              { value: "all", label: t("Everything") }, { value: "7d", label: t("7 days") }, { value: "30d", label: t("30 days") }, { value: "month", label: t("This month") }, { value: "custom", label: t("Custom") },
            ]} />
          </div>
          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("First day")} htmlFor={`csv-from-${list}`}><Input id={`csv-from-${list}`} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={t("Last day")} htmlFor={`csv-to-${list}`}><Input id={`csv-to-${list}`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
          ) : null}
          {preset === "custom" && !period ? <p className="text-sm text-bad">{t("Choose a start date before the end date.")}</p> : (
            <Button asChild variant="dark" className="self-start"><a href={href} download onClick={() => setTimeout(() => setOpen(false), 300)}><Download /> {t("Download")}</a></Button>
          )}
        </div>
      </Modal>
    </>
  );
}

type PreviewRow = { index: number; status: "new" | "duplicate" | "invalid"; title: string; errors: string[]; duplicateOf: "existing" | number | null };
type Preview = { rows: PreviewRow[]; counts: { new: number; duplicate: number; invalid: number }; unrecognized: string[] };
const IMPORT_HELP: Record<"tasks" | "content_ideas", string> = {
  tasks: "Columns: title (required), description, owner (Théo / Pablo), priority (P0–P3), due (YYYY-MM-DD), area (sales / marketing / ops), estimated minutes.",
  content_ideas: "Columns: title (required), format (reel, carousel, post, story, video), brand (Valemont / 30/30), hook, persona.",
};

/** CSV import with preview and dedupe (tasks, content ideas): nothing is written before "Import". */
export function CsvImportButton({ kind }: { kind: "tasks" | "content_ideas" }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState("");
  const [importId, setImportId] = React.useState(() => newId());
  const preview = useMutation({ mutationFn: () => api<Preview>("/api/csv/import/preview", { body: { kind, csv } }) });
  const commit = useMutation({
    mutationFn: () => api<{ imported: number; skipped: number }>("/api/csv/import/commit", { body: { kind, csv, import_id: importId } }),
    onSuccess: (r) => { qc.invalidateQueries(); toast(t("{n} rows imported, {s} skipped", { n: String(r.imported), s: String(r.skipped) })); setOpen(false); setCsv(""); setImportId(newId()); preview.reset(); },
  });
  const onFile = async (f: File | undefined) => { if (f) { setCsv(await f.text()); preview.reset(); } };
  const p = preview.data;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`csv-import-${kind}`}><Upload /> {t("Import CSV")}</Button>
      <Modal wide open={open} onOpenChange={setOpen} title={kind === "tasks" ? t("Import tasks (CSV)") : t("Import content ideas (CSV)")} description={t(IMPORT_HELP[kind])}>
        <div className="flex flex-col gap-4">
          <Field label={t("CSV file")} htmlFor={`csv-file-${kind}`}><Input id={`csv-file-${kind}`} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} /></Field>
          <Field label={t("Or paste the CSV")} htmlFor={`csv-text-${kind}`}><Textarea id={`csv-text-${kind}`} rows={5} className="font-mono text-[12px]" value={csv} onChange={(e) => { setCsv(e.target.value); preview.reset(); }} /></Field>
          {!p ? <Button type="button" variant="dark" className="self-start" disabled={!csv.trim() || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? t("Checking…") : t("Preview")}</Button> : null}
          {preview.isError ? <ErrorState error={preview.error} onRetry={() => preview.mutate()} /> : null}
          {p ? (
            <>
              <p className="text-sm"><span className="num font-semibold">{p.counts.new}</span> {t("new")} · <span className="num">{p.counts.duplicate}</span> {t("duplicates (skipped)")} · <span className="num">{p.counts.invalid}</span> {t("invalid (skipped)")}</p>
              {p.unrecognized.length ? <p className="text-[13px] text-text-3">{t("Columns ignored: {cols}", { cols: p.unrecognized.join(", ") })}</p> : null}
              <ul className="max-h-60 overflow-y-auto text-[13px]">
                {p.rows.slice(0, 50).map((r) => (
                  <li key={r.index} className="flex justify-between gap-3 border-t border-hairline py-1.5 first:border-t-0">
                    <span className="truncate">{r.title || "—"}</span>
                    <span className={r.status === "invalid" ? "text-bad" : r.status === "duplicate" ? "text-text-3" : "text-good"}>
                      {r.status === "new" ? t("new") : r.status === "duplicate" ? (r.duplicateOf === "existing" ? t("already in the app") : t("twice in the file")) : r.errors.map((e) => t(e)).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              {commit.isError ? <ErrorState error={commit.error} onRetry={() => commit.mutate()} /> : null}
              <Button type="button" variant="dark" className="self-start" disabled={!p.counts.new || commit.isPending} onClick={() => commit.mutate()}>{commit.isPending ? t("Importing…") : t("Import {n} rows", { n: String(p.counts.new) })}</Button>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
