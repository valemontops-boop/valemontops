"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, ExternalLink, Mail, Phone, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import {
  ACTIVITY_LABELS, BRAND_LABELS, OFFERS, OFFER_LABELS, type Offer, CONTACT_TYPES, CONTACT_TYPE_LABELS, FOUNDERS, FOUNDER_NAMES, MARKETS, OUTCOME_LABELS, STAGES,
  STAGE_EXIT_CRITERIA, STAGE_LABELS, type Stage,
} from "@/domain/constants";
import { isOpen, leadStatus, nextGroup, PIPELINE_GROUPS, PRE_PIPELINE, stageForGroup, type LeadStatus } from "@/domain/pipeline";
import { addDays } from "@/domain/time";
import { useMe } from "./providers";
import { RecordFiles } from "./files-view";
import { ApiError, api } from "@/lib/api";
import { cn, formatEur, relTime } from "@/lib/utils";
import { ConflictNotice } from "./conflict";
import { useQuickAction } from "./quick-action";
import { useCrm, type Crm, type CrmAccount, type CrmContact, type CrmOpp } from "./use-crm";
import type { T } from "@/i18n";
import { useDateTag, useT } from "@/i18n/react";
import { ExportButton } from "./export-dialog";
import { dealValue } from "@/domain/conversion";
import { WonToProject } from "./won-project";
import { CsvExportButton } from "./csv-tools";

/** Default deal values per offer from Settings › Workspace (Consulting value, Local monthly price), in cents. */
function useOfferDefaults() {
  const q = useQuery({ queryKey: ["system-settings"], queryFn: () => api<Record<string, string>>("/api/settings/system"), staleTime: 60_000 });
  const n = (k: string, d: number) => { const x = Number(q.data?.[k]); return Number.isFinite(x) && q.data?.[k] ? x : d; };
  return { consulting: Math.round(n("offer_consulting_value_eur", 1500) * 100), local: Math.round(n("offer_local_monthly_eur", 100) * 100) };
}


