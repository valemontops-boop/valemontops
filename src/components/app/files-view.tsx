"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Clock, ExternalLink, File, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, FolderPlus, HardDrive, LayoutGrid, List, Presentation, Search, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Input, Panel, Select, Skeleton } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DriveFile } from "@/data/google/ports";
import { useCrm } from "./use-crm";

type Listing = { configured: boolean; root: string | null; folderId: string | null; files: DriveFile[]; links: { file_id: string; record_type: string; record_id: string; name: string }[]; view: string };
const FOLDER = "application/vnd.google-apps.folder";
const isFolder = (f: DriveFile) => f.mimeType === FOLDER;

/** Icon + tint by Drive type, so files are recognisable at a glance (like Drive). */
function kindOf(mime: string): { icon: React.ComponentType<{ className?: string }>; label: string; tint: string } {
  if (mime === FOLDER) return { icon: Folder, label: "Folder", tint: "text-text-2" };
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return { icon: FileSpreadsheet, label: "Sheet", tint: "text-good" };
  if (mime.includes("presentation") || mime.includes("powerpoint")) return { icon: Presentation, label: "Slides", tint: "text-brand-local" };
  if (mime.includes("document") || mime.includes("word") || mime.startsWith("text/")) return { icon: FileText, label: "Doc", tint: "text-brand-consulting" };
  if (mime === "application/pdf") return { icon: FileText, label: "PDF", tint: "text-bad" };
  if (mime.startsWith("image/")) return { icon: FileImage, label: "Image", tint: "text-brand-thirty" };
  if (mime.startsWith("video/")) return { icon: FileVideo, label: "Video", tint: "text-brand-thirty" };
  return { icon: File, label: "File", tint: "text-text-2" };
}
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

