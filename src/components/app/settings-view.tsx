"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DEFAULT_PLAYBOOK, EMAIL_TEMPLATE_LABELS, objectionLabel, type Lang, type PlaybookItem } from "@/domain/playbook";
import { CONTACT_TYPE_LABELS, RULE_STATUSES } from "@/domain/constants";
import { ApiError, api } from "@/lib/api";
import { relTime } from "@/lib/utils";
import { useMe } from "./providers";
import { TargetsEditor } from "./targets-editor";
import { useMyDay } from "./use-crm";
import { ConflictNotice } from "./conflict";
import Link from "next/link";
import { FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import { addDays } from "@/domain/time";

type Tab = "profile" | "targets" | "calendars" | "sprint" | "workspace" | "playbook" | "rules" | "suppression" | "diagnostics" | "roadmap";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SettingsView() {
  const [tab, setTab] = React.useState<Tab>("profile");
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <nav aria-label="More" className="grid grid-cols-3 gap-2 md:hidden">
        {[["/marketing", "Marketing"], ["/agenda", "Agenda"], ["/ideas", "Ideas"], ["/files", "Files"], ["/reports", "Reports"], ["/tasks", "Tasks"]].map(([h, l]) => (
          <Link key={h} href={h} className="flex h-12 items-center justify-center rounded-[12px] bg-panel text-sm font-medium">{l}</Link>
        ))}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="overflow-x-auto">
        <SegmentedSwitch label="Settings section" value={tab} onChange={setTab} options={[
          { value: "profile", label: "Profile" }, { value: "targets", label: "Mode & targets" }, { value: "calendars", label: "Calendars" }, { value: "sprint", label: "Sprint" }, { value: "workspace", label: "Workspace" }, { value: "playbook", label: "Playbook" }, { value: "rules", label: "Channel rules" },
          { value: "suppression", label: "Suppression" }, { value: "diagnostics", label: "Diagnostics" }, { value: "roadmap", label: "Roadmap" },
        ]} />
      </div>
      {tab === "profile" ? <Profile /> : tab === "targets" ? <TargetsTab /> : tab === "calendars" ? <Calendars /> : tab === "sprint" ? <SprintTab /> : tab === "workspace" ? <Workspace /> : tab === "playbook" ? <PlaybookTab /> : tab === "rules" ? <Rules /> : tab === "suppression" ? <Suppression /> : tab === "diagnostics" ? <Diagnostics /> : <Roadmap />}
    </div>
  );
}

function TargetsTab() {
  const d = useMyDay();
  return <Panel>{d.isPending ? <Skeleton className="h-40" /> : <TargetsEditor initialMode={d.data?.mode ?? null} />}</Panel>;
}

type UserRow = { id: string; version: number; timezone: string; workdays: number[]; capacity_minutes: number; display_name: string; avail_start: string; avail_end: string };
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
    mutationFn: (expected: number) => api("/api/settings/profile", { body: { expected_version: expected, timezone: v!.timezone, workdays: v!.workdays, capacity_minutes: v!.capacity_minutes, avail_start: v!.avail_start || "09:00", avail_end: v!.avail_end || "18:00" } }),
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Available for founder points from" htmlFor="av-s"><Input id="av-s" type="time" value={v.avail_start || "09:00"} onChange={(e) => setV({ ...v, avail_start: e.target.value })} /></Field>
          <Field label="until" htmlFor="av-e"><Input id="av-e" type="time" value={v.avail_end || "18:00"} onChange={(e) => setV({ ...v, avail_end: e.target.value })} /></Field>
        </div>
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