function shortDate(d: string | null, tag: string): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(tag, { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function CrmView() {
  const t = useT();
  const crm = useCrm();
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = React.useState<"pipeline" | "lists" | "contacts">("pipeline");
  const [scope, setScope] = React.useState<"mine" | "all">("all");
  const [search, setSearch] = React.useState("");
  const [showLost, setShowLost] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const selected = params.get("account");
  const select = (id: string | null) => router.replace(id ? `/crm?account=${id}` : "/crm", { scroll: false });

  if (crm.isPending) return <div className="flex flex-col gap-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
  if (crm.isError) return <ErrorState error={crm.error} onRetry={() => crm.refetch()} />;
  const data = crm.data;
  const today = new Date().toLocaleDateString("en-CA");
  const acc = new Map(data.accounts.map((a) => [a.id, a]));
  const s = search.trim().toLowerCase();
  const match = (a?: CrmAccount, name = "") => !s || name.toLowerCase().includes(s) || (a?.name ?? "").toLowerCase().includes(s) || (a?.phone ?? "").replace(/\s/g, "").includes(s.replace(/\s/g, ""));
  const opps = data.opportunities.filter((o) => (scope === "all" || o.owner_founder === me.founder) && match(acc.get(o.account_id), o.name));

  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Sales CRM")}</h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCreating(true)}><Plus /> {t("Add a yes")}</Button>
            <Button asChild variant="primary"><Link href="/call"><Phone /> {t("Start calling")}</Link></Button>
          </div>
        </div>
        <FunnelStrip m={data.month} />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedSwitch label={t("View")} value={tab} onChange={setTab} options={[{ value: "pipeline", label: t("Pipeline") }, { value: "lists", label: t("Call lists") }, { value: "contacts", label: t("All businesses") }]} />
          {tab !== "lists" ? <>
            <Input aria-label={t("Search")} placeholder={t("Search name or phone")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-52" />
            <SegmentedSwitch size="sm" label={t("Whose")} value={scope} onChange={setScope} options={[{ value: "all", label: t("Everyone") }, { value: "mine", label: t("Mine") }]} />
          </> : null}
          <div className="ml-auto flex gap-1">
            <Button asChild variant="ghost" size="sm"><Link href="/crm/import"><Upload /> {t("Import list")}</Link></Button>
            <Button asChild variant="ghost" size="sm"><a href="/api/crm/export"><Download /> {t("Export")}</a></Button>
            {tab === "pipeline" ? <><CsvExportButton list="deals" /><CsvExportButton list="quotes" /></> : tab === "contacts" ? <CsvExportButton list="contacts" /> : null}
            <ExportButton />
          </div>
        </div>
        {tab === "pipeline" ? (
          <Board opps={opps} accounts={acc} today={today} selected={selected} onSelect={select} showLost={showLost} onToggleLost={() => setShowLost((v) => !v)} />
        ) : tab === "lists" ? <CallListsTab /> : (
          <ContactsTab accounts={data.accounts.filter((a) => (scope === "all" || !a.owner_founder || a.owner_founder === me.founder) && match(a))} opps={data.opportunities} selected={selected} onSelect={select} />
        )}
        {data.warnings.length ? <p className="text-[13px] text-text-2">{t("{n} data-integrity warning(s) in the Sheet. See Settings › Diagnostics.", { n: data.warnings.length })}</p> : null}
      </div>
      {selected && acc.get(selected) ? <AccountPanel key={selected} account={acc.get(selected)!} data={data} onClose={() => select(null)} /> : null}
      <NewBusinessModal open={creating} onOpenChange={setCreating} onCreated={(id) => { setCreating(false); select(id); }} />
    </div>
  );
}

/** This month, team: the conversion path from a dial to a won deal, with the rate between each step. */
function FunnelStrip({ m }: { m: Crm["month"] }) {
  const t = useT();
  const steps = [["Dials", m.dials], ["Picked up", m.pickedUp], ["Said yes", m.yes], ["Meetings", m.meetings], ["Won", m.won]] as const;
  const max = Math.max(1, m.dials);
  return (
    <section aria-label={t("This month's funnel")} className="grid grid-cols-5 gap-1.5">
      {steps.map(([label, v], i) => {
        const prev = i > 0 ? steps[i - 1][1] : null;
        const rate = prev ? Math.round((v / prev) * 100) : null;
        const won = i === 4;
        return (
          <div key={label} className={cn("flex flex-col gap-0.5 rounded-[16px] px-3 py-3 sm:px-4", won ? "bg-ink text-panel" : "bg-panel")}>
            <span className={cn("text-[12px] font-medium", won ? "text-panel/85" : "text-text-2")}>{t(label)}</span>
            <span className="num text-[26px] font-semibold leading-none sm:text-[32px]">{v}</span>
            <span className={cn("mt-1 h-1.5 overflow-hidden rounded-full", won ? "bg-panel/25" : "bg-panel")} aria-hidden><span className={cn("block h-full rounded-full", won ? "bg-panel" : i >= 2 ? "bg-win" : "bg-sales")} style={{ width: `${(v / max) * 100}%`, minWidth: v ? 3 : 0 }} /></span>
            <span className={cn("num text-[11px]", won ? "text-panel/80" : "text-text-3")}>{i === 0 ? t("this month") : rate === null ? "—" : t("{rate}% of previous", { rate })}</span>
          </div>
        );
      })}
    </section>
  );
}

function dueLabel(due: string | null, today: string, t: T, tag: string): { text: string; tone: "bad" | "normal" | "muted" } {
  if (!due) return { text: t("No date"), tone: "bad" };
  if (due < today) return { text: t("Late · {date}", { date: shortDate(due, tag) }), tone: "bad" };
  if (due === today) return { text: t("Today"), tone: "normal" };
  return { text: shortDate(due, tag), tone: "muted" };
}
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : null);

function Board({ opps, accounts, today, selected, onSelect, showLost, onToggleLost }: { opps: CrmOpp[]; accounts: Map<string, CrmAccount>; today: string; selected: string | null; onSelect: (id: string) => void; showLost: boolean; onToggleLost: () => void }) {
  const offers = useOfferDefaults();
  const t = useT();
  const qc = useQueryClient();
  const [qualify, setQualify] = React.useState<{ opp: CrmOpp; to: Stage } | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const move = useMutation({
    mutationFn: ({ opp, to }: { opp: CrmOpp; to: Stage }) => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: opp.version, patch: { stage: to } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Moved")); },
    onError: (e, v) => {
      if (e instanceof ApiError && e.body.error === "rule" && /ANUM/.test(e.message)) setQualify(v);
      else toast(e instanceof ApiError && e.isConflict ? t("Someone else just changed this deal. Refreshed.") : (e as Error).message);
      if (e instanceof ApiError && e.isConflict) qc.invalidateQueries();
    },
  });
  const moveTo = (opp: CrmOpp, groupKey: string) => {
    const to = stageForGroup(opp.stage, groupKey);
    if (to !== opp.stage) move.mutate({ opp, to });
  };
  const sorted = [...opps].sort((a, b) => (a.next_action_due ?? "0000").localeCompare(b.next_action_due ?? "0000"));
  const columns = PIPELINE_GROUPS.map((g) => ({ ...g, items: sorted.filter((o) => g.stages.includes(o.stage)) }));
  const lost = sorted.filter((o) => o.stage === "lost");
  const notYet = sorted.filter((o) => PRE_PIPELINE.includes(o.stage)).length;
  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1000px] grid-cols-5 gap-3">
          {columns.map((c) => {
            const value = c.items.reduce((s, o) => s + dealValue(o, offers), 0);
            return (
              <section key={c.key} aria-label={t(c.label)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(c.key); }} onDragLeave={() => setDragOver((k) => (k === c.key ? null : k))}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); const o = opps.find((x) => x.id === id); if (o) moveTo(o, c.key); }}
                className={cn("flex min-h-48 flex-col gap-2 rounded-[20px] bg-subtle/60 p-2 transition-colors", dragOver === c.key && "bg-subtle", c.key === "won" && "bg-ink/[0.06]")}>
                <header className="px-2 pt-1">
                  <h2 className="flex items-baseline justify-between text-[13px] font-semibold">{t(c.label)}<span className="num text-[20px] font-semibold">{c.items.length}</span></h2>
                  <p className="num text-[11px] text-text-3">{value ? formatEur(value) : t("no value yet")}</p>
                </header>
                {c.items.map((o) => <DealCard key={o.id} opp={o} account={accounts.get(o.account_id)} today={today} active={selected === o.account_id} onOpen={() => onSelect(o.account_id)}
                  onAdvance={nextGroup(o.stage) ? () => moveTo(o, nextGroup(o.stage)!) : undefined} busy={move.isPending && move.variables?.opp.id === o.id} />)}
                {c.items.length === 0 ? <p className="px-2 py-3 text-[12px] text-text-3">{c.key === "talk" ? t("Yes from calls land here.") : t("Drag a card here.")}</p> : null}
              </section>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[13px] text-text-2">
        <button type="button" onClick={onToggleLost} className="underline underline-offset-2">{showLost ? t("Hide lost ({n})", { n: lost.length }) : t("Show lost ({n})", { n: lost.length })}</button>
        {notYet ? <span>{t("{n} older lead(s) not yet qualified: see All businesses.", { n: notYet })}</span> : null}
      </div>
      {showLost && lost.length ? (
        <ul className="flex flex-wrap gap-2">{lost.map((o) => <li key={o.id}><button type="button" onClick={() => onSelect(o.account_id)} className="rounded-full border border-hairline px-3 py-1 text-[13px] text-text-2 hover:bg-subtle">{accounts.get(o.account_id)?.name ?? o.name}{o.lost_reason ? ` · ${o.lost_reason}` : ""}</button></li>)}</ul>
      ) : null}
      {qualify ? <QualifyModal opp={qualify.opp} to={qualify.to} onClose={() => setQualify(null)} /> : null}
    </>
  );
}

