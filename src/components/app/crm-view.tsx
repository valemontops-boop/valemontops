"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, ExternalLink, Mail, Phone, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { DetailPanel, Modal } from "@/components/ui/overlay";
import {
  ACTIVITY_LABELS, BRANDS, BRAND_LABELS, CONTACT_TYPES, CONTACT_TYPE_LABELS, FOUNDERS, FOUNDER_NAMES, MARKETS, OUTCOME_LABELS, STAGES,
  STAGE_EXIT_CRITERIA, STAGE_LABELS, type Stage,
} from "@/domain/constants";
import { hygieneFlags, isOpen, nextGroup, PIPELINE_GROUPS, stageForGroup } from "@/domain/pipeline";
import { addDays } from "@/domain/time";
import { useMe } from "./providers";
import { RecordFiles } from "./files-view";
import { ApiError, api } from "@/lib/api";
import { cn, formatEur, relTime } from "@/lib/utils";
import { ConflictNotice } from "./conflict";
import { useQuickAction } from "./quick-action";
import { useCrm, type Crm, type CrmAccount, type CrmContact, type CrmOpp } from "./use-crm";


function shortDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function CrmView() {
  const crm = useCrm();
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = React.useState<"board" | "list">("board");
  const [scope, setScope] = React.useState<"mine" | "all">("all");
  const [search, setSearch] = React.useState("");
  const [showLost, setShowLost] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const selected = params.get("account");
  const select = (id: string | null) => router.replace(id ? `/crm?account=${id}` : "/crm", { scroll: false });

  if (crm.isPending) return <div className="flex flex-col gap-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  if (crm.isError) return <ErrorState error={crm.error} onRetry={() => crm.refetch()} />;
  const data = crm.data;
  const today = new Date().toLocaleDateString("en-CA");
  const acc = new Map(data.accounts.map((a) => [a.id, a]));
  const s = search.trim().toLowerCase();
  const opps = data.opportunities.filter((o) =>
    (scope === "all" || o.owner_founder === me.founder) &&
    (!s || o.name.toLowerCase().includes(s) || (acc.get(o.account_id)?.name ?? "").toLowerCase().includes(s) || (acc.get(o.account_id)?.phone ?? "").includes(s)));
  const open = data.opportunities.filter(isOpen);
  const missing = open.filter((o) => hygieneFlags(o, today).length > 0).length;

  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sales CRM</h1>
            <p className="text-sm text-text-2">
              <span className="num">{open.length}</span> open deals
              {missing ? <> · <span className="text-bad"><span className="num">{missing}</span> need a dated next step</span></> : " · every deal has a next step"}
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New business</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Search" placeholder="Search business or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" />
          <SegmentedSwitch size="sm" label="Whose deals" value={scope} onChange={setScope} options={[{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }]} />
          <SegmentedSwitch size="sm" label="View" value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />
          <div className="ml-auto flex gap-1">
            <Button asChild variant="ghost" size="sm"><Link href="/crm/import"><Upload /> Import</Link></Button>
            <Button asChild variant="ghost" size="sm"><a href="/api/crm/export"><Download /> Export</a></Button>
          </div>
        </div>

        {view === "board" ? (
          <Board opps={opps} accounts={acc} today={today} selected={selected} onSelect={select} showLost={showLost} onToggleLost={() => setShowLost((v) => !v)} />
        ) : (
          <ListView data={data} opps={opps} acc={acc} today={today} selected={selected} onSelect={select} />
        )}
        {data.warnings.length ? <p className="text-[13px] text-text-2">{data.warnings.length} data-integrity warning(s) in the Sheet. See Settings › Diagnostics.</p> : null}
      </div>

      {selected && acc.get(selected) ? <AccountPanel key={selected} account={acc.get(selected)!} data={data} onClose={() => select(null)} /> : null}
      <NewBusinessModal open={creating} onOpenChange={setCreating} onCreated={(id) => { setCreating(false); select(id); }} />
    </div>
  );
}

function dueLabel(due: string | null, today: string): { text: string; tone: "bad" | "normal" | "muted" } {
  if (!due) return { text: "No date", tone: "bad" };
  if (due < today) return { text: `Overdue · ${shortDate(due)}`, tone: "bad" };
  if (due === today) return { text: "Today", tone: "normal" };
  return { text: shortDate(due), tone: "muted" };
}

