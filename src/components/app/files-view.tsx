"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Folder } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Input, Panel, Select, Skeleton } from "@/components/ui/form";
import { DetailPanel } from "@/components/ui/overlay";
import { ApiError, api } from "@/lib/api";
import type { DriveFile } from "@/data/google/ports";
import { useCrm } from "./use-crm";

type Listing = { configured: boolean; root: string | null; folderId: string | null; files: DriveFile[]; links: { file_id: string; record_type: string; record_id: string; name: string }[] };
const isFolder = (f: DriveFile) => f.mimeType === "application/vnd.google-apps.folder";

export function FilesView() {
  const qc = useQueryClient();
  const [trail, setTrail] = React.useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = React.useState("");
  const [sel, setSel] = React.useState<DriveFile | null>(null);
  const folder = trail.at(-1)?.id;
  const q = useQuery({ queryKey: ["files", folder, search], queryFn: () => api<Listing>(`/api/files?q=${encodeURIComponent(search)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`) });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return api<DriveFile>("/api/files/upload", { body: { name: f.name, mime_type: f.type || "application/octet-stream", data_base64: btoa(bin) } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["files"] }); toast("Uploaded to Drive with your own Google account"); },
  });
  const consent = upload.error instanceof ApiError && upload.error.body.error === "consent_required";
  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
            <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm text-text-2">
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setTrail([])}>Valemont OS</button>
              {trail.map((t, i) => <span key={t.id}> / <button type="button" className="underline-offset-2 hover:underline" onClick={() => setTrail(trail.slice(0, i + 1))}>{t.name}</button></span>)}
            </nav>
          </div>
          <label className="inline-flex h-10 cursor-pointer items-center rounded-full bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover">
            {upload.isPending ? "Uploading…" : "Upload"}
            <input type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          </label>
        </div>
        {consent ? (
          <p role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] bg-subtle p-3 text-sm">
            Uploading creates the file in your own Google Drive, so Google needs your permission first (files Valemont OS creates only).
            <Button asChild size="sm" variant="primary"><a href="/api/auth/google/drive?back=/files">Allow Drive access</a></Button>
          </p>
        ) : upload.isError ? <ErrorState error={upload.error} onRetry={() => upload.reset()} /> : null}
        <Input aria-label="Search files" placeholder="Search in this folder" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 max-w-sm" />
        {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.configured ? (
          <EmptyState title="Drive folder not connected">Create a “Valemont OS” folder in Drive, share it with the service account as Viewer, then set its id in Settings › Workspace.</EmptyState>
        ) : q.data.files.length === 0 ? <p className="text-sm text-text-2">This folder is empty.</p> : (
          <Panel className="py-2">
            <ul>{q.data.files.map((f) => (
              <li key={f.id} className="border-t border-hairline first:border-t-0">
                <button type="button" onClick={() => (isFolder(f) ? setTrail([...trail, { id: f.id, name: f.name }]) : setSel(f))} className="flex min-h-11 w-full items-center gap-3 py-2 text-left text-sm hover:bg-subtle/50">
                  {isFolder(f) ? <Folder className="size-4 text-text-2" /> : <FileText className="size-4 text-text-2" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <span className="text-[12px] text-text-3">{q.data.links.filter((l) => l.file_id === f.id).length ? "linked" : ""}</span>
                </button>
              </li>
            ))}</ul>
          </Panel>
        )}
        <p className="text-[12px] text-text-3">Files are listed with read-only access. Uploads use your own Google account. Sharing stays Drive&apos;s; Valemont OS never makes a file public.</p>
      </div>
      {sel ? <FilePanel key={sel.id} f={sel} links={q.data?.links.filter((l) => l.file_id === sel.id) ?? []} onClose={() => setSel(null)} /> : null}
    </div>
  );
}

function FilePanel({ f, links, onClose }: { f: DriveFile; links: Listing["links"]; onClose: () => void }) {
  const qc = useQueryClient();
  const crm = useCrm();
  const [acc, setAcc] = React.useState("");
  const link = useMutation({ mutationFn: () => api("/api/files/link", { body: { file_id: f.id, record_type: "account", record_id: acc } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["files"] }); toast("Linked"); } });
  const name = new Map((crm.data?.accounts ?? []).map((a) => [a.id, a.name]));
  return (
    <DetailPanel open onClose={onClose} title={<h2 className="truncate text-lg font-semibold">{f.name}</h2>} footer={<Button asChild variant="outline"><a href={f.webViewLink} target="_blank" rel="noreferrer noopener"><ExternalLink /> Open in Drive</a></Button>}>
      <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-sm">
        <dt className="text-text-3">Type</dt><dd className="truncate">{f.mimeType}</dd>
        <dt className="text-text-3">Modified</dt><dd>{f.modifiedTime.slice(0, 10)}</dd>
      </dl>
      <section className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Linked to</h3>
        {links.length ? <ul className="mb-3 text-sm">{links.map((l) => <li key={l.record_id}>{l.record_type === "account" ? name.get(l.record_id) ?? "Business" : l.record_type}</li>)}</ul> : <p className="mb-3 text-sm text-text-2">Not linked yet.</p>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (acc) link.mutate(); }}>
          <Select aria-label="Business" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Link to a business…</option>{(crm.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Button type="submit" variant="outline" disabled={!acc || link.isPending}>Link</Button>
        </form>
        {link.isError ? <div className="mt-2"><ErrorState error={link.error} onRetry={() => link.mutate()} /></div> : null}
      </section>
    </DetailPanel>
  );
}

/** Compact files panel for a record (CRM detail). */
export function RecordFiles({ recordType, recordId }: { recordType: string; recordId: string }) {
  const q = useQuery({ queryKey: ["record-files", recordType, recordId], queryFn: () => api<{ id: string; name: string; url: string }[]>(`/api/files/link?record_type=${recordType}&record_id=${recordId}`) });
  if (q.isPending || q.isError || !q.data.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Files</h3>
      <ul className="flex flex-col gap-1 text-sm">{q.data.map((f) => <li key={f.id}><a className="underline underline-offset-2" href={f.url} target="_blank" rel="noreferrer noopener">{f.name}</a></li>)}</ul>
    </section>
  );
}