function DealCard({ opp, account, today, active, onOpen, onAdvance, busy }: { opp: CrmOpp; account?: CrmAccount; today: string; active: boolean; onOpen: () => void; onAdvance?: () => void; busy: boolean }) {
  const offers = useOfferDefaults();
  const t = useT();
  const tag = useDateTag();
  const qa = useQuickAction();
  const due = dueLabel(opp.next_action_due, today, t, tag);
  const idle = daysSince(opp.last_touch_at);
  const inStage = daysSince(opp.stage_since);
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", opp.id)}
      className={cn("flex cursor-grab flex-col gap-2 rounded-[12px] border bg-panel p-3 active:cursor-grabbing", active ? "border-ink" : "border-hairline hover:border-control", busy && "opacity-60", due.tone === "bad" && "border-l-0 shadow-[inset_3px_0_0_var(--bad)]")}>
      <button type="button" onClick={onOpen} className="text-left">
        <p className="font-semibold leading-snug">{account?.name ?? opp.name}</p>
        <p className={cn("mt-0.5 text-[13px] leading-snug", opp.next_action ? "text-text-2" : "text-bad")}>{opp.next_action || t("Add a next step")}</p>
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn("num rounded-full px-2 py-0.5 font-medium", due.tone === "bad" ? "bg-[#fbeceb] text-bad" : due.tone === "normal" ? "bg-ink text-panel" : "bg-subtle text-text-2")}>{due.text}</span>
        {inStage !== null ? <span className="num text-text-3">{t("{n}d here", { n: inStage })}</span> : null}
        {idle !== null && idle >= 7 ? <span className="num text-text-3">· {t("no touch {n}d", { n: idle })}</span> : null}
        <span className="ml-auto text-text-3">{opp.owner_founder ? FOUNDER_NAMES[opp.owner_founder] : "—"}{dealValue(opp, offers) ? ` · ${formatEur(dealValue(opp, offers))}${opp.brand === "local" ? t("/month") : ""}` : ""}</span>
      </div>
      <div className="flex gap-1.5">
        {account?.phone ? <a href={`tel:${account.phone}`} aria-label={t("Call {name}", { name: account.name })} className="flex h-8 w-9 items-center justify-center rounded-full border border-control hover:bg-subtle"><Phone className="size-3.5" /></a> : null}
        <button type="button" disabled={Boolean(account?.blocked_reason)} onClick={() => qa.open({ accountId: opp.account_id, opportunityId: opp.id })}
          className="h-8 flex-1 rounded-full border border-control text-[13px] font-medium hover:bg-subtle disabled:opacity-40" title={account?.blocked_reason ? t(account.blocked_reason) : undefined}>{t("Log")}</button>
        {onAdvance ? <button type="button" onClick={onAdvance} aria-label={t("Move {name} to the next column", { name: account?.name ?? opp.name })} className="h-8 rounded-full border border-control px-3 text-[13px] font-medium hover:bg-subtle">→</button> : null}
      </div>
    </article>
  );
}

const ANUM_LABELS = { anum_authority: "Who decides?", anum_need: "What do they need?", anum_urgency: "Why now?", anum_money: "Budget" } as const;

function QualifyModal({ opp, to, onClose }: { opp: CrmOpp; to: Stage; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState({ anum_authority: opp.anum_authority, anum_need: opp.anum_need, anum_urgency: opp.anum_urgency, anum_money: opp.anum_money });
  const m = useMutation({
    mutationFn: () => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: opp.version, patch: { ...v, stage: to } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Moved")); onClose(); },
  });
  const labels = ANUM_LABELS;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("What did you learn at the meeting?")} description={t("Four short notes, so the deal is real.")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
          <Field key={k} label={t(labels[k])} htmlFor={`q-${k}`}><Input id={`q-${k}`} required value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
        ))}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save and move to {stage}", { stage: t(STAGE_LABELS[to]) })}</Button>
      </form>
    </Modal>
  );
}