function Board({ opps, accounts, today, selected, onSelect, showLost, onToggleLost }: { opps: CrmOpp[]; accounts: Map<string, CrmAccount>; today: string; selected: string | null; onSelect: (id: string) => void; showLost: boolean; onToggleLost: () => void }) {
  const qc = useQueryClient();
  const [qualify, setQualify] = React.useState<{ opp: CrmOpp; to: Stage } | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const move = useMutation({
    mutationFn: ({ opp, to }: { opp: CrmOpp; to: Stage }) => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: opp.version, patch: { stage: to } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Moved"); },
    onError: (e, v) => {
      if (e instanceof ApiError && e.body.error === "rule" && /ANUM/.test(e.message)) setQualify(v);
      else toast(e instanceof ApiError && e.isConflict ? "Someone else just changed this deal. Refreshed." : (e as Error).message);
      if (e instanceof ApiError && e.isConflict) qc.invalidateQueries();
    },
  });
  const moveTo = (opp: CrmOpp, groupKey: string) => {
    const to = stageForGroup(opp.stage, groupKey);
    if (to !== opp.stage) move.mutate({ opp, to });
  };
  const sorted = [...opps].sort((a, b) => (a.next_action_due ?? "0000").localeCompare(b.next_action_due ?? "0000"));
  const columns = [...PIPELINE_GROUPS.map((g) => ({ key: g.key, label: g.label, items: sorted.filter((o) => !o.is_archived && g.stages.includes(o.stage)) }))];
  const lost = sorted.filter((o) => o.stage === "lost");
  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1000px] grid-cols-5 gap-3">
          {columns.map((c) => (
            <section key={c.key} aria-label={c.label}
              onDragOver={(e) => { e.preventDefault(); setDragOver(c.key); }} onDragLeave={() => setDragOver((k) => (k === c.key ? null : k))}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); const o = opps.find((x) => x.id === id); if (o) moveTo(o, c.key); }}
              className={cn("flex min-h-40 flex-col gap-2 rounded-[20px] bg-subtle/60 p-2 transition-colors", dragOver === c.key && "bg-subtle")}>
              <h2 className="flex items-baseline justify-between px-2 pt-1 text-[13px] font-semibold">{c.label}<span className="num font-normal text-text-3">{c.items.length}</span></h2>
              {c.items.map((o) => <DealCard key={o.id} opp={o} account={accounts.get(o.account_id)} today={today} active={selected === o.account_id} onOpen={() => onSelect(o.account_id)}
                onAdvance={nextGroup(o.stage) ? () => moveTo(o, nextGroup(o.stage)!) : undefined} busy={move.isPending && move.variables?.opp.id === o.id} />)}
              {c.items.length === 0 ? <p className="px-2 py-3 text-[13px] text-text-3">{c.key === "to_contact" ? "Add or import businesses to start." : "Drag a card here."}</p> : null}
            </section>
          ))}
        </div>
      </div>
      <button type="button" onClick={onToggleLost} className="self-start text-[13px] text-text-2 underline underline-offset-2">{showLost ? "Hide" : "Show"} lost deals ({lost.length})</button>
      {showLost && lost.length ? (
        <ul className="flex flex-wrap gap-2">{lost.map((o) => <li key={o.id}><button type="button" onClick={() => onSelect(o.account_id)} className="rounded-full border border-hairline px-3 py-1 text-[13px] text-text-2 hover:bg-subtle">{accounts.get(o.account_id)?.name ?? o.name}{o.lost_reason ? ` · ${o.lost_reason}` : ""}</button></li>)}</ul>
      ) : null}
      {qualify ? <QualifyModal opp={qualify.opp} to={qualify.to} onClose={() => setQualify(null)} /> : null}
    </>
  );
}