type Source = { id: string; version: number; calendar_id: string; label: string; kind: "shared" | "personal"; owner_founder: string | null; access: string };
function Calendars() {
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: ["calendar-sources"], queryFn: () => api<Source[]>("/api/calendar-sources") });
  const [v, setV] = React.useState({ calendar_id: "", label: "", kind: "shared" as "shared" | "personal", access: "free_busy" });
  const add = useMutation({ mutationFn: () => api("/api/calendar-sources", { body: { ...v, owner_founder: v.kind === "personal" ? me.founder : null } }), onSuccess: () => { qc.invalidateQueries(); toast("Calendar added"); setV({ calendar_id: "", label: "", kind: "shared", access: "free_busy" }); } });
  const remove = useMutation({ mutationFn: (s: Source) => api("/api/calendar-sources", { method: "PATCH", body: { id: s.id, expected_version: s.version } }), onSuccess: () => qc.invalidateQueries() });
  return (
    <Panel>
      <PanelTitle>Calendars</PanelTitle>
      <ol className="mb-4 flex list-decimal flex-col gap-1 pl-5 text-sm text-text-2">
        <li>Create a shared “Valemont” Google calendar; share it with your co-founder and with the service account (“Make changes to events”).</li>
        <li>Each founder shares their own calendar with the service account (“See only free/busy” is recommended).</li>
        <li>Paste each calendar id below (Google Calendar › Settings › Integrate calendar). Ids are never guessed from your sign-in address.</li>
      </ol>
      {q.isPending ? <Skeleton className="h-20" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <ul className="mb-4 flex flex-col divide-y divide-hairline text-sm">
          {q.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0"><span className="font-medium">{s.label}</span> <span className="text-text-3">{s.kind === "shared" ? "shared" : `${FOUNDER_NAMES[s.owner_founder as "theo"]} personal · ${s.access === "details" ? "details" : "free/busy"}`}</span><span className="block truncate text-[12px] text-text-3">{s.calendar_id}</span></span>
              {s.kind === "shared" || s.owner_founder === me.founder ? <Button size="sm" variant="ghost" onClick={() => remove.mutate(s)}>Remove</Button> : null}
            </li>
          ))}
          {q.data.length === 0 ? <li className="py-2 text-text-2">No calendar yet.</li> : null}
        </ul>
      )}
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (v.calendar_id && v.label) add.mutate(); }}>
        <Field label="Calendar id" htmlFor="cs-id"><Input id="cs-id" value={v.calendar_id} onChange={(e) => setV({ ...v, calendar_id: e.target.value })} placeholder="…@group.calendar.google.com" /></Field>
        <Field label="Label" htmlFor="cs-l"><Input id="cs-l" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <Field label="Type" htmlFor="cs-k"><Select id="cs-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as "shared" })}><option value="shared">Shared Valemont calendar</option><option value="personal">My personal calendar</option></Select></Field>
        {v.kind === "personal" ? <Field label="Shared with the service account as" htmlFor="cs-a" hint="Your co-founder always sees only Busy, whatever you choose."><Select id="cs-a" value={v.access} onChange={(e) => setV({ ...v, access: e.target.value })}><option value="free_busy">Free/busy only</option><option value="details">All event details (so you see titles)</option></Select></Field> : null}
        {add.isError ? <div className="sm:col-span-2"><ErrorState error={add.error} onRetry={() => add.mutate()} /></div> : null}
        <Button type="submit" variant="primary" className="self-start" disabled={add.isPending || !v.calendar_id || !v.label}>Add calendar</Button>
      </form>
    </Panel>
  );
}