type ListRow = { list: { id: string; name: string; niche: string; market: string | null; source: string }; total: number; called: number; reached: number; positive: number; meetings: number; remaining: number };
function CallListsTab() {
  const t = useT();
  const q = useQuery({ queryKey: ["call-lists"], queryFn: () => api<ListRow[]>("/api/call-lists") });
  if (q.isPending) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState title={t("No call list yet")} action={<Button asChild size="sm" variant="primary"><Link href="/crm/import">{t("Import a list")}</Link></Button>}>{t("Import the businesses you want to call. Each import becomes a list with its own progress.")}</EmptyState>;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {q.data.map((l) => {
        const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
        return (
          <Panel key={l.list.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate font-semibold">{l.list.name}</p><p className="text-[12px] text-text-3">{[l.list.market, l.list.niche, l.list.source].filter(Boolean).join(" · ")}</p></div>
              <Button asChild size="sm" variant={l.remaining ? "primary" : "outline"}><Link href="/call">{l.remaining ? t("Call") : t("Done")}</Link></Button>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-subtle" role="img" aria-label={t("{called} of {total} called", { called: l.called, total: l.total })}>
              <div className="bg-ink" style={{ width: `${pct(l.meetings, l.total)}%` }} />
              <div className="bg-ink/60" style={{ width: `${pct(l.positive - l.meetings, l.total)}%` }} />
              <div className="bg-control" style={{ width: `${pct(l.called - l.positive, l.total)}%` }} />
            </div>
            <dl className="grid grid-cols-5 text-center">
              {[["Total", l.total], ["Called", l.called], ["Reached", l.reached], ["Yes", l.positive], ["Meetings", l.meetings]].map(([k, v]) => <div key={String(k)}><dd className="num text-lg font-semibold">{v}</dd><dt className="text-[11px] text-text-3">{t(String(k))}</dt></div>)}
            </dl>
          </Panel>
        );
      })}
    </div>
  );
}

