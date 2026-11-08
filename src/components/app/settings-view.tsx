"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { CONTACT_TYPE_LABELS, RULE_STATUSES } from "@/domain/constants";
import { ApiError, api } from "@/lib/api";
import { relTime } from "@/lib/utils";
import { useMe } from "./providers";
import { TargetsEditor } from "./targets-editor";
import { useMyDay } from "./use-crm";
import { ConflictNotice } from "./conflict";

type Tab = "profile" | "targets" | "rules" | "suppression" | "diagnostics" | "roadmap";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsView() {
  const [tab, setTab] = React.useState<Tab>("profile");
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="overflow-x-auto">
        <SegmentedSwitch label="Settings section" value={tab} onChange={setTab} options={[
          { value: "profile", label: "Profile" }, { value: "targets", label: "Mode & targets" }, { value: "rules", label: "Channel rules" },
          { value: "suppression", label: "Suppression" }, { value: "diagnostics", label: "Diagnostics" }, { value: "roadmap", label: "Roadmap" },
        ]} />
      </div>
      {tab === "profile" ? <Profile /> : tab === "targets" ? <TargetsTab /> : tab === "rules" ? <Rules /> : tab === "suppression" ? <Suppression /> : tab === "diagnostics" ? <Diagnostics /> : <Roadmap />}
    </div>
  );
}

function TargetsTab() {
  const d = useMyDay();
  return <Panel>{d.isPending ? <Skeleton className="h-40" /> : <TargetsEditor initialMode={d.data?.mode ?? null} />}</Panel>;
}

type UserRow = { id: string; version: number; timezone: string; workdays: number[]; capacity_minutes: number; display_name: string };
function Profile() {
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api<UserRow>("/api/settings/profile") });
  if (q.isPending) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <ProfileForm key={q.data.version} initial={q.data} onReload={() => q.refetch()} />;
}

function ProfileForm({ initial, onReload }: { initial: UserRow; onReload: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState<UserRow>(initial);
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/settings/profile", { body: { expected_version: expected, timezone: v!.timezone, workdays: v!.workdays, capacity_minutes: v!.capacity_minutes } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  return (
    <Panel>
      <PanelTitle>{v.display_name}</PanelTitle>
      <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(v.version); }}>
        <Field label="Time zone" htmlFor="tz" hint="Your day closes at local midnight in this time zone."><Input id="tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} /></Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-text-2">Workdays</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-control px-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-panel">
                <input type="checkbox" className="sr-only" checked={v.workdays.includes(i)} onChange={(e) => setV({ ...v, workdays: e.target.checked ? [...v.workdays, i].sort() : v.workdays.filter((x) => x !== i) })} />{d}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-text-3">Days off are never penalised.</p>
        </fieldset>
        <Field label="Outreach capacity per workday (minutes)" htmlFor="cap" hint="Excludes meetings and delivery time. Used for the feasibility check."><Input id="cap" type="number" min={0} max={960} className="num w-32" value={v.capacity_minutes} onChange={(e) => setV({ ...v, capacity_minutes: Number(e.target.value) || 0 })} /></Field>
        {err?.isConflict ? <ConflictNotice mine={v as never} current={err.body.current} fields={["timezone", "capacity_minutes"]} onKeepTheirs={onReload} onApplyMine={() => m.mutate(Number(err.body.current?.version))} /> : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(v.version)} /> : null}
        <Button type="submit" variant="dark" className="self-start" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save"}</Button>
      </form>
    </Panel>
  );
}