function DealCard({ opp, account, today, active, onOpen, onAdvance, busy }: { opp: CrmOpp; account?: CrmAccount; today: string; active: boolean; onOpen: () => void; onAdvance?: () => void; busy: boolean }) {
  const qa = useQuickAction();
  const due = dueLabel(opp.next_action_due, today);
  return (
    <article draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", opp.id)}
      className={cn("flex cursor-grab flex-col gap-2 rounded-[12px] border bg-panel p-3 active:cursor-grabbing", active ? "border-ink" : "border-hairline hover:border-control", busy && "opacity-60")}>
      <button type="button" onClick={onOpen} className="text-left">
        <p className="font-medium leading-snug">{account?.name ?? opp.name}</p>
        <p className={cn("mt-0.5 text-[13px] leading-snug", opp.next_action ? "text-text-2" : "text-bad")}>{opp.next_action || "Add a next step"}</p>
      </button>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={cn("num", due.tone === "bad" ? "font-medium text-bad" : due.tone === "normal" ? "font-medium text-ink" : "text-text-3")}>{due.text}</span>
        <span className="text-text-3">{opp.owner_founder ? FOUNDER_NAMES[opp.owner_founder] : "Unassigned"}{opp.value_minor ? ` · ${formatEur(opp.value_minor)}` : ""}</span>
      </div>
      <div className="flex gap-1.5">
        <button type="button" disabled={Boolean(account?.blocked_reason)} onClick={() => qa.open({ accountId: opp.account_id, opportunityId: opp.id })}
          className="h-8 flex-1 rounded-full border border-control text-[13px] font-medium hover:bg-subtle disabled:opacity-40" title={account?.blocked_reason ?? undefined}>Log</button>
        {onAdvance ? <button type="button" onClick={onAdvance} aria-label={`Move ${account?.name ?? opp.name} to the next column`} className="h-8 rounded-full border border-control px-3 text-[13px] font-medium hover:bg-subtle">→</button> : null}
      </div>
    </article>
  );
}

function QualifyModal({ opp, to, onClose }: { opp: CrmOpp; to: Stage; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({ anum_authority: opp.anum_authority, anum_need: opp.anum_need, anum_urgency: opp.anum_urgency, anum_money: opp.anum_money });
  const m = useMutation({
    mutationFn: () => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: opp.version, patch: { ...v, stage: to } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Moved"); onClose(); },
  });
  const labels = { anum_authority: "Who decides?", anum_need: "What do they need?", anum_urgency: "Why now?", anum_money: "Budget" } as const;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Qualify before the demo" description="Four short notes, so the next step is a real opportunity.">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {(Object.keys(labels) as (keyof typeof labels)[]).map((k) => (
          <Field key={k} label={labels[k]} htmlFor={`q-${k}`}><Input id={`q-${k}`} required value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
        ))}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? "Saving…" : `Save and move to ${STAGE_LABELS[to]}`}</Button>
      </form>
    </Modal>
  );
}

