"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmailTab } from "./email-tab";
import { FunnelsTab } from "./marketing-funnels";
import { useT } from "@/i18n/react";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { BRANDS, BRAND_LABELS } from "@/domain/constants";
import { api } from "@/lib/api";
import { fmtDay } from "./bits";
import { CountrySplitButton, MarketingOverview, TrafficTab } from "./marketing-overview";
import { MarketingWeek, TasksFor } from "./my-day-extras";

type Account = { id: string; platform: "instagram" | "linkedin_page" | "linkedin_personal"; handle: string; brand: string | null; market: string | null; visibility: string; owner_founder: string | null };
type Series = { account: Account; metric: string; allowedMetrics: string[]; points: { date: string; value: number | null; source: string | null }[]; gaps: number; latest: { date: string; value: number; source: string } | null };
const METRIC_NAMES: Record<string, string> = { followers: "Followers", views: "Views", impressions: "Impressions", reach: "Reach", profile_visits: "Profile visits", interactions: "Interactions", link_clicks: "Link clicks" };
const PLATFORM: Record<string, string> = { instagram: "Instagram", linkedin_page: "LinkedIn page", linkedin_personal: "LinkedIn personal" };

export function MarketingView() {
  const t = useT();
  const [tab, setTab] = React.useState<"funnels" | "email" | "website" | "social" | "content">("funnels");
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Marketing")}</h1>
          <p className="text-sm text-text-2">{t("Which channel brings meetings, for how much work.")}</p>
        </div>
        <SegmentedSwitch label={t("Section")} value={tab} onChange={setTab} options={[{ value: "funnels", label: t("Funnels") }, { value: "email", label: t("Email") }, { value: "website", label: t("Website") }, { value: "social", label: t("Social") }, { value: "content", label: t("Content") }]} />
      </div>
      {tab === "funnels" ? <FunnelsTab /> : tab === "email" ? <EmailTab /> : tab === "website" ? <><MarketingOverview /><TrafficTab /></> : tab === "social" ? <AudienceTab /> : <ContentTab />}
    </div>
  );
}

function ContentTab() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel><MarketingWeek /></Panel>
      <Panel><TasksFor area="marketing" /></Panel>
    </div>
  );
}

function AudienceTab() {
  const accounts = useQuery({ queryKey: ["audience-accounts"], queryFn: () => api<Account[]>("/api/audience/accounts") });
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const current = accounts.data?.find((a) => a.id === (accountId ?? accounts.data?.[0]?.id));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-2">How views and followers evolve. Gaps stay visible; nothing is interpolated.</p>
        <Button variant="outline" onClick={() => setAdding(true)}>Add account</Button>
      </div>
      {accounts.isPending ? <Skeleton className="h-96" /> : accounts.isError ? <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} /> : accounts.data.length === 0 ? (
        <EmptyState title="No social account yet" action={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add your first account</Button>}>Add the Valemont and 30/30 pages, then import LinkedIn exports or enter numbers manually.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Account" value={current?.id} onChange={(e) => setAccountId(e.target.value)} className="h-9 w-72">
              {accounts.data.map((a) => <option key={a.id} value={a.id}>{a.handle} · {PLATFORM[a.platform]}{a.visibility === "owner" ? " (private to you)" : ""}</option>)}
            </Select>
          </div>
          {current ? <AccountChart key={current.id} account={current} /> : null}
        </>
      )}
      <AddAccountModal open={adding} onOpenChange={setAdding} />
    </div>
  );
}