type Rule = { id: string; version: number; market: "FR" | "ES"; contact_type: keyof typeof CONTACT_TYPE_LABELS; channel: string; status: (typeof RULE_STATUSES)[number]; note: string; source_url: string; review_date: string | null };
function Rules() {
  const q = useQuery({ queryKey: ["rules"], queryFn: () => api<Rule[]>("/api/settings/channel-rules") });
  const [market, setMarket] = React.useState<"FR" | "ES">("FR");
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Panel>
      <PanelTitle action={<SegmentedSwitch size="sm" label="Market" value={market} onChange={setMarket} options={[{ value: "FR", label: "France" }, { value: "ES", label: "Spain" }]} />}>Outreach rules</PanelTitle>
      <p className="mb-4 rounded-[12px] bg-subtle p-3 text-[13px] text-text-2">This is not legal advice. Every rule starts as “needs review” for qualified counsel to confirm. The logging form shows the status and warns; opt-outs and the suppression list are always a hard block.</p>
      <div className="flex flex-col divide-y divide-hairline">
        {q.data.filter((r) => r.market === market).map((r) => <RuleRow key={r.id + r.version} rule={r} />)}
      </div>
    </Panel>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({ status: rule.status, note: rule.note, source_url: rule.source_url, review_date: rule.review_date ?? "" });
  const dirty = v.status !== rule.status || v.note !== rule.note || v.source_url !== rule.source_url || v.review_date !== (rule.review_date ?? "");
  const m = useMutation({ mutationFn: () => api("/api/settings/channel-rules", { body: { id: rule.id, expected_version: rule.version, ...v } }), onSuccess: () => { qc.invalidateQueries(); toast("Saved"); } });
  return (
    <div className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[180px_180px_1fr]">
      <div className="text-sm"><p className="font-medium">{CONTACT_TYPE_LABELS[rule.contact_type]}</p><p className="text-text-2">{rule.channel.replace("_", " ")}</p></div>
      <Select aria-label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as Rule["status"] })} className="h-9">{RULE_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
      <div className="flex flex-col gap-2">
        <Input aria-label="Note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Note for this rule" className="h-9" />
        {dirty ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Source URL" value={v.source_url} onChange={(e) => setV({ ...v, source_url: e.target.value })} placeholder="Source URL" className="h-9 max-w-xs" />
            <Input aria-label="Review date" type="date" value={v.review_date} onChange={(e) => setV({ ...v, review_date: e.target.value })} className="h-9 w-40" />
            <Button size="sm" variant="dark" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Saving…" : "Save"}</Button>
          </div>
        ) : rule.source_url ? <a className="truncate text-[12px] text-text-3 underline" href={rule.source_url} target="_blank" rel="noreferrer noopener">{rule.source_url}</a> : null}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      </div>
    </div>
  );
}

function Suppression() {
  const qc = useQueryClient();
  const [kind, setKind] = React.useState("email");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const m = useMutation({ mutationFn: () => api<{ added: boolean }>("/api/crm/suppression", { body: { kind, value, reason } }), onSuccess: (r) => { qc.invalidateQueries(); toast(r.added ? "Added to the suppression list" : "Already suppressed"); setValue(""); } });
  return (
    <Panel>
      <PanelTitle>Suppression list</PanelTitle>
      <p className="mb-4 text-sm text-text-2">A suppressed email, phone or domain blocks outreach logging and queueing for both founders on every channel. To opt out a known contact, use “Mark opted out” on the contact in the CRM.</p>
      <form className="flex max-w-xl flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (value.trim()) m.mutate(); }}>
        <div className="flex gap-2">
          <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-32"><option value="email">Email</option><option value="phone">Phone</option><option value="domain">Domain</option></Select>
          <Input aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. owner@business.example.com" />
        </div>
        <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="dark" className="self-start" disabled={m.isPending || !value.trim()}>{m.isPending ? "Saving…" : "Suppress"}</Button>
      </form>
    </Panel>
  );
}