const CONSENT_LABEL: Record<string, string> = { unknown: "consent unknown", consented: "consented", opted_out: "opted out" };
const lowerFirst = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
const STATUS_LABEL: Record<LeadStatus, string> = { not_called: "Not called", no_answer: "No answer", refused: "Refused", yes: "In pipeline", won: "Won", lost: "Lost", opted_out: "Opted out" };
function ContactsTab({ accounts, opps, selected, onSelect }: { accounts: CrmAccount[]; opps: CrmOpp[]; selected: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  const [filter, setFilter] = React.useState<LeadStatus | "all">("all");
  const rows = accounts.map((a) => {
    const o = opps.find((x) => x.account_id === a.id && x.stage !== "lost") ?? opps.find((x) => x.account_id === a.id) ?? null;
    return { a, status: leadStatus({ blocked: Boolean(a.blocked_reason), stage: o?.stage ?? null, lastOutcome: a.last_call_outcome, called: a.called }) };
  });
  const counts = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>);
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {(["all", "not_called", "no_answer", "refused", "yes", "won", "opted_out"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={cn("h-8 rounded-full border px-3 text-[13px]", filter === k ? "border-ink bg-ink text-panel" : "border-hairline text-text-2 hover:bg-subtle")}>
            {k === "all" ? t("All") : t(STATUS_LABEL[k])} <span className="num opacity-70">{k === "all" ? rows.length : counts[k] ?? 0}</span>
          </button>
        ))}
      </div>
      <Panel className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3"><th className="px-5 py-2.5 font-medium">{t("Business")}</th><th className="pr-4 font-medium">{t("Phone")}</th><th className="pr-4 font-medium">{t("Status")}</th><th className="pr-5 font-medium">{t("Last touch")}</th></tr></thead>
          <tbody>
            {shown.slice(0, 300).map(({ a, status }) => (
              <tr key={a.id} onClick={() => onSelect(a.id)} className={cn("cursor-pointer border-b border-hairline last:border-0 hover:bg-subtle", selected === a.id && "bg-subtle")}>
                <td className="px-5 py-2.5"><button type="button" className="text-left font-medium" onClick={(e) => { e.stopPropagation(); onSelect(a.id); }}>{a.name}</button></td>
                <td className="num whitespace-nowrap pr-4">{a.phone || "—"}</td>
                <td className="pr-4"><span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", status === "yes" || status === "won" ? "bg-ink text-panel" : status === "refused" || status === "opted_out" ? "bg-[#fbeceb] text-bad" : "bg-subtle text-text-2")}>{t(STATUS_LABEL[status])}</span></td>
                <td className="pr-5 text-text-2">{t(relTime(a.last_activity_at))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 300 ? <p className="px-5 py-2 text-[12px] text-text-3">{t("Showing 300 of {n}. Use search.", { n: shown.length })}</p> : null}
      </Panel>
    </>
  );
}

function AccountPanel({ account, data, onClose }: { account: CrmAccount; data: Crm; onClose: () => void }) {
  const t = useT();
  const tag = useDateTag();
  const qa = useQuickAction();
  const contacts = data.contacts.filter((c) => c.account_id === account.id);
  const opps = data.opportunities.filter((o) => o.account_id === account.id);
  const main = opps.find(isOpen) ?? opps[0];
  const timeline = useQuery({ queryKey: ["timeline", account.id], queryFn: () => api<{ events: { id: string; activity_type: keyof typeof ACTIVITY_LABELS; founder_key: string; local_date: string; outcome: string | null; notes: string; late_logged: boolean }[] }>(`/api/crm/timeline?account_id=${account.id}`) });
  const [more, setMore] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  return (
    <DetailPanel open onClose={onClose}
      title={<div><h2 className="truncate text-lg font-semibold">{account.name}</h2><p className="text-[13px] text-text-2">{[main ? t(STAGE_LABELS[main.stage]) : null, account.country, account.niche].filter(Boolean).join(" · ")}</p></div>}
      footer={<div className="flex gap-2"><Button variant="primary" className="flex-1" disabled={Boolean(account.blocked_reason)} onClick={() => qa.open({ accountId: account.id, opportunityId: main?.id })}>{t("Log activity")}</Button>{account.phone ? <Button asChild variant="outline"><a href={`tel:${account.phone}`} aria-label={t("Call {name}", { name: account.phone })}><Phone /> {account.phone}</a></Button> : null}</div>}>
      <div className="flex flex-col gap-6">
        {account.blocked_reason ? <p className="flex items-center gap-2 rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad"><Ban className="size-4" />{t(account.blocked_reason)}</p> : null}
        {main ? <NextStepEditor key={main.id + main.version} opp={main} /> : <NewOpportunityForm account={account} />}
        {main ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link href={`/crm/deal?opp=${main.id}`}>{t("Start the audit")}</Link></Button>
            <Button asChild size="sm" variant="ghost"><Link href={`/crm/deal?opp=${main.id}&tab=quote`}>{t("Quote")}</Link></Button>
          </div>
        ) : null}
        {opps.filter((o) => o.stage === "won" && !o.is_archived).map((o) => <WonToProject key={o.id} opportunityId={o.id} name={o.name} />)}

        <a className="self-start text-sm underline underline-offset-2" target="_blank" rel="noreferrer noopener"
          href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(t("Meeting · {name}", { name: account.name }))}&details=${encodeURIComponent(t("Valemont meeting. Add the guests and send the invitation yourself."))}`}>
          {t("Add a meeting to Google Calendar")}
        </a>
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("People")}</h3>
          {contacts.length === 0 ? <p className="text-sm text-text-2">{t("No contact person yet.")}</p> : <ul className="flex flex-col gap-2">{contacts.map((c) => <ContactRow key={c.id} contact={c} />)}</ul>}
          <AddContactForm accountId={account.id} />
        </section>

        <RecordFiles recordType="account" recordId={account.id} />
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("History")}</h3>
          {timeline.isPending ? <Skeleton className="h-20" /> : timeline.isError ? <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} /> : timeline.data.events.length === 0 ? <p className="text-sm text-text-2">{t("Nothing logged yet.")}</p> : (
            <ul className="flex flex-col">
              {timeline.data.events.slice(0, 20).map((e) => (
                <li key={e.id} className="border-t border-hairline py-2 text-sm first:border-t-0">
                  <div className="flex justify-between gap-2"><span className="font-medium">{t(ACTIVITY_LABELS[e.activity_type])}{e.outcome ? ` · ${t(OUTCOME_LABELS[e.outcome as keyof typeof OUTCOME_LABELS] ?? e.outcome)}` : ""}</span><span className="num text-[12px] text-text-3">{shortDate(e.local_date, tag)}{e.late_logged ? ` · ${t("late")}` : ""}</span></div>
                  <p className="text-[13px] text-text-2">{FOUNDER_NAMES[e.founder_key as "theo"] ?? e.founder_key}{e.notes ? ` · ${e.notes}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="text-sm font-semibold underline underline-offset-2">{more ? t("Hide details") : t("More details")}</button>
          {more ? (
            <div className="mt-3 flex flex-col gap-5">
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{t("Business")}</h3><Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>{editing ? t("Close") : t("Edit")}</Button></div>
                {editing ? <AccountEditForm account={account} onSaved={() => setEditing(false)} /> : (
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-text-3">{t("Email")}</dt><dd className="truncate">{account.email || "—"}</dd>
                    <dt className="text-text-3">{t("Website")}</dt><dd className="truncate">{account.website ? <a className="underline" href={account.website.startsWith("http") ? account.website : `https://${account.website}`} target="_blank" rel="noreferrer noopener">{account.domain_normalized || account.website}</a> : "—"}</dd>
                    <dt className="text-text-3">{t("Owner")}</dt><dd>{account.owner_founder ? FOUNDER_NAMES[account.owner_founder] : t("Unassigned")}</dd>
                    <dt className="text-text-3">{t("Problem seen")}</dt><dd>{account.observed_problem || "—"}</dd>
                    <dt className="text-text-3">{t("Source")}</dt><dd>{account.lead_source || "—"}</dd>
                  </dl>
                )}
              </div>
              {opps.map((o) => <div key={o.id}><h3 className="mb-2 text-sm font-semibold">{t("Deal details")}</h3><OpportunityEditor key={o.id + o.version} opp={o} /></div>)}
            </div>
          ) : null}
        </section>
      </div>
    </DetailPanel>
  );
}

/** The one thing that matters on a deal: what happens next, and when (D018). */
function NextStepEditor({ opp }: { opp: CrmOpp }) {
  const t = useT();
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString("en-CA");
  const [text, setText] = React.useState(opp.next_action);
  const [due, setDue] = React.useState(opp.next_action_due ?? "");
  const [version, setVersion] = React.useState(opp.version);
  const dirty = text !== opp.next_action || due !== (opp.next_action_due ?? "");
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: expected, patch: { next_action: text, next_action_due: due } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const chips: [string, number][] = [["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]];
  return (
    <section className={cn("rounded-[12px] border p-3", !opp.next_action || !opp.next_action_due ? "border-bad/50" : "border-hairline")}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
        <label htmlFor={`ns-${opp.id}`} className="text-sm font-semibold">{t("Next step")}</label>
        <Input id={`ns-${opp.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("e.g. Call back Tuesday after 5pm")} />
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map(([l, d]) => {
            const v = addDays(today, d);
            return <button key={l} type="button" aria-pressed={due === v} onClick={() => setDue(v)} className={cn("h-8 rounded-full border px-3 text-[13px]", due === v ? "border-ink bg-ink text-panel" : "border-hairline text-text-2 hover:bg-subtle")}>{t(l)}</button>;
          })}
          <Input aria-label={t("Due date")} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-40 text-[13px]" />
        </div>
        {err?.isConflict ? (
          <ConflictNotice mine={{ next_action: text, next_action_due: due }} current={err.body.current} fields={["next_action", "next_action_due"]} onKeepTheirs={() => qc.invalidateQueries()} onApplyMine={() => { const cv = Number(err.body.current?.version); setVersion(cv); m.mutate(cv); }} />
        ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(version)} /> : null}
        {dirty ? <Button type="submit" size="sm" variant="primary" className="self-start" disabled={m.isPending || !text.trim() || !due}>{m.isPending ? t("Saving…") : t("Save next step")}</Button> : null}
      </form>
    </section>
  );
}

const ACCOUNT_FIELDS = ["name", "sector", "niche", "city", "phone", "email", "website", "linkedin_url", "observed_problem", "problem_evidence", "notes"] as const;

function AccountEditForm({ account, onSaved }: { account: CrmAccount; onSaved: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState(() => ({ ...Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f, account[f] ?? ""])), country: account.country ?? "", owner_founder: account.owner_founder ?? "" }) as Record<string, string>);
  const [version, setVersion] = React.useState(account.version);
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/crm/accounts", { method: "PATCH", body: { id: account.id, expected_version: expected, patch: { ...v, country: v.country || null, owner_founder: v.owner_founder || null } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); onSaved(); },
  });
  const conflict = m.error instanceof ApiError && m.error.isConflict ? m.error.body.current : null;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
      {(["name", "phone", "email", "website", "sector", "niche", "city"] as const).map((f) => (
        <Field key={f} label={t(f[0].toUpperCase() + f.slice(1))} htmlFor={`acc-${f}`}><Input id={`acc-${f}`} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} type={f === "phone" ? "tel" : "text"} /></Field>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Country")} htmlFor="acc-country"><Select id="acc-country" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })}><option value="">—</option>{MARKETS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label={t("Owner")} htmlFor="acc-owner"><Select id="acc-owner" value={v.owner_founder} onChange={(e) => setV({ ...v, owner_founder: e.target.value })}><option value="">{t("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
      </div>
      <Field label={t("Observed problem")} htmlFor="acc-prob" hint={t("What you actually saw or heard. Never an invented diagnosis.")}><Textarea id="acc-prob" value={v.observed_problem} onChange={(e) => setV({ ...v, observed_problem: e.target.value })} /></Field>
      <Field label={t("Evidence")} htmlFor="acc-ev"><Input id="acc-ev" value={v.problem_evidence} onChange={(e) => setV({ ...v, problem_evidence: e.target.value })} /></Field>
      <Field label={t("Notes")} htmlFor="acc-notes"><Textarea id="acc-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {conflict ? (
        <ConflictNotice mine={v} current={conflict} fields={[...ACCOUNT_FIELDS]} onKeepTheirs={() => { qc.invalidateQueries(); onSaved(); }} onApplyMine={() => { const cv = Number(conflict.version); setVersion(cv); m.mutate(cv); }} />
      ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(version)} /> : null}
      <Button type="submit" variant="dark" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
    </form>
  );
}

function OpportunityEditor({ opp }: { opp: CrmOpp }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = React.useState({
    stage: opp.stage, brand: opp.brand, value_eur: opp.value_minor === null ? "" : String(opp.value_minor / 100), next_action: opp.next_action, next_action_due: opp.next_action_due ?? "",
    next_action_priority: opp.next_action_priority ?? "normal", owner_founder: opp.owner_founder ?? "", lost_reason: opp.lost_reason,
    anum_authority: opp.anum_authority, anum_need: opp.anum_need, anum_urgency: opp.anum_urgency, anum_money: opp.anum_money,
  });
  const [version, setVersion] = React.useState(opp.version);
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: expected, patch: { ...v, value_eur: v.value_eur === "" ? null : Number(v.value_eur), owner_founder: v.owner_founder || null } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const needsAnum = ["qualified", "demo_shown", "proposal_sent", "negotiation", "won"].includes(v.stage);
  return (
    <form className="mb-3 flex flex-col gap-3 rounded-[12px] border border-hairline p-3" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
      <div className="flex items-baseline justify-between gap-2"><p className="font-medium">{opp.name}</p>{opp.brand === "thirty" ? <span className="text-[12px] text-text-3">{t(BRAND_LABELS[opp.brand])}</span> : null}</div>
      {opp.brand !== "thirty" ? (
        <Field label={t("Offer")} htmlFor={`of-${opp.id}`} hint={v.brand === "local" ? t("Last resort, for a business with really no budget.") : undefined}>
          <Select id={`of-${opp.id}`} value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value as typeof v.brand })}>{OFFERS.map((o) => <option key={o} value={o}>{t(OFFER_LABELS[o])}</option>)}</Select>
        </Field>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Stage")} htmlFor={`st-${opp.id}`} hint={t("To move on: {criteria}", { criteria: lowerFirst(t(STAGE_EXIT_CRITERIA[v.stage as Stage])) })}>
          <Select id={`st-${opp.id}`} value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value as Stage })}>{STAGES.map((s) => <option key={s} value={s}>{t(STAGE_LABELS[s])}</option>)}</Select>
        </Field>
        <Field label={t("Value (EUR, ex VAT)")} htmlFor={`val-${opp.id}`}><Input id={`val-${opp.id}`} inputMode="decimal" className="num" value={v.value_eur} onChange={(e) => setV({ ...v, value_eur: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
      </div>
      <Field label={t("Next action")} htmlFor={`na-${opp.id}`}><Input id={`na-${opp.id}`} value={v.next_action} onChange={(e) => setV({ ...v, next_action: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Due")} htmlFor={`due-${opp.id}`}><Input id={`due-${opp.id}`} type="date" value={v.next_action_due} onChange={(e) => setV({ ...v, next_action_due: e.target.value })} /></Field>
        <Field label={t("Priority")} htmlFor={`pr-${opp.id}`}><Select id={`pr-${opp.id}`} value={v.next_action_priority} onChange={(e) => setV({ ...v, next_action_priority: e.target.value as "high" | "normal" })}><option value="normal">{t("Normal")}</option><option value="high">{t("High")}</option></Select></Field>
      </div>
      {needsAnum ? (
        <fieldset className="grid grid-cols-1 gap-2">
          <legend className="mb-1 text-[13px] font-medium text-text-2">{t("Qualification (ANUM, required)")}</legend>
          {(["anum_authority", "anum_need", "anum_urgency", "anum_money"] as const).map((k) => (
            <Input key={k} aria-label={t(ANUM_LABELS[k])} placeholder={t(ANUM_LABELS[k])} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          ))}
        </fieldset>
      ) : null}
      {v.stage === "lost" ? <Field label={t("Lost reason")} htmlFor={`lr-${opp.id}`}><Input id={`lr-${opp.id}`} value={v.lost_reason} onChange={(e) => setV({ ...v, lost_reason: e.target.value })} /></Field> : null}
      {err?.isConflict ? (
        <ConflictNotice mine={v} current={err.body.current} fields={["stage", "next_action", "next_action_due", "lost_reason"]} onKeepTheirs={() => qc.invalidateQueries()} onApplyMine={() => { const cv = Number(err.body.current?.version); setVersion(cv); m.mutate(cv); }} />
      ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(version)} /> : null}
      <Button type="submit" variant="outline" size="sm" className="self-start" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save opportunity")}</Button>
    </form>
  );
}

function NewOpportunityForm({ account }: { account: CrmAccount }) {
  const t = useT();
  const qc = useQueryClient();
  const [id] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: () => api("/api/crm/opportunities", { body: { id, account_id: account.id, opportunity: { name: account.name, brand: account.brand === "thirty" ? "thirty" : "consulting", owner_founder: account.owner_founder } } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); },
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-2">{t("No opportunity yet.")}</p>
      <Button size="sm" variant="outline" className="self-start" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Create opportunity")}</Button>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </div>
  );
}

function ContactRow({ contact }: { contact: CrmContact }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState(false);
  const m = useMutation({ mutationFn: () => api("/api/crm/opt-out", { body: { contact_id: contact.id } }), onSuccess: () => { qc.invalidateQueries(); setConfirm(false); toast(t("Opted out. Outreach is now blocked for both founders.")); } });
  return (
    <li className="rounded-[12px] border border-hairline p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{contact.full_name || t("Unnamed contact")}{contact.role ? <span className="font-normal text-text-2"> · {contact.role}</span> : null}</p>
          <p className="text-[12px] text-text-3">{t(CONTACT_TYPE_LABELS[contact.contact_type])} · {t(CONSENT_LABEL[contact.consent_status] ?? contact.consent_status)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {contact.phone ? <a className="flex size-9 items-center justify-center rounded-full hover:bg-subtle" href={`tel:${contact.phone}`} aria-label={t("Call {name}", { name: contact.full_name })}><Phone className="size-4" /></a> : null}
          {contact.email ? <a className="flex size-9 items-center justify-center rounded-full hover:bg-subtle" href={`mailto:${contact.email}`} aria-label={t("Email {name}", { name: contact.full_name })}><Mail className="size-4" /></a> : null}
          {contact.linkedin_url ? <a className="flex size-9 items-center justify-center rounded-full hover:bg-subtle" href={contact.linkedin_url} target="_blank" rel="noreferrer noopener" aria-label={t("Open LinkedIn")}><ExternalLink className="size-4" /></a> : null}
        </div>
      </div>
      {contact.blocked_reason ? <p className="mt-2 flex items-center gap-1.5 text-[13px] text-bad"><Ban className="size-3.5" />{t(contact.blocked_reason)}</p> : confirm ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px]">{t("Opt out permanently? Both founders will be blocked from contacting them.")}</span>
          <Button size="sm" variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Confirm opt-out")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t("Cancel")}</Button>
        </div>
      ) : <button type="button" className="mt-2 text-[13px] text-text-2 underline" onClick={() => setConfirm(true)}>{t("Mark opted out")}</button>}
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </li>
  );
}

function AddContactForm({ accountId }: { accountId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ full_name: "", role: "", phone: "", email: "", contact_type: "professional_named" });
  const m = useMutation({
    mutationFn: () => api("/api/crm/contacts", { body: { id, account_id: accountId, contact: v } }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); setOpen(false); setId(crypto.randomUUID()); setV({ full_name: "", role: "", phone: "", email: "", contact_type: "professional_named" }); },
  });
  if (!open) return <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(true)}><Plus /> {t("Add contact")}</Button>;
  return (
    <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Input aria-label={t("Name")} placeholder={t("Name")} value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
      <Input aria-label={t("Role")} placeholder={t("Role")} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} />
      <Input aria-label={t("Phone")} placeholder={t("Phone")} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <Input aria-label={t("Email")} placeholder={t("Email")} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <Select aria-label={t("Contact type")} value={v.contact_type} onChange={(e) => setV({ ...v, contact_type: e.target.value })}>{CONTACT_TYPES.map((c) => <option key={c} value={c}>{t(CONTACT_TYPE_LABELS[c])}</option>)}</Select>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      <div className="flex gap-2"><Button size="sm" type="submit" variant="dark" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save contact")}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>{t("Cancel")}</Button></div>
    </form>
  );
}

function NewBusinessModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const blank = { name: "", country: "FR" as "FR" | "ES", phone: "", next_action: t("Call back"), due: "", meeting: false, email: "", website: "", niche: "", contact_name: "", brand: "consulting" as Offer, owner_founder: me.founder as string };
  const [v, setV] = React.useState(blank);
  const [more, setMore] = React.useState(false);
  const today = new Date().toLocaleDateString("en-CA");
  const m = useMutation({
    mutationFn: () => api("/api/crm/accounts", {
      body: {
        id,
        account: { name: v.name, country: v.country, niche: v.niche, phone: v.phone, email: v.email, website: v.website, brand: "consulting", owner_founder: v.owner_founder || null, lead_type: "outbound", lead_status: "new" },
        contact: v.contact_name || v.email ? { full_name: v.contact_name, phone: v.phone, email: v.email } : null,
        opportunity: { name: v.name, brand: v.brand, stage: v.meeting ? "discovery_scheduled" : "replied", owner_founder: v.owner_founder || null, next_action: v.next_action, next_action_due: v.next_action ? (v.due || today) : "" },
      },
    }),
    onSuccess: () => { qc.invalidateQueries(); toast(t("Saved")); const created = id; setId(crypto.randomUUID()); setV(blank); setMore(false); onCreated(created); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("Add someone who said yes")} description={t("Only people who want to talk again or booked a meeting go in the pipeline.")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.name.trim()) m.mutate(); }}>
        <Field label={t("Business name")} htmlFor="nb-name"><Input id="nb-name" required autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label={t("Phone")} htmlFor="nb-phone"><Input id="nb-phone" type="tel" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <SegmentedSwitch label={t("Country")} value={v.country} onChange={(c) => setV({ ...v, country: c })} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
        </div>
        <SegmentedSwitch label={t("What they said")} value={v.meeting ? "meeting" : "talk"} onChange={(x) => setV({ ...v, meeting: x === "meeting", next_action: x === "meeting" ? t("Meeting") : t("Call back") })} options={[{ value: "talk", label: t("Talk again") }, { value: "meeting", label: t("Meeting booked") }]} />
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={t("Next step")} htmlFor="nb-next"><Input id="nb-next" value={v.next_action} onChange={(e) => setV({ ...v, next_action: e.target.value })} /></Field>
          <Field label={t("When")} htmlFor="nb-due"><Input id="nb-due" type="date" value={v.due || today} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field>
        </div>
        <button type="button" onClick={() => setMore((x) => !x)} aria-expanded={more} className="self-start text-sm text-text-2 underline underline-offset-2">{more ? t("Fewer fields") : t("More fields")}</button>
        {more ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Contact name")} htmlFor="nb-contact"><Input id="nb-contact" value={v.contact_name} onChange={(e) => setV({ ...v, contact_name: e.target.value })} /></Field>
            <Field label={t("Email")} htmlFor="nb-email"><Input id="nb-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label={t("Website")} htmlFor="nb-web"><Input id="nb-web" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></Field>
            <Field label={t("Trade / niche")} htmlFor="nb-niche"><Input id="nb-niche" value={v.niche} onChange={(e) => setV({ ...v, niche: e.target.value })} placeholder={t("e.g. Plumbers")} /></Field>
            <Field label={t("Offer")} htmlFor="nb-offer"><Select id="nb-offer" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value as Offer })}>{OFFERS.map((o) => <option key={o} value={o}>{t(OFFER_LABELS[o])}</option>)}</Select></Field>
            <Field label={t("Owner")} htmlFor="nb-owner"><Select id="nb-owner" value={v.owner_founder} onChange={(e) => setV({ ...v, owner_founder: e.target.value })}><option value="">{t("Unassigned")}</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
          </div>
        ) : null}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" size="lg" disabled={m.isPending || !v.name.trim()}>{m.isPending ? t("Saving…") : t("Save business")}</Button>
      </form>
    </Modal>
  );
}
