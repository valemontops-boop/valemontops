"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, Select, Textarea } from "@/components/ui/form";
import { BRANDS, BRAND_LABELS, FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import type { ImportPreview } from "@/domain/csv";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ImportView() {
  const qc = useQueryClient();
  const [importId, setImportId] = React.useState(() => crypto.randomUUID()); // stable across retries: re-submitting adds nothing
  const [csv, setCsv] = React.useState("");
  const [brand, setBrand] = React.useState("local");
  const [owner, setOwner] = React.useState("");
  const [source, setSource] = React.useState("CSV import");
  const [listName, setListName] = React.useState("");
  const [result, setResult] = React.useState<{ imported: number; contacts: number; skipped: number } | null>(null);
  const preview = useMutation({ mutationFn: () => api<ImportPreview>("/api/crm/import/preview", { body: { csv } }) });
  const commit = useMutation({
    mutationFn: () => api<{ imported: number; contacts: number; skipped: number }>("/api/crm/import/commit", { body: { import_id: importId, csv, brand, owner_founder: owner || null, lead_source: source, list_name: listName } }),
    onSuccess: (r) => { qc.invalidateQueries(); setResult(r); toast(`Imported ${r.imported} businesses`); },
  });
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) return toast("File too large (max 1 MB)");
    setCsv(await f.text());
    setImportId(crypto.randomUUID());
    setResult(null);
    preview.reset();
  };
  const p = preview.data;
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div>
        <Link href="/crm" className="text-sm text-text-2 underline">Sales CRM</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Import a call list</h1>
        <p className="text-sm text-text-2">CSV with a header row. Recognised columns: company, website, phone, email, contact name, role, LinkedIn, country, city, sector, niche, contact type, language, notes. Duplicates are detected by domain, email and phone. No scraping: lists you are allowed to use only.</p>
      </div>
      <Panel>
        <div className="flex flex-col gap-4">
          <Field label="CSV file" htmlFor="csv-file"><input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm file:mr-3 file:h-9 file:rounded-full file:border file:border-control file:bg-panel file:px-4" /></Field>
          <Field label="Or paste CSV" htmlFor="csv-text"><Textarea id="csv-text" value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} className="num min-h-32 font-mono text-[13px]" placeholder={"Company,Website,Phone,Country\nPlomberie Exemple,plomberie.example.com,+33 1 00 00 00 00,FR"} /></Field>
          <Field label="List name (you will call through it)" htmlFor="imp-name"><Input id="imp-name" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Garages Lyon · November" /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Brand" htmlFor="imp-brand"><Select id="imp-brand" value={brand} onChange={(e) => setBrand(e.target.value)}>{BRANDS.map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}</Select></Field>
            <Field label="Owner" htmlFor="imp-owner"><Select id="imp-owner" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Unassigned</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
            <Field label="Lead source" htmlFor="imp-src"><Input id="imp-src" value={source} onChange={(e) => setSource(e.target.value)} /></Field>
          </div>
          <Button variant="dark" className="self-start" disabled={!csv.trim() || preview.isPending} onClick={() => preview.mutate()}>{preview.isPending ? "Checking…" : "Preview"}</Button>
          {preview.isError ? <ErrorState error={preview.error} onRetry={() => preview.mutate()} /> : null}
        </div>
      </Panel>

      {p ? (
        <Panel>
          <PanelTitle action={
            <Button variant="primary" disabled={p.counts.new === 0 || commit.isPending || Boolean(result)} onClick={() => commit.mutate()}>
              {commit.isPending ? "Importing…" : result ? "Imported" : `Import ${p.counts.new} new`}
            </Button>
          }>Preview</PanelTitle>
          <p className="text-sm">
            <span className="num font-semibold">{p.counts.new}</span> new · <span className="num">{p.counts.duplicate}</span> duplicates skipped · <span className="num">{p.counts.invalid}</span> invalid
          </p>
          <p className="mt-1 text-[13px] text-text-2">Mapped: {Object.entries(p.mapped).map(([h, f]) => `${h} → ${f}`).join(", ") || "none"}</p>
          {p.unrecognized.length ? <p className="mt-1 text-[13px] text-text-2">Ignored columns: {p.unrecognized.join(", ")}</p> : null}
          {result ? <p className="mt-3 rounded-[12px] bg-subtle p-3 text-sm">Imported {result.imported} businesses and {result.contacts} contacts into a call list. <Link className="font-medium underline" href="/call">Start calling</Link></p> : null}
          {commit.isError ? <div className="mt-3"><ErrorState error={commit.error} onRetry={() => commit.mutate()} /></div> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3"><th className="py-2 font-medium">Row</th><th className="font-medium">Status</th><th className="font-medium">Company</th><th className="font-medium">Country</th><th className="font-medium">Phone</th><th className="font-medium">Detail</th></tr></thead>
              <tbody>
                {p.rows.slice(0, 200).map((r) => (
                  <tr key={r.index} className="border-b border-hairline last:border-0">
                    <td className="num py-2">{r.index + 2}</td>
                    <td className={cn(r.status === "invalid" && "text-bad", r.status === "duplicate" && "text-text-2")}>{r.status}</td>
                    <td>{r.data?.company ?? "—"}</td>
                    <td>{r.data?.country || "—"}</td>
                    <td className="num">{r.data?.phone || "—"}</td>
                    <td className="text-[13px] text-text-2">{r.errors.join("; ") || (r.duplicateOf ? `Same ${r.duplicateOf.reason} as ${r.duplicateOf.existingAccountId ? "an existing business" : `row ${(r.duplicateOf.inFileRow ?? 0) + 2}`}` : "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {p.rows.length > 200 ? <p className="mt-2 text-[13px] text-text-3">Showing the first 200 of {p.rows.length} rows.</p> : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
