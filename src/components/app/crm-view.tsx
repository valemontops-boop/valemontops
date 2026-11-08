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
  ACTIVITY_LABELS, BRANDS, BRAND_LABELS, CONTACT_TYPES, CONTACT_TYPE_LABELS, FOUNDERS, FOUNDER_NAMES, MARKETS, OUTCOME_LABELS, STAGES,
  STAGE_EXIT_CRITERIA, STAGE_LABELS, type Stage,
} from "@/domain/constants";
import { hygieneFlags, isOpen, OPEN_STAGES } from "@/domain/pipeline";
import { ApiError, api } from "@/lib/api";
import { cn, formatEur, relTime } from "@/lib/utils";
import { ConflictNotice } from "./conflict";
import { useQuickAction } from "./quick-action";
import { useCrm, type Crm, type CrmAccount, type CrmContact, type CrmOpp } from "./use-crm";

type Tab = "opportunities" | "businesses";

function shortDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function CrmView() {
  const crm = useCrm();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("opportunities");
  const [search, setSearch] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [market, setMarket] = React.useState("");
  const [stage, setStage] = React.useState("");
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
    (!owner || o.owner_founder === owner) && (!market || o.market === market) && (!stage || o.stage === stage) &&
    (!s || o.name.toLowerCase().includes(s) || (acc.get(o.account_id)?.name ?? "").toLowerCase().includes(s)));
  const accounts = data.accounts.filter((a) =>
    (!owner || a.owner_founder === owner) && (!market || a.country === market) &&
    (!s || a.name.toLowerCase().includes(s) || a.niche.toLowerCase().includes(s) || a.phone.includes(s)));
  const open = data.opportunities.filter(isOpen);
  const noNext = open.filter((o) => hygieneFlags(o, today).length > 0).length;

  return (
    <div className="flex gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sales CRM</h1>
            <p className="text-sm text-text-2">
              <span className="num">{open.length}</span> open opportunities · <span className="num">{data.accounts.length}</span> businesses
              {noNext ? <> · <span className="text-bad"><span className="num">{noNext}</span> without a dated next action</span></> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm"><Link href="/crm/import"><Upload /> Import CSV</Link></Button>
            <Button asChild variant="ghost" size="sm"><a href="/api/crm/export"><Download /> Export CSV</a></Button>
            <Button variant="dark" size="sm" onClick={() => setCreating(true)}><Plus /> New business</Button>
          </div>
        </div>

        <PipelineBar opps={open} onPick={(st) => { setTab("opportunities"); setStage(stage === st ? "" : st); }} active={stage} />

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedSwitch label="View" value={tab} onChange={setTab} options={[{ value: "opportunities", label: "Opportunities" }, { value: "businesses", label: "Businesses" }]} />
          <Input aria-label="Search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-48" />
          <Select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 w-36">
            <option value="">All founders</option>
            {FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}
          </Select>
          <Select aria-label="Market" value={market} onChange={(e) => setMarket(e.target.value)} className="h-9 w-32">
            <option value="">FR + ES</option>
            {MARKETS.map((m) => <option key={m} value={m}>{m === "FR" ? "France" : "Spain"}</option>)}
          </Select>
          {tab === "opportunities" ? (
            <Select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className="h-9 w-44">
              <option value="">All stages</option>
              {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABELS[st]}</option>)}
            </Select>
          ) : null}
        </div>

        <Panel className="overflow-x-auto p-0 sm:p-0">
          {tab === "opportunities" ? (
            opps.length === 0 ? <div className="p-5"><EmptyState title="No opportunities match" action={<Button size="sm" onClick={() => setCreating(true)}>Add a business</Button>} /></div> : (
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3">
                  <th className="px-5 py-3 font-medium">Opportunity</th><th className="pr-4 font-medium">Stage</th><th className="pr-4 font-medium">Owner</th>
                  <th className="pr-4 text-right font-medium">Value</th><th className="pr-4 font-medium">Next action</th><th className="pr-5 font-medium">Due</th>
                </tr></thead>
                <tbody>
                  {opps.map((o) => {
                    const flags = hygieneFlags(o, today);
                    return (
                      <tr key={o.id} onClick={() => select(o.account_id)} className={cn("cursor-pointer border-b border-hairline last:border-0 hover:bg-subtle", selected === o.account_id && "bg-subtle")}>
                        <td className="px-5 py-3"><button type="button" className="text-left font-medium" onClick={(e) => { e.stopPropagation(); select(o.account_id); }}>{o.name}</button><div className="text-[12px] text-text-3">{BRAND_LABELS[o.brand]} · {o.market ?? "—"}</div></td>
                        <td className="whitespace-nowrap pr-4">{STAGE_LABELS[o.stage]}</td>
                        <td className="pr-4">{o.owner_founder ? FOUNDER_NAMES[o.owner_founder] : <span className="text-text-3">Unassigned</span>}</td>
                        <td className="num pr-4 text-right">{formatEur(o.value_minor)}</td>
                        <td className="max-w-64 truncate pr-4">{o.next_action || <span className="text-bad">{flags[0] ?? "—"}</span>}</td>
                        <td className={cn("num whitespace-nowrap pr-5", o.next_action_due && o.next_action_due < today && isOpen(o) ? "text-bad" : "")}>{shortDate(o.next_action_due)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : accounts.length === 0 ? <div className="p-5"><EmptyState title="No businesses yet" action={<div className="flex gap-2"><Button size="sm" onClick={() => setCreating(true)}>Add a business</Button><Button asChild size="sm" variant="ghost"><Link href="/crm/import">Import a CSV</Link></Button></div>} /></div> : (
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-hairline text-left text-[12px] text-text-3">
                <th className="px-5 py-3 font-medium">Business</th><th className="pr-4 font-medium">Niche</th><th className="pr-4 font-medium">Phone</th><th className="pr-4 font-medium">Owner</th><th className="pr-5 font-medium">Last activity</th>
              </tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} onClick={() => select(a.id)} className={cn("cursor-pointer border-b border-hairline last:border-0 hover:bg-subtle", selected === a.id && "bg-subtle")}>
                    <td className="px-5 py-3"><button type="button" className="text-left font-medium" onClick={(e) => { e.stopPropagation(); select(a.id); }}>{a.name}</button><div className="text-[12px] text-text-3">{a.country ?? "—"}{a.city ? ` · ${a.city}` : ""}{a.blocked_reason ? " · suppressed" : ""}</div></td>
                    <td className="pr-4">{a.niche || "—"}</td>
                    <td className="num whitespace-nowrap pr-4">{a.phone || "—"}</td>
                    <td className="pr-4">{a.owner_founder ? FOUNDER_NAMES[a.owner_founder] : <span className="text-text-3">Unassigned</span>}</td>
                    <td className="pr-5 text-text-2">{relTime(a.last_activity_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        {data.warnings.length ? <p className="text-[13px] text-text-2">{data.warnings.length} data-integrity warning(s) in the Sheet. See Settings › Diagnostics.</p> : null}
      </div>

      {selected && acc.get(selected) ? <AccountPanel key={selected} account={acc.get(selected)!} data={data} onClose={() => select(null)} /> : null}
      <NewBusinessModal open={creating} onOpenChange={setCreating} onCreated={(id) => { setCreating(false); select(id); }} />
    </div>
  );
}

/* Segmented bar with legend counts and 2px gaps (DESIGN.md). Count-based: values are often unknown early. */
function PipelineBar({ opps, onPick, active }: { opps: CrmOpp[]; onPick: (s: Stage) => void; active: string }) {
  const counts = OPEN_STAGES.map((s) => ({ s, n: opps.filter((o) => o.stage === s).length })).filter((x) => x.n > 0);
  const total = counts.reduce((a, b) => a + b.n, 0);
  if (!total) return null;
  const shades = ["#17161A", "#3a383f", "#57545C", "#6E6A72", "#8E8A92", "#a8a4ab", "#c3c0c6", "#d8d6da"];
  return (
    <Panel aria-label="Open pipeline by stage" className="py-4">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {counts.map((c) => <div key={c.s} style={{ flexGrow: c.n, background: shades[OPEN_STAGES.indexOf(c.s)] }} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        {counts.map((c) => (
          <li key={c.s}>
            <button type="button" onClick={() => onPick(c.s)} aria-pressed={active === c.s} className={cn("flex items-center gap-1.5 rounded-full px-1", active === c.s ? "font-semibold" : "text-text-2 hover:text-ink")}>
              <span className="size-2.5 rounded-full" style={{ background: shades[OPEN_STAGES.indexOf(c.s)] }} />
              {STAGE_LABELS[c.s]} <span className="num">{c.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AccountPanel({ account, data, onClose }: { account: CrmAccount; data: Crm; onClose: () => void }) {
  const qa = useQuickAction();
  const contacts = data.contacts.filter((c) => c.account_id === account.id);
  const opps = data.opportunities.filter((o) => o.account_id === account.id);
  const timeline = useQuery({ queryKey: ["timeline", account.id], queryFn: () => api<{ events: { id: string; activity_type: keyof typeof ACTIVITY_LABELS; founder_key: string; local_date: string; outcome: string | null; notes: string; late_logged: boolean }[] }>(`/api/crm/timeline?account_id=${account.id}`) });
  const [editing, setEditing] = React.useState(false);
  return (
    <DetailPanel open onClose={onClose}
      title={<div><h2 className="truncate text-lg font-semibold">{account.name}</h2><p className="text-[13px] text-text-2">{[account.country, account.sector, account.niche].filter(Boolean).join(" · ") || "No details yet"}</p></div>}
      footer={<div className="flex gap-2"><Button variant="dark" className="flex-1" disabled={Boolean(account.blocked_reason)} onClick={() => qa.open({ accountId: account.id })}>Log activity</Button>{account.phone ? <Button asChild variant="outline"><a href={`tel:${account.phone}`} aria-label="Call"><Phone /></a></Button> : null}</div>}>
      <div className="flex flex-col gap-6">
        {account.blocked_reason ? <p className="flex items-center gap-2 rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad"><Ban className="size-4" />{account.blocked_reason}</p> : null}
        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Details</h3><Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>{editing ? "Close" : "Edit"}</Button></div>
          {editing ? <AccountEditForm account={account} onSaved={() => setEditing(false)} /> : (
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-text-3">Phone</dt><dd className="num">{account.phone || "—"}</dd>
              <dt className="text-text-3">Email</dt><dd className="truncate">{account.email ? <a className="underline" href={`mailto:${account.email}`}>{account.email}</a> : "—"}</dd>
              <dt className="text-text-3">Website</dt><dd className="truncate">{account.website ? <a className="underline" href={account.website.startsWith("http") ? account.website : `https://${account.website}`} target="_blank" rel="noreferrer noopener">{account.domain_normalized || account.website}</a> : "—"}</dd>
              <dt className="text-text-3">Owner</dt><dd>{account.owner_founder ? FOUNDER_NAMES[account.owner_founder] : "Unassigned"}</dd>
              <dt className="text-text-3">Observed problem</dt><dd>{account.observed_problem || "—"}</dd>
              {account.problem_evidence ? <><dt className="text-text-3">Evidence</dt><dd>{account.problem_evidence}</dd></> : null}
              <dt className="text-text-3">Source</dt><dd>{account.lead_source || "—"}</dd>
            </dl>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Opportunities</h3>
          {opps.length === 0 ? <NewOpportunityForm account={account} /> : opps.map((o) => <OpportunityEditor key={o.id + o.version} opp={o} />)}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Contacts</h3>
          {contacts.length === 0 ? <p className="text-sm text-text-2">No contact person yet.</p> : (
            <ul className="flex flex-col gap-2">{contacts.map((c) => <ContactRow key={c.id} contact={c} />)}</ul>
          )}
          <AddContactForm accountId={account.id} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">History</h3>
          {timeline.isPending ? <Skeleton className="h-20" /> : timeline.isError ? <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} /> : timeline.data.events.length === 0 ? <p className="text-sm text-text-2">No activity logged.</p> : (
            <ul className="flex flex-col">
              {timeline.data.events.slice(0, 20).map((e) => (
                <li key={e.id} className="border-t border-hairline py-2 text-sm first:border-t-0">
                  <div className="flex justify-between gap-2"><span className="font-medium">{ACTIVITY_LABELS[e.activity_type]}{e.outcome ? ` · ${OUTCOME_LABELS[e.outcome as keyof typeof OUTCOME_LABELS] ?? e.outcome}` : ""}</span><span className="num text-[12px] text-text-3">{e.local_date}{e.late_logged ? " · late" : ""}</span></div>
                  <p className="text-[13px] text-text-2">{FOUNDER_NAMES[e.founder_key as "theo"] ?? e.founder_key}{e.notes ? ` · ${e.notes}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DetailPanel>
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
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const blank = { name: "", country: "FR", niche: "", sector: "", phone: "", email: "", website: "", contact_name: "", brand: "local", owner_founder: "", with_opp: true };
  const [v, setV] = React.useState(blank);
  const m = useMutation({
    mutationFn: () => api("/api/crm/accounts", {
      body: {
        id,
        account: { name: v.name, country: v.country || null, niche: v.niche, sector: v.sector, phone: v.phone, email: v.email, website: v.website, brand: v.brand, owner_founder: v.owner_founder || null, lead_type: "outbound", lead_status: "new" },
        contact: v.contact_name || v.phone || v.email ? { full_name: v.contact_name, phone: v.phone, email: v.email } : null,
        opportunity: v.with_opp ? { name: `${v.name} · ${BRAND_LABELS[v.brand as "local"]}`, brand: v.brand, owner_founder: v.owner_founder || null } : null,
      },
    }),
    onSuccess: () => { qc.invalidateQueries(); toast("Saved"); const created = id; setId(crypto.randomUUID()); setV(blank); onCreated(created); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New business">
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (v.name.trim()) m.mutate(); }}>
        <Field label="Business name" htmlFor="nb-name" className="sm:col-span-2"><Input id="nb-name" required autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Country" htmlFor="nb-country"><Select id="nb-country" value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })}>{MARKETS.map((m) => <option key={m} value={m}>{m === "FR" ? "France" : "Spain"}</option>)}</Select></Field>
        <Field label="Niche" htmlFor="nb-niche"><Input id="nb-niche" value={v.niche} onChange={(e) => setV({ ...v, niche: e.target.value })} placeholder="e.g. Plumbers" /></Field>
        <Field label="Phone" htmlFor="nb-phone"><Input id="nb-phone" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="nb-email"><Input id="nb-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Website" htmlFor="nb-web"><Input id="nb-web" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></Field>
        <Field label="Contact name" htmlFor="nb-contact"><Input id="nb-contact" value={v.contact_name} onChange={(e) => setV({ ...v, contact_name: e.target.value })} /></Field>
        <Field label="Brand" htmlFor="nb-brand"><Select id="nb-brand" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })}>{BRANDS.map((b) => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}</Select></Field>
        <Field label="Owner" htmlFor="nb-owner"><Select id="nb-owner" value={v.owner_founder} onChange={(e) => setV({ ...v, owner_founder: e.target.value })}><option value="">Unassigned</option>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.with_opp} onChange={(e) => setV({ ...v, with_opp: e.target.checked })} className="size-4" /> Create an opportunity (stage Targeted)</label>
        {m.isError ? <div className="sm:col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
        <Button type="submit" variant="primary" className="sm:col-span-2" disabled={m.isPending || !v.name.trim()}>{m.isPending ? "Saving…" : "Save business"}</Button>
      </form>
    </Modal>
  );
}