function AccountChart({ account }: { account: Account }) {
  const [metric, setMetric] = React.useState<string | null>(null);
  const [days, setDays] = React.useState<"30" | "90">("30");
  const [asTable, setAsTable] = React.useState(false);
  const [entry, setEntry] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const q = useQuery({ queryKey: ["audience-series", account.id, metric, days], queryFn: () => api<Series>(`/api/audience/series?account_id=${account.id}&days=${days}${metric ? `&metric=${metric}` : ""}`) });
  const s = q.data;
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-text-2">{PLATFORM[account.platform]}{account.brand ? ` · ${BRAND_LABELS[account.brand as "local"]}` : ""}{account.market ? ` · ${account.market}` : ""}</p>
          {s?.latest ? (
            <p className="num text-[40px] font-semibold leading-none tracking-tight">{s.latest.value.toLocaleString("en")} <span className="text-sm font-normal text-text-2">{METRIC_NAMES[s.metric].toLowerCase()} on {fmtDay(s.latest.date)} · source: {s.latest.source}</span></p>
          ) : <p className="text-lg text-text-3">No data yet</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {s ? <SegmentedSwitch size="sm" label="Metric" value={s.metric} onChange={setMetric} options={s.allowedMetrics.map((m) => ({ value: m, label: METRIC_NAMES[m] }))} /> : null}
          <SegmentedSwitch size="sm" label="Period" value={days} onChange={setDays} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
          <SegmentedSwitch size="sm" label="Display" value={asTable ? "table" : "chart"} onChange={(v) => setAsTable(v === "table")} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
        </div>
      </div>
      {q.isPending ? <Skeleton className="h-72" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : asTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm"><thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">Date</th><th className="text-right font-medium">{METRIC_NAMES[s!.metric]}</th><th className="pl-4 font-medium">Source</th></tr></thead>
            <tbody>{[...s!.points].reverse().map((p) => <tr key={p.date} className="border-t border-hairline"><td className="py-1">{fmtDay(p.date)}</td><td className="num text-right">{p.value === null ? <span className="text-text-3">gap</span> : p.value.toLocaleString("en")}</td><td className="pl-4 text-text-2">{p.source ?? "—"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-72" aria-label={`${METRIC_NAMES[s!.metric]} over ${days} days`} role="img">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={s!.points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => fmtDay(d).slice(4)} stroke="var(--text-3)" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis stroke="var(--text-3)" fontSize={12} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
              <Tooltip cursor={{ stroke: "var(--control-border)" }} contentStyle={{ borderRadius: 999, border: "none", background: "var(--ink)", color: "var(--panel)", fontSize: 12, padding: "4px 12px" }} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => [Number(v).toLocaleString("en"), METRIC_NAMES[s!.metric]]} />
              <Line type="linear" dataKey="value" stroke="var(--ink)" strokeWidth={2} dot={{ r: 3, fill: "var(--ink)" }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {s ? <p className="mt-2 text-[12px] text-text-3">{s.gaps} day(s) without data in this period are left as gaps. {account.platform === "instagram" ? "Instagram views and LinkedIn impressions are different measures and are never added together." : "LinkedIn impressions are never added to Instagram views."}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
        <Button size="sm" variant="outline" onClick={() => setEntry(true)}>Enter numbers</Button>
        {account.platform !== "instagram" ? <Button size="sm" variant="outline" onClick={() => setImporting(true)}>Import LinkedIn export</Button> : null}
        {account.visibility === "team" ? <CountrySplitButton accountId={account.id} /> : null}
      </div>
      <ManualEntryModal open={entry} onOpenChange={setEntry} account={account} allowed={s?.allowedMetrics ?? []} />
      <ImportModal open={importing} onOpenChange={setImporting} account={account} />
    </Panel>
  );
}

function ManualEntryModal({ open, onOpenChange, account, allowed }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account; allowed: string[] }) {
  const qc = useQueryClient();
  const [date, setDate] = React.useState(() => new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA"));
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api("/api/audience/manual", { body: { account_id: account.id, date, ...Object.fromEntries(["followers", "views", "impressions", "reach", "profile_visits", "interactions", "link_clicks"].map((k) => [k, vals[k] ? Number(vals[k]) : null])) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audience-series"] }); toast("Saved"); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Enter numbers · ${account.handle}`} description="Recorded as source: manual. An import or API value for the same day takes precedence.">
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Date" htmlFor="me-date" className="col-span-2"><Input id="me-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {allowed.map((k) => <Field key={k} label={METRIC_NAMES[k]} htmlFor={`me-${k}`}><Input id={`me-${k}`} inputMode="numeric" className="num" value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value.replace(/\D/g, "") })} /></Field>)}
        {m.isError ? <div className="col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
        <Button type="submit" variant="primary" className="col-span-2" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save"}</Button>
      </form>
    </Modal>
  );
}

type Preview = { mapped: Record<string, string>; unrecognized: string[]; days: number; newRows: number; alreadyImported: number; range: { from: string; to: string } | null; committed: boolean };
function ImportModal({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account }) {
  const qc = useQueryClient();
  const [file, setFile] = React.useState<{ name: string; b64: string } | null>(null);
  const run = useMutation({
    mutationFn: (commit: boolean) => api<Preview>("/api/audience/import", { body: { account_id: account.id, file_name: file!.name, data_base64: file!.b64, commit } }),
    onSuccess: (r) => { if (r.committed) { qc.invalidateQueries({ queryKey: ["audience-series"] }); toast(`Imported ${r.newRows} day(s)`); } },
  });
  const onFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast("File too large (max 2 MB)");
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    setFile({ name: f.name, b64: btoa(bin) });
    run.reset();
  };
  const p = run.data;
  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFile(null); run.reset(); } }} title={`Import LinkedIn export · ${account.handle}`} description="Page analytics (.xls) or creator analytics (.xlsx). Columns are matched by name; re-importing a file adds nothing.">
      <div className="flex flex-col gap-3">
        <Field label="Export file" htmlFor="li-file"><input id="li-file" type="file" accept=".xls,.xlsx" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm file:mr-3 file:h-9 file:rounded-full file:border file:border-control file:bg-panel file:px-4" /></Field>
        <Button variant="outline" className="self-start" disabled={!file || run.isPending} onClick={() => run.mutate(false)}>{run.isPending && !run.variables ? "Reading…" : "Preview"}</Button>
        {run.isError ? <ErrorState error={run.error} onRetry={() => run.mutate(false)} /> : null}
        {p ? (
          <div className="flex flex-col gap-2 rounded-[12px] bg-subtle p-3 text-sm">
            <p><span className="num font-semibold">{p.days}</span> day(s){p.range ? ` from ${p.range.from} to ${p.range.to}` : ""} · <span className="num">{p.newRows}</span> new · <span className="num">{p.alreadyImported}</span> already imported</p>
            <p className="text-[13px] text-text-2">Mapped: {Object.entries(p.mapped).map(([h, f]) => `${h} → ${f}`).join(", ") || "none"}</p>
            {p.unrecognized.length ? <p className="text-[13px] text-text-2">Not recognised (ignored): {p.unrecognized.join(", ")}</p> : null}
            {p.committed ? <p className="font-medium">Imported.</p> : <Button variant="primary" className="self-start" disabled={p.newRows === 0 || run.isPending} onClick={() => run.mutate(true)}>Import {p.newRows} day(s)</Button>}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function AddAccountModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ platform: "linkedin_page", handle: "", brand: "consulting", market: "" });
  const m = useMutation({
    mutationFn: () => api("/api/audience/accounts", { body: { id, platform: v.platform, handle: v.handle, brand: v.platform === "linkedin_personal" ? null : v.brand, market: v.market || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audience-accounts"] }); toast("Saved"); setId(crypto.randomUUID()); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add a social account">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.handle.trim()) m.mutate(); }}>
        <Field label="Platform" htmlFor="sa-p"><Select id="sa-p" value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value })}><option value="linkedin_page">LinkedIn company page</option><option value="instagram">Instagram (professional)</option><option value="linkedin_personal">My personal LinkedIn (private to me)</option></Select></Field>
        <Field label="Name or handle" htmlFor="sa-h"><Input id="sa-h" value={v.handle} onChange={(e) => setV({ ...v, handle: e.target.value })} /></Field>
        {v.platform !== "linkedin_personal" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand" htmlFor="sa-b"><Select id="sa-b" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })}>{BRANDS.map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}</Select></Field>
            <Field label="Market" htmlFor="sa-m"><Select id="sa-m" value={v.market} onChange={(e) => setV({ ...v, market: e.target.value })}><option value="">FR + ES</option><option value="FR">France</option><option value="ES">Spain</option></Select></Field>
          </div>
        ) : <p className="text-[13px] text-text-2">Personal profile statistics are visible to you only and are never tagged with a brand.</p>}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending || !v.handle.trim()}>{m.isPending ? "Saving…" : "Add account"}</Button>
      </form>
    </Modal>
  );
}