function SprintTab() {
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString("en-CA");
  const cur = useQuery({ queryKey: ["sprint"], queryFn: () => api<{ progress: { sprint: { name: string; start_date: string; end_date: string } } | null }>("/api/sprints") });
  const blank = { contacted: 50, replies: 10, demos: 3, pilots: 1 };
  const [v, setV] = React.useState({ name: "14-day sprint", start_date: today, end_date: addDays(today, 13), niche: "", theo: blank, pablo: blank, local: 70, consulting: 20, thirty: 10 });
  const m = useMutation({
    mutationFn: () => api("/api/sprints", { body: { name: v.name, start_date: v.start_date, end_date: v.end_date, niche: v.niche, targets: { theo: v.theo, pablo: v.pablo }, brand_split: { local: v.local / 100, consulting: v.consulting / 100, thirty: v.thirty / 100 } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Sprint started"); },
  });
  return (
    <Panel>
      <PanelTitle>Sprint</PanelTitle>
      <p className="mb-4 text-sm text-text-2">{cur.data?.progress ? `Active: ${cur.data.progress.sprint.name} (${cur.data.progress.sprint.start_date} → ${cur.data.progress.sprint.end_date}). Starting a new sprint closes it.` : "No active sprint."} Targets are working targets, not forecasts.</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Name" htmlFor="sp-n" className="sm:col-span-2"><Input id="sp-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Start" htmlFor="sp-s"><Input id="sp-s" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></Field>
          <Field label="End" htmlFor="sp-e"><Input id="sp-e" type="date" value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></Field>
          <Field label="Niche for new targets" htmlFor="sp-ni" className="sm:col-span-2" hint="Feeds the Next Best Action queue, e.g. garage"><Input id="sp-ni" value={v.niche} onChange={(e) => setV({ ...v, niche: e.target.value })} /></Field>
        </div>
        <table className="w-full max-w-lg text-sm">
          <thead><tr className="text-left text-[12px] text-text-3"><th className="font-medium">Per founder</th>{FOUNDERS.map((f) => <th key={f} className="font-medium">{FOUNDER_NAMES[f]}</th>)}</tr></thead>
          <tbody>{(["contacted", "replies", "demos", "pilots"] as const).map((k) => <tr key={k} className="border-t border-hairline"><td className="py-1.5">{{ contacted: "Businesses contacted", replies: "Qualified replies", demos: "Demos", pilots: "Pilot clients" }[k]}</td>{FOUNDERS.map((f) => <td key={f} className="py-1.5 pr-2"><Input aria-label={`${FOUNDER_NAMES[f]} ${k}`} type="number" min={0} className="num h-9 w-20" value={v[f][k]} onChange={(e) => setV({ ...v, [f]: { ...v[f], [k]: Math.max(0, Number(e.target.value) || 0) } })} /></td>)}</tr>)}</tbody>
        </table>
        <div className="grid max-w-lg grid-cols-3 gap-3">
          {(["local", "consulting", "thirty"] as const).map((b) => <Field key={b} label={`${{ local: "Local", consulting: "Consulting", thirty: "30/30" }[b]} effort %`} htmlFor={`sp-${b}`}><Input id={`sp-${b}`} type="number" min={0} max={100} className="num" value={v[b]} onChange={(e) => setV({ ...v, [b]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>)}
        </div>
        {v.local + v.consulting + v.thirty !== 100 ? <p className="text-sm text-bad">The effort split adds up to {v.local + v.consulting + v.thirty}%, not 100%.</p> : null}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" className="self-start" disabled={m.isPending || v.local + v.consulting + v.thirty !== 100}>{m.isPending ? "Saving…" : "Start sprint"}</Button>
      </form>
    </Panel>
  );
}

function Workspace() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["system-settings"], queryFn: () => api<Record<string, string>>("/api/settings/system") });
  const save = useMutation({ mutationFn: (b: { key: string; value: string }) => api("/api/settings/system", { body: b }), onSuccess: () => { qc.invalidateQueries(); toast("Saved"); } });
  const LABELS: Record<string, [string, string]> = {
    company_name: ["Company legal name", "Entered by a founder; never invented."],
    drive_folder_id: ["Drive folder id", "The “Valemont OS” folder shared with the service account as Viewer (the id in its URL)."],
    founder_point_video_link: ["Standing video link", "Inserted in every founder point event."],
    ideas_testing_limit: ["Ideas in Testing during a sprint", "Seed 2."],
    hot_lead_stale_days: ["Hot lead goes cold after (days)", "Seed 5."],
    conversion_min_sample: ["Show conversion rates from (attempts)", "Below this, reports say “not enough data”."],
    calendly_url_theo: ["Théo's Calendly link", "Inserted in call follow-ups (email and WhatsApp)."],
    calendly_url_pablo: ["Pablo's Calendly link", "Inserted in call follow-ups (email and WhatsApp)."],
    deck_url_fr: ["Commercial deck, French", "A Drive or PDF link shared “anyone with the link”."],
    deck_url_es: ["Commercial deck, Spanish", "A Drive or PDF link shared “anyone with the link”."],
  };
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Panel>
      <PanelTitle>Workspace</PanelTitle>
      <div className="flex max-w-xl flex-col gap-4">
        {Object.entries(LABELS).map(([k, [label, hint]]) => <SettingField key={k + q.data[k]} k={k} label={label} hint={hint} initial={q.data[k] ?? ""} onSave={(value) => save.mutate({ key: k, value })} />)}
        {save.isError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : null}
      </div>
    </Panel>
  );
}
function SettingField({ k, label, hint, initial, onSave }: { k: string; label: string; hint: string; initial: string; onSave: (v: string) => void }) {
  const [v, setV] = React.useState(initial);
  return (
    <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <Field label={label} htmlFor={`ws-${k}`} hint={hint} className="flex-1"><Input id={`ws-${k}`} value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Button type="submit" variant="outline" disabled={v === initial} className="mb-6">Save</Button>
    </form>
  );
}

const KIND_TITLES: Record<PlaybookItem["kind"], string> = { opener: "Call opener", objection: "Objection replies (shown live in call mode)", email: "Follow-up emails", whatsapp: "WhatsApp messages" };
function PlaybookTab() {
  const qc = useQueryClient();
  const [lang, setLang] = React.useState<Lang>("FR");
  const q = useQuery({ queryKey: ["playbook"], queryFn: () => api<{ items: PlaybookItem[] }>("/api/playbook") });
  const save = useMutation({ mutationFn: (b: PlaybookItem) => api("/api/playbook", { body: b }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["playbook"] }); toast("Saved"); } });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.items.filter((i) => i.language === lang);
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-text-2">Scripts and templates used live in call mode. Placeholders: <code>{"{business}"}</code> <code>{"{contact}"}</code> <code>{"{founder}"}</code> <code>{"{calendly}"}</code> <code>{"{deck}"}</code>. Links are set in Workspace. Nothing is ever sent without your click.</p>
        <SegmentedSwitch label="Language" value={lang} onChange={setLang} options={[{ value: "FR", label: "Français" }, { value: "ES", label: "Español" }]} />
      </Panel>
      {(["opener", "objection", "email", "whatsapp"] as const).map((kind) => (
        <Panel key={kind}>
          <PanelTitle>{KIND_TITLES[kind]}</PanelTitle>
          <div className="flex flex-col gap-4">
            {items.filter((i) => i.kind === kind).map((i) => <PlaybookEditor key={`${i.kind}:${i.key}:${i.language}:${i.body.length}:${i.subject}`} item={i} busy={save.isPending} onSave={(v) => save.mutate(v)} />)}
          </div>
        </Panel>
      ))}
      {save.isError ? <ErrorState error={save.error} onRetry={() => save.reset()} /> : null}
    </div>
  );
}
function PlaybookEditor({ item, busy, onSave }: { item: PlaybookItem; busy: boolean; onSave: (v: PlaybookItem) => void }) {
  const [subject, setSubject] = React.useState(item.subject);
  const [body, setBody] = React.useState(item.body);
  const def = DEFAULT_PLAYBOOK.find((d) => d.kind === item.kind && d.key === item.key && d.language === item.language);
  const isDefault = def?.body === item.body && def?.subject === item.subject;
  const title = item.kind === "objection" ? objectionLabel(item.key) : item.kind === "email" ? EMAIL_TEMPLATE_LABELS[item.key as keyof typeof EMAIL_TEMPLATE_LABELS] ?? item.key : item.kind === "whatsapp" ? (item.key === "deck" ? "Deck" : "Calendly") : "Opener";
  const id = `pb-${item.kind}-${item.key}-${item.language}`;
  return (
    <form className="flex flex-col gap-2 border-t border-hairline pt-3 first:border-0 first:pt-0" onSubmit={(e) => { e.preventDefault(); onSave({ ...item, subject, body }); }}>
      <p className="text-sm font-medium">{title}{isDefault ? <span className="ml-2 text-[12px] font-normal text-text-3">default</span> : null}</p>
      {item.kind === "email" ? <Input aria-label={`${title} subject`} value={subject} onChange={(e) => setSubject(e.target.value)} /> : null}
      <Textarea id={id} aria-label={`${title} text`} rows={item.kind === "email" ? 7 : 3} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={busy || (body === item.body && subject === item.subject)}>Save</Button>
        {!isDefault ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onSave({ ...item, subject: "", body: "" })}>Back to default</Button> : null}
      </div>
    </form>
  );
}