type Diag = { adapter: string; stats: { requests: number; requestsLastMinute: number; retries: number; errors: number; lastError: string | null; lastSuccessAt: string | null }; revisions: Record<string, string>; tables: { table: string; rows: number; warnings: number }[]; warnings: { table: string; kind: string; detail: string; rowNumber?: number }[] };
function Diagnostics() {
  const me = useMe();
  const q = useQuery({ queryKey: ["diagnostics"], queryFn: () => api<Diag>("/api/diagnostics") });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => q.refetch()}>Refresh</Button>}>Storage</PanelTitle>
        <dl className="grid grid-cols-[200px_1fr] gap-y-1.5 text-sm">
          <dt className="text-text-3">Mode</dt><dd>{me.config.mode?.toUpperCase()} · {me.config.backend === "google-sheets" ? "Google Sheets" : me.config.backend === "fake-sheets" ? "local fake Sheets server" : "server memory (demo)"}</dd>
          <dt className="text-text-3">Sheets API requests (this server)</dt><dd className="num">{d.stats.requests} total · {d.stats.requestsLastMinute} in the last minute (budget: 60/min shared by both founders)</dd>
          <dt className="text-text-3">Retries / errors</dt><dd className="num">{d.stats.retries} / {d.stats.errors}</dd>
          <dt className="text-text-3">Last success</dt><dd>{relTime(d.stats.lastSuccessAt)}</dd>
          {d.stats.lastError ? <><dt className="text-text-3">Last error</dt><dd className="text-bad">{d.stats.lastError}</dd></> : null}
          <dt className="text-text-3">Poll interval</dt><dd>{me.config.pollSeconds} s (reads one small revision range)</dd>
        </dl>
      </Panel>
      <Panel className="overflow-x-auto">
        <PanelTitle>Tabs</PanelTitle>
        <table className="w-full text-sm"><thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">Tab</th><th className="text-right font-medium">Rows</th><th className="text-right font-medium">Integrity warnings</th></tr></thead>
          <tbody>{d.tables.map((t) => <tr key={t.table} className="border-t border-hairline"><td className="py-1.5">{t.table}</td><td className="num text-right">{t.rows}</td><td className={`num text-right ${t.warnings ? "text-bad" : ""}`}>{t.warnings}</td></tr>)}</tbody>
        </table>
        {d.warnings.length ? (
          <ul className="mt-4 flex flex-col gap-1 text-[13px]">{d.warnings.map((w, i) => <li key={i}><span className="font-medium">{w.table}</span>{w.rowNumber ? ` row ${w.rowNumber}` : ""}: {w.kind.replace(/_/g, " ")} ({w.detail})</li>)}</ul>
        ) : <p className="mt-3 text-sm text-text-2">No integrity warnings.</p>}
      </Panel>
    </div>
  );
}

const ROADMAP: [string, string][] = [
  ["Stage 1B", "Tasks (P0–P3, views, Kanban), private job-search spreadsheets, daily scoring and streaks, sprints, Command Center, Next Best Action queue, weekly review, reports, notifications, Agenda and Founder Points (shared calendars), Idea Box, Files (Drive), Audience tracking with LinkedIn import."],
  ["Stage 2", "Audit questionnaires by sector, price book, PDF quotes with commercial policy, Won → Client & Project workflow, supplier bench, capacity, Local subscription usage and per-client margin."],
  ["Stage 3", "Managerial P&L, MRR/ARR, EBITDA estimate, EUR/USD with ECB rates, Ad Fund, content planning FR/ES, Instagram adapter and snapshot job."],
  ["Stage 4", "Integration Hub, website webhooks, optional Calendar/Gmail OAuth, backups with tested restore, security hardening, deployment."],
];
function Roadmap() {
  return (
    <Panel>
      <PanelTitle>Planned modules</PanelTitle>
      <p className="mb-4 text-sm text-text-2">Modules appear in the navigation only once they work.</p>
      <ol className="flex flex-col gap-3">{ROADMAP.map(([s, t]) => <li key={s} className="text-sm"><span className="font-semibold">{s}.</span> <span className="text-text-2">{t}</span></li>)}</ol>
    </Panel>
  );
}