/** Content tab of the Command Center: latest figure per team account, with source and date. */
export function AudienceSummary() {
  const accounts = useQuery({ queryKey: ["audience-accounts"], queryFn: () => api<Account[]>("/api/audience/accounts") });
  if (accounts.isPending) return <Skeleton className="h-40" />;
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;
  const team = accounts.data.filter((a) => a.visibility === "team");
  return (
    <Panel>
      <PanelTitle>Audience, latest figures</PanelTitle>
      {team.length === 0 ? <p className="text-sm text-text-2">No team account yet. Add them in Marketing.</p> : <ul className="flex flex-col divide-y divide-hairline">{team.map((a) => <AudienceRow key={a.id} account={a} />)}</ul>}
      <p className="mt-3 text-[12px] text-text-3">Content planning and weekly content targets arrive in Stage 3.</p>
    </Panel>
  );
}
function AudienceRow({ account }: { account: Account }) {
  const q = useQuery({ queryKey: ["audience-series", account.id, null, "30"], queryFn: () => api<Series>(`/api/audience/series?account_id=${account.id}&days=30`) });
  return (
    <li className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
      <span><span className="font-medium">{account.handle}</span> <span className="text-text-3">{PLATFORM[account.platform]}</span></span>
      <span className="num text-right">{q.data?.latest ? `${q.data.latest.value.toLocaleString("en")} ${METRIC_NAMES[q.data.metric].toLowerCase()} · ${q.data.latest.source} · ${fmtDay(q.data.latest.date)}` : q.isPending ? "…" : "no data"}</span>
    </li>
  );
}