function ListView({ data, opps, acc, today, selected, onSelect }: { data: Crm; opps: CrmOpp[]; acc: Map<string, CrmAccount>; today: string; selected: string | null; onSelect: (id: string) => void }) {
  const [what, setWhat] = React.useState<"deals" | "businesses">("deals");
  const accounts = data.accounts;
  return (
    <Panel className="overflow-x-auto p-0 sm:p-0">
      <div className="border-b border-hairline px-5 py-3"><SegmentedSwitch size="sm" label="List" value={what} onChange={setWhat} options={[{ value: "deals", label: "Deals" }, { value: "businesses", label: "All businesses" }]} /></div>
      {what === "deals" ? (
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3"><th className="px-5 py-2.5 font-medium">Business</th><th className="pr-4 font-medium">Stage</th><th className="pr-4 font-medium">Next step</th><th className="pr-5 font-medium">Due</th></tr></thead>
          <tbody>
            {opps.map((o) => {
              const due = dueLabel(o.next_action_due, today);
              return (
                <tr key={o.id} onClick={() => onSelect(o.account_id)} className={cn("cursor-pointer border-b border-hairline last:border-0 hover:bg-subtle", selected === o.account_id && "bg-subtle")}>
                  <td className="px-5 py-2.5 font-medium">{acc.get(o.account_id)?.name ?? o.name}</td>
                  <td className="whitespace-nowrap pr-4">{STAGE_LABELS[o.stage]}</td>
                  <td className={cn("max-w-72 truncate pr-4", !o.next_action && "text-bad")}>{o.next_action || "Add a next step"}</td>
                  <td className={cn("num whitespace-nowrap pr-5", due.tone === "bad" && "text-bad")}>{due.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3"><th className="px-5 py-2.5 font-medium">Business</th><th className="pr-4 font-medium">Phone</th><th className="pr-4 font-medium">Owner</th><th className="pr-5 font-medium">Last activity</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} onClick={() => onSelect(a.id)} className={cn("cursor-pointer border-b border-hairline last:border-0 hover:bg-subtle", selected === a.id && "bg-subtle")}>
                <td className="px-5 py-2.5"><button type="button" className="text-left font-medium" onClick={(e) => { e.stopPropagation(); onSelect(a.id); }}>{a.name}</button>{a.blocked_reason ? <span className="ml-2 text-[12px] text-bad">opted out</span> : null}</td>
                <td className="num whitespace-nowrap pr-4">{a.phone || "—"}</td>
                <td className="pr-4">{a.owner_founder ? FOUNDER_NAMES[a.owner_founder] : "—"}</td>
                <td className="pr-5 text-text-2">{relTime(a.last_activity_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function AccountPanel({ account, data, onClose }: { account: CrmAccount; data: Crm; onClose: () => void }) {
  const qa = useQuickAction();
  const contacts = data.contacts.filter((c) => c.account_id === account.id);
  const opps = data.opportunities.filter((o) => o.account_id === account.id);
  const main = opps.find(isOpen) ?? opps[0];
  const timeline = useQuery({ queryKey: ["timeline", account.id], queryFn: () => api<{ events: { id: string; activity_type: keyof typeof ACTIVITY_LABELS; founder_key: string; local_date: string; outcome: string | null; notes: string; late_logged: boolean }[] }>(`/api/crm/timeline?account_id=${account.id}`) });
  const [more, setMore] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  return (
    <DetailPanel open onClose={onClose}
      title={<div><h2 className="truncate text-lg font-semibold">{account.name}</h2><p className="text-[13px] text-text-2">{[main ? STAGE_LABELS[main.stage] : null, account.country, account.niche].filter(Boolean).join(" · ")}</p></div>}
      footer={<div className="flex gap-2"><Button variant="primary" className="flex-1" disabled={Boolean(account.blocked_reason)} onClick={() => qa.open({ accountId: account.id, opportunityId: main?.id })}>Log activity</Button>{account.phone ? <Button asChild variant="outline"><a href={`tel:${account.phone}`} aria-label={`Call ${account.phone}`}><Phone /> {account.phone}</a></Button> : null}</div>}>
      <div className="flex flex-col gap-6">
        {account.blocked_reason ? <p className="flex items-center gap-2 rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad"><Ban className="size-4" />{account.blocked_reason}</p> : null}
        {main ? <NextStepEditor key={main.id + main.version} opp={main} /> : <NewOpportunityForm account={account} />}

        <a className="self-start text-sm underline underline-offset-2" target="_blank" rel="noreferrer noopener"
          href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Meeting · ${account.name}`)}&details=${encodeURIComponent("Valemont meeting. Add the guests and send the invitation yourself.")}`}>
          Add a meeting to Google Calendar
        </a>
        <section>
          <h3 className="mb-2 text-sm font-semibold">People</h3>
          {contacts.length === 0 ? <p className="text-sm text-text-2">No contact person yet.</p> : <ul className="flex flex-col gap-2">{contacts.map((c) => <ContactRow key={c.id} contact={c} />)}</ul>}
          <AddContactForm accountId={account.id} />
        </section>

        <RecordFiles recordType="account" recordId={account.id} />
        <section>
          <h3 className="mb-2 text-sm font-semibold">History</h3>
          {timeline.isPending ? <Skeleton className="h-20" /> : timeline.isError ? <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} /> : timeline.data.events.length === 0 ? <p className="text-sm text-text-2">Nothing logged yet.</p> : (
            <ul className="flex flex-col">
              {timeline.data.events.slice(0, 20).map((e) => (
                <li key={e.id} className="border-t border-hairline py-2 text-sm first:border-t-0">
                  <div className="flex justify-between gap-2"><span className="font-medium">{ACTIVITY_LABELS[e.activity_type]}{e.outcome ? ` · ${OUTCOME_LABELS[e.outcome as keyof typeof OUTCOME_LABELS] ?? e.outcome}` : ""}</span><span className="num text-[12px] text-text-3">{shortDate(e.local_date)}{e.late_logged ? " · late" : ""}</span></div>
                  <p className="text-[13px] text-text-2">{FOUNDER_NAMES[e.founder_key as "theo"] ?? e.founder_key}{e.notes ? ` · ${e.notes}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="text-sm font-semibold underline underline-offset-2">{more ? "Hide details" : "More details"}</button>
          {more ? (
            <div className="mt-3 flex flex-col gap-5">
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Business</h3><Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</Button></div>
                {editing ? <AccountEditForm account={account} onSaved={() => setEditing(false)} /> : (
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-text-3">Email</dt><dd className="truncate">{account.email || "—"}</dd>
                    <dt className="text-text-3">Website</dt><dd className="truncate">{account.website ? <a className="underline" href={account.website.startsWith("http") ? account.website : `https://${account.website}`} target="_blank" rel="noreferrer noopener">{account.domain_normalized || account.website}</a> : "—"}</dd>
                    <dt className="text-text-3">Owner</dt><dd>{account.owner_founder ? FOUNDER_NAMES[account.owner_founder] : "Unassigned"}</dd>
                    <dt className="text-text-3">Problem seen</dt><dd>{account.observed_problem || "—"}</dd>
                    <dt className="text-text-3">Source</dt><dd>{account.lead_source || "—"}</dd>
                  </dl>
                )}
              </div>
              {opps.map((o) => <div key={o.id}><h3 className="mb-2 text-sm font-semibold">Deal details</h3><OpportunityEditor key={o.id + o.version} opp={o} /></div>)}
            </div>
          ) : null}
        </section>
      </div>
    </DetailPanel>
  );
}

/** The one thing that matters on a deal: what happens next, and when (D018). */
function NextStepEditor({ opp }: { opp: CrmOpp }) {
  const qc = useQueryClient();
  const today = new Date().toLocaleDateString("en-CA");
  const [text, setText] = React.useState(opp.next_action);
  const [due, setDue] = React.useState(opp.next_action_due ?? "");
  const [version, setVersion] = React.useState(opp.version);
  const dirty = text !== opp.next_action || due !== (opp.next_action_due ?? "");
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: expected, patch: { next_action: text, next_action_due: due } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const chips: [string, number][] = [["Today", 0], ["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7]];
  return (
    <section className={cn("rounded-[12px] border p-3", !opp.next_action || !opp.next_action_due ? "border-bad/50" : "border-hairline")}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
        <label htmlFor={`ns-${opp.id}`} className="text-sm font-semibold">Next step</label>
        <Input id={`ns-${opp.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Call back Tuesday after 5pm" />
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map(([l, d]) => {
            const v = addDays(today, d);
            return <button key={l} type="button" aria-pressed={due === v} onClick={() => setDue(v)} className={cn("h-8 rounded-full border px-3 text-[13px]", due === v ? "border-ink bg-ink text-panel" : "border-hairline text-text-2 hover:bg-subtle")}>{l}</button>;
          })}
          <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-40 text-[13px]" />
        </div>
        {err?.isConflict ? (
          <ConflictNotice mine={{ next_action: text, next_action_due: due }} current={err.body.current} fields={["next_action", "next_action_due"]} onKeepTheirs={() => qc.invalidateQueries()} onApplyMine={() => { const cv = Number(err.body.current?.version); setVersion(cv); m.mutate(cv); }} />
        ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(version)} /> : null}
        {dirty ? <Button type="submit" size="sm" variant="primary" className="self-start" disabled={m.isPending || !text.trim() || !due}>{m.isPending ? "Saving…" : "Save next step"}</Button> : null}
      </form>
    </section>
  );
}

const ACCOUNT_FIELDS = ["name", "sector", "niche", "city", "phone", "email", "website", "linkedin_url", "observed_problem", "problem_evidence", "notes"] as const;

function AccountEditForm({ account, onSaved }: { account: CrmAccount; onSaved: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState(() => ({ ...Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f, account[f] ?? ""])), country: account.country ?? "", owner_founder: account.owner_founder ?? "" }) as Record<string, string>);
  const [version, setVersion] = React.useState(account.version);
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/crm/accounts", { method: "PATCH", body: { id: account.id, expected_version: expected, patch: { ...v, country: v.country || null, owner_founder: v.owner_founder || null } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); onSaved(); },
  });
  const conflict = m.error instanceof ApiError && m.error.isConflict ? m.error.body.current : null;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
      {(["name", "phone", "email", "website", "sector", "niche", "city"] as const).map((f) => (
        <Field key={f} label={f[0].toUpperCase() + f.slice(1)} htmlFor={`acc-${f}`}><Input id={`acc-${f}`} value={v[f]} onChange={(e) => setV({ ...v, [f]: e.target.value })} type={f === "phone" ? "tel" : "text"} /></Field>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country" htmlFor="acc-country"><Select id="acc-country" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })}><option value="">—</option>{MARKETS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Owner" htmlFor="acc-owner"><Select id="acc-owner" value={v.owner_founder} onChange={(e) => setV({ ...v, owner_founder: e.target.value })}><option value="">Unassigned</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
      </div>
      <Field label="Observed problem" htmlFor="acc-prob" hint="What you actually saw or heard. Never an invented diagnosis."><Textarea id="acc-prob" value={v.observed_problem} onChange={(e) => setV({ ...v, observed_problem: e.target.value })} /></Field>
      <Field label="Evidence" htmlFor="acc-ev"><Input id="acc-ev" value={v.problem_evidence} onChange={(e) => setV({ ...v, problem_evidence: e.target.value })} /></Field>
      <Field label="Notes" htmlFor="acc-notes"><Textarea id="acc-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {conflict ? (
        <ConflictNotice mine={v} current={conflict} fields={[...ACCOUNT_FIELDS]} onKeepTheirs={() => { qc.invalidateQueries(); onSaved(); }} onApplyMine={() => { const cv = Number(conflict.version); setVersion(cv); m.mutate(cv); }} />
      ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(version)} /> : null}
      <Button type="submit" variant="dark" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

function OpportunityEditor({ opp }: { opp: CrmOpp }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({
    stage: opp.stage, value_eur: opp.value_minor === null ? "" : String(opp.value_minor / 100), next_action: opp.next_action, next_action_due: opp.next_action_due ?? "",
    next_action_priority: opp.next_action_priority ?? "normal", owner_founder: opp.owner_founder ?? "", lost_reason: opp.lost_reason,
    anum_authority: opp.anum_authority, anum_need: opp.anum_need, anum_urgency: opp.anum_urgency, anum_money: opp.anum_money,
  });
  const [version, setVersion] = React.useState(opp.version);
  const m = useMutation({
    mutationFn: (expected: number) => api("/api/crm/opportunities", { method: "PATCH", body: { id: opp.id, expected_version: expected, patch: { ...v, value_eur: v.value_eur === "" ? null : Number(v.value_eur), owner_founder: v.owner_founder || null } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const needsAnum = ["qualified", "demo_shown", "proposal_sent", "negotiation", "won"].includes(v.stage);
  return (
    <form className="mb-3 flex flex-col gap-3 rounded-[12px] border border-hairline p-3" onSubmit={(e) => { e.preventDefault(); m.mutate(version); }}>
      <div className="flex items-baseline justify-between gap-2"><p className="font-medium">{opp.name}</p><span className="text-[12px] text-text-3">{BRAND_LABELS[opp.brand]}</span></div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stage" htmlFor={`st-${opp.id}`} hint={`To move on: ${STAGE_EXIT_CRITERIA[v.stage as Stage].charAt(0).toLowerCase()}${STAGE_EXIT_CRITERIA[v.stage as Stage].slice(1)}`}>
          <Select id={`st-${opp.id}`} value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value as Stage })}>{STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select>
        </Field>
        <Field label="Value (EUR, ex VAT)" htmlFor={`val-${opp.id}`}><Input id={`val-${opp.id}`} inputMode="decimal" className="num" value={v.value_eur} onChange={(e) => setV({ ...v, value_eur: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
      </div>
      <Field label="Next action" htmlFor={`na-${opp.id}`}><Input id={`na-${opp.id}`} value={v.next_action} onChange={(e) => setV({ ...v, next_action: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due" htmlFor={`due-${opp.id}`}><Input id={`due-${opp.id}`} type="date" value={v.next_action_due} onChange={(e) => setV({ ...v, next_action_due: e.target.value })} /></Field>
        <Field label="Priority" htmlFor={`pr-${opp.id}`}><Select id={`pr-${opp.id}`} value={v.next_action_priority} onChange={(e) => setV({ ...v, next_action_priority: e.target.value as "high" | "normal" })}><option value="normal">Normal</option><option value="high">High</option></Select></Field>
      </div>
      {needsAnum ? (
        <fieldset className="grid grid-cols-1 gap-2">
          <legend className="mb-1 text-[13px] font-medium text-text-2">Qualification (ANUM, required)</legend>
          {(["anum_authority", "anum_need", "anum_urgency", "anum_money"] as const).map((k) => (
            <Input key={k} aria-label={k.replace("anum_", "")} placeholder={k.replace("anum_", "")[0].toUpperCase() + k.replace("anum_", "").slice(1)} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          ))}
        </fieldset>
      ) : null}
      {v.stage === "lost" ? <Field label="Lost reason" htmlFor={`lr-${opp.id}`}><Input id={`lr-${opp.id}`} value={v.lost_reason} onChange={(e) => setV({ ...v, lost_reason: e.target.value })} /></Field> : null}
      {err?.isConflict ? (
        <ConflictNotice mine={v} current={err.body.current} fields={["stage", "next_action", "next_action_due", "lost_reason"]} onKeepTheirs={() => qc.invalidateQueries()} onApplyMine={() => { const cv = Number(err.body.current?.version); setVersion(cv); m.mutate(cv); }} />
      ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate(version)} /> : null}
      <Button type="submit" variant="outline" size="sm" className="self-start" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save opportunity"}</Button>
    </form>
  );
}

function NewOpportunityForm({ account }: { account: CrmAccount }) {
  const qc = useQueryClient();
  const [id] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: () => api("/api/crm/opportunities", { body: { id, account_id: account.id, opportunity: { name: `${account.name} · Local Essential`, brand: account.brand ?? "local", owner_founder: account.owner_founder } } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); },
  });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-2">No opportunity yet.</p>
      <Button size="sm" variant="outline" className="self-start" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Saving…" : "Create opportunity"}</Button>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </div>
  );
}

function ContactRow({ contact }: { contact: CrmContact }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = React.useState(false);
  const m = useMutation({ mutationFn: () => api("/api/crm/opt-out", { body: { contact_id: contact.id } }), onSuccess: () => { qc.invalidateQueries(); setConfirm(false); toast("Opted out. Outreach is now blocked for both founders."); } });
  return (
    <li className="rounded-[12px] border border-hairline p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{contact.full_name || "Unnamed contact"}{contact.role ? <span className="font-normal text-text-2"> · {contact.role}</span> : null}</p>
          <p className="text-[12px] text-text-3">{CONTACT_TYPE_LABELS[contact.contact_type]} · {contact.consent_status === "opted_out" ? "opted out" : "consent " + contact.consent_status}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {contact.phone ? <a className="flex size-9 items-center justify-center rounded-full hover:bg-subtle" href={`tel:${contact.phone}`} aria-label={`Call ${contact.full_name}`}><Phone className="size-4" /></a> : null}
          {contact.email ? <a className="flex size-9 items-center justify-center rounded-full hover:bg-subtle" href={`mailto:${contact.email}`} aria-label={`Email ${contact.full_name}`}><Mail className="size-4" /></a> : null}
          {contact.linkedin_url ? <a className="flex size-9 items-center justify-center rounded-full hover:bg-subtle" href={contact.linkedin_url} target="_blank" rel="noreferrer noopener" aria-label="Open LinkedIn"><ExternalLink className="size-4" /></a> : null}
        </div>
      </div>
      {contact.blocked_reason ? <p className="mt-2 flex items-center gap-1.5 text-[13px] text-bad"><Ban className="size-3.5" />{contact.blocked_reason}</p> : confirm ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px]">Opt out permanently? Both founders will be blocked from contacting them.</span>
          <Button size="sm" variant="danger" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Saving…" : "Confirm opt-out"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
      ) : <button type="button" className="mt-2 text-[13px] text-text-2 underline" onClick={() => setConfirm(true)}>Mark opted out</button>}
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </li>
  );
}

function AddContactForm({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ full_name: "", role: "", phone: "", email: "", contact_type: "professional_named" });
  const m = useMutation({
    mutationFn: () => api("/api/crm/contacts", { body: { id, account_id: accountId, contact: v } }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); setOpen(false); setId(crypto.randomUUID()); setV({ full_name: "", role: "", phone: "", email: "", contact_type: "professional_named" }); },
  });
  if (!open) return <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(true)}><Plus /> Add contact</Button>;
  return (
    <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Input aria-label="Name" placeholder="Name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
      <Input aria-label="Role" placeholder="Role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} />
      <Input aria-label="Phone" placeholder="Phone" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <Input aria-label="Email" placeholder="Email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <Select aria-label="Contact type" value={v.contact_type} onChange={(e) => setV({ ...v, contact_type: e.target.value })}>{CONTACT_TYPES.map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</option>)}</Select>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
      <div className="flex gap-2"><Button size="sm" type="submit" variant="dark" disabled={m.isPending}>{m.isPending ? "Saving…" : "Save contact"}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

function NewBusinessModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const blank = { name: "", country: "FR" as "FR" | "ES", phone: "", next_action: "First call", email: "", website: "", niche: "", contact_name: "", brand: "local", owner_founder: me.founder as string };
  const [v, setV] = React.useState(blank);
  const [more, setMore] = React.useState(false);
  const today = new Date().toLocaleDateString("en-CA");
  const m = useMutation({
    mutationFn: () => api("/api/crm/accounts", {
      body: {
        id,
        account: { name: v.name, country: v.country, niche: v.niche, phone: v.phone, email: v.email, website: v.website, brand: v.brand, owner_founder: v.owner_founder || null, lead_type: "outbound", lead_status: "new" },
        contact: v.contact_name || v.email ? { full_name: v.contact_name, phone: v.phone, email: v.email } : null,
        opportunity: { name: `${v.name} · ${BRAND_LABELS[v.brand as "local"]}`, brand: v.brand, owner_founder: v.owner_founder || null, next_action: v.next_action, next_action_due: v.next_action ? today : "" },
      },
    }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); const created = id; setId(crypto.randomUUID()); setV(blank); setMore(false); onCreated(created); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New business" description="Name and phone are enough. Add the rest later.">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.name.trim()) m.mutate(); }}>
        <Field label="Business name" htmlFor="nb-name"><Input id="nb-name" required autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Phone" htmlFor="nb-phone"><Input id="nb-phone" type="tel" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
          <SegmentedSwitch label="Country" value={v.country} onChange={(c) => setV({ ...v, country: c })} options={[{ value: "FR", label: "FR" }, { value: "ES", label: "ES" }]} />
        </div>
        <Field label="Next step (due today)" htmlFor="nb-next"><Input id="nb-next" value={v.next_action} onChange={(e) => setV({ ...v, next_action: e.target.value })} /></Field>
        <button type="button" onClick={() => setMore((x) => !x)} aria-expanded={more} className="self-start text-sm text-text-2 underline underline-offset-2">{more ? "Fewer fields" : "More fields"}</button>
        {more ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Contact name" htmlFor="nb-contact"><Input id="nb-contact" value={v.contact_name} onChange={(e) => setV({ ...v, contact_name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="nb-email"><Input id="nb-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Website" htmlFor="nb-web"><Input id="nb-web" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></Field>
            <Field label="Trade / niche" htmlFor="nb-niche"><Input id="nb-niche" value={v.niche} onChange={(e) => setV({ ...v, niche: e.target.value })} placeholder="e.g. Plumbers" /></Field>
            <Field label="Brand" htmlFor="nb-brand"><Select id="nb-brand" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })}>{BRANDS.map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}</Select></Field>
            <Field label="Owner" htmlFor="nb-owner"><Select id="nb-owner" value={v.owner_founder} onChange={(e) => setV({ ...v, owner_founder: e.target.value })}><option value="">Unassigned</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
          </div>
        ) : null}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" size="lg" disabled={m.isPending || !v.name.trim()}>{m.isPending ? "Saving…" : "Save business"}</Button>
      </form>
    </Modal>
  );
}