async function toBase64(f: File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function FilesView() {
  const qc = useQueryClient();
  const [trail, setTrail] = React.useState<{ id: string; name: string }[]>([]);
  const [view, setView] = React.useState<"folder" | "recent">("folder");
  const [search, setSearch] = React.useState("");
  const [layout, setLayout] = React.useState<"grid" | "list">("grid");
  const [sort, setSort] = React.useState<"name" | "modified">("name");
  const [sel, setSel] = React.useState<DriveFile | null>(null);
  const [newFolder, setNewFolder] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const folder = trail.at(-1)?.id;
  const mode = search.trim() ? "search" : view;
  const q = useQuery({ queryKey: ["files", folder, search, mode], queryFn: () => api<Listing>(`/api/files?view=${mode}&q=${encodeURIComponent(search)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`) });
  const upload = useMutation({
    mutationFn: async (f: File) => api<DriveFile>("/api/files/upload", { body: { name: f.name, mime_type: f.type || "application/octet-stream", data_base64: await toBase64(f), parent_id: folder ?? null } }),
    onSuccess: (f) => { qc.invalidateQueries({ queryKey: ["files"] }); toast(`Uploaded ${f.name}`); },
  });
  const consent = upload.error instanceof ApiError && upload.error.body.error === "consent_required";
  const files = [...(q.data?.files ?? [])].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || (sort === "name" ? a.name.localeCompare(b.name) : b.modifiedTime.localeCompare(a.modifiedTime)));
  const open = (f: DriveFile) => (isFolder(f) ? (setTrail([...(view === "recent" || search ? [] : trail), { id: f.id, name: f.name }]), setView("folder"), setSearch("")) : setSel(f));

  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); for (const f of Array.from(e.dataTransfer.files).slice(0, 10)) upload.mutate(f); }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setNewFolder(true)}><FolderPlus /> New folder</Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover">
              <Upload className="size-4" />{upload.isPending ? "Uploading…" : "Upload"}
              <input type="file" multiple className="sr-only" onChange={(e) => { for (const f of Array.from(e.target.files ?? []).slice(0, 10)) upload.mutate(f); e.target.value = ""; }} />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
            <Input aria-label="Search in Drive" placeholder="Search the whole Valemont OS drive" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 pl-9" />
          </div>
          <div className="inline-flex rounded-full bg-subtle p-1">
            <button type="button" aria-pressed={view === "folder" && !search} onClick={() => { setView("folder"); setSearch(""); }} className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-sm", view === "folder" && !search ? "bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-2")}><HardDrive className="size-4" /> Drive</button>
            <button type="button" aria-pressed={view === "recent" && !search} onClick={() => { setView("recent"); setSearch(""); setTrail([]); }} className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-sm", view === "recent" && !search ? "bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-text-2")}><Clock className="size-4" /> Recent</button>
          </div>
          <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "name")} className="h-10 w-36"><option value="name">Name</option><option value="modified">Last modified</option></Select>
          <div className="inline-flex rounded-full bg-subtle p-1">
            <button type="button" aria-label="Grid" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} className={cn("flex size-8 items-center justify-center rounded-full", layout === "grid" && "bg-panel")}><LayoutGrid className="size-4" /></button>
            <button type="button" aria-label="List" aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={cn("flex size-8 items-center justify-center rounded-full", layout === "list" && "bg-panel")}><List className="size-4" /></button>
          </div>
        </div>

        {mode === "folder" ? (
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
            <button type="button" className="rounded-full px-2 py-1 font-medium hover:bg-subtle" onClick={() => setTrail([])}>Valemont OS</button>
            {trail.map((t, i) => <span key={t.id} className="flex items-center"><ChevronRight className="size-4 text-text-3" /><button type="button" className="rounded-full px-2 py-1 font-medium hover:bg-subtle" onClick={() => setTrail(trail.slice(0, i + 1))}>{t.name}</button></span>)}
          </nav>
        ) : <p className="text-sm text-text-2">{mode === "recent" ? "Recently modified files" : `Results for “${search}”`}</p>}

        {consent ? (
          <p role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] bg-subtle p-3 text-sm">
            Adding files creates them in your own Google Drive, so Google asks your permission once (only files Valemont OS creates).
            <Button asChild size="sm" variant="primary"><a href="/api/auth/google/drive?back=/files">Allow Drive access</a></Button>
          </p>
        ) : upload.isError ? <ErrorState error={upload.error} onRetry={() => upload.reset()} /> : null}

        <div className={cn("rounded-[20px] transition-colors", dragging && "bg-subtle ring-2 ring-ink ring-dashed")}>
          {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data.configured ? (
            <EmptyState title="Drive folder not connected">Create a “Valemont OS” folder in Google Drive, share it with the service account as Viewer, then paste its id in Settings › Workspace.</EmptyState>
          ) : files.length === 0 ? <EmptyState title={mode === "folder" ? "This folder is empty" : "Nothing found"}>Drop files here to upload them into this folder.</EmptyState> : layout === "grid" ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {files.map((f) => {
                const k = kindOf(f.mimeType);
                const linked = q.data.links.some((l) => l.file_id === f.id);
                return (
                  <li key={f.id}>
                    <button type="button" onClick={() => open(f)} onDoubleClick={() => !isFolder(f) && window.open(f.webViewLink, "_blank", "noopener")}
                      className={cn("flex w-full flex-col gap-2 rounded-[12px] border bg-panel p-3 text-left hover:border-control", sel?.id === f.id ? "border-ink" : "border-hairline")}>
                      <span className={cn("flex h-20 items-center justify-center rounded-[8px] bg-subtle/70", k.tint)}><k.icon className="size-9" /></span>
                      <span className="line-clamp-2 text-sm font-medium leading-snug">{f.name}</span>
                      <span className="text-[11px] text-text-3">{isFolder(f) ? "Folder" : `${k.label} · ${when(f.modifiedTime)}`}{linked ? " · linked" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Panel className="p-0 sm:p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3"><th className="px-5 py-2.5 font-medium">Name</th><th className="pr-4 font-medium">Type</th><th className="pr-5 font-medium">Modified</th></tr></thead>
                <tbody>{files.map((f) => { const k = kindOf(f.mimeType); return (
                  <tr key={f.id} onClick={() => open(f)} className={cn("cursor-pointer border-b border-hairline last:border-0 hover:bg-subtle", sel?.id === f.id && "bg-subtle")}>
                    <td className="px-5 py-2.5"><span className="flex items-center gap-2"><k.icon className={cn("size-4", k.tint)} /><span className="font-medium">{f.name}</span></span></td>
                    <td className="pr-4 text-text-2">{k.label}</td>
                    <td className="pr-5 text-text-2">{when(f.modifiedTime)}</td>
                  </tr>); })}</tbody>
              </table>
            </Panel>
          )}
        </div>
        <p className="text-[12px] text-text-3">Your “Valemont OS” Google Drive folder. Double-click a file to open it in Drive. Sharing stays Drive&apos;s; Valemont OS never makes a file public.</p>
      </div>
      {sel ? <FilePanel key={sel.id} f={sel} links={q.data?.links.filter((l) => l.file_id === sel.id) ?? []} onClose={() => setSel(null)} /> : null}
      <NewFolderModal open={newFolder} onOpenChange={setNewFolder} parentId={folder ?? null} />
    </div>
  );
}

function NewFolderModal({ open, onOpenChange, parentId }: { open: boolean; onOpenChange: (o: boolean) => void; parentId: string | null }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const m = useMutation({ mutationFn: () => api("/api/files/folder", { body: { name, parent_id: parentId } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["files"] }); toast("Folder created"); setName(""); onOpenChange(false); } });
  const consent = m.error instanceof ApiError && m.error.body.error === "consent_required";
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New folder">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.mutate(); }}>
        <Input aria-label="Folder name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clients / Garage du Parc" />
        {consent ? <p className="text-sm">Google needs your permission first. <a className="font-medium underline" href="/api/auth/google/drive?back=/files">Allow Drive access</a></p> : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={!name.trim() || m.isPending}>{m.isPending ? "Creating…" : "Create folder"}</Button>
      </form>
    </Modal>
  );
}

function FilePanel({ f, links, onClose }: { f: DriveFile; links: Listing["links"]; onClose: () => void }) {
  const qc = useQueryClient();
  const crm = useCrm();
  const [acc, setAcc] = React.useState("");
  const link = useMutation({ mutationFn: () => api("/api/files/link", { body: { file_id: f.id, record_type: "account", record_id: acc } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["files"] }); toast("Linked"); } });
  const name = new Map((crm.data?.accounts ?? []).map((a) => [a.id, a.name]));
  const k = kindOf(f.mimeType);
  return (
    <DetailPanel open onClose={onClose} title={<h2 className="truncate text-lg font-semibold">{f.name}</h2>} footer={<Button asChild variant="primary" className="w-full"><a href={f.webViewLink} target="_blank" rel="noreferrer noopener"><ExternalLink /> Open in Google Drive</a></Button>}>
      <div className={cn("mb-4 flex h-32 items-center justify-center rounded-[12px] bg-subtle/70", k.tint)}><k.icon className="size-12" /></div>
      <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-sm">
        <dt className="text-text-3">Type</dt><dd>{k.label}</dd>
        <dt className="text-text-3">Modified</dt><dd>{when(f.modifiedTime)}</dd>
        {f.size ? <><dt className="text-text-3">Size</dt><dd className="num">{Math.max(1, Math.round(Number(f.size) / 1024))} KB</dd></> : null}
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
