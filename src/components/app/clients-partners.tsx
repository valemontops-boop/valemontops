"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { BANK_CATEGORIES, CATEGORY_LABELS } from "@/domain/bank";
import { FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import { shortlist } from "@/domain/delivery";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";
import { useSave } from "./clients-view";

type Vendor = {
  id: string; version: number; name: string; company: string; skills: string[]; services: string; timezone: string; country: string; currency: string;
  hourly_rate_minor: number | null; daily_rate_minor: number | null; fixed_rate_minor: number | null; capacity_hours_week: number; availability: "available" | "limited" | "unavailable";
  response_sla_hours: number | null; nda_status: "none" | "sent" | "signed"; contract_status: "none" | "draft" | "signed"; rate_valid_until: string | null; contact_email: string; contact_phone: string;
  notes: string; quality_feedback: string; load: { plannedPerWeek: number; capacity: number; over: boolean; loadPct: number | null }; freeHoursWeek: number; rateExpired: boolean; projects: string[];
};
type Tool = { id: string; version: number; name: string; provider: string; use_case: string; apis: string; integration_status: string; monthly_cost_minor: number; currency: string; usage_limits: string; pricing_version: string; pricing_date: string | null; owner_founder: string | null; environment: string; linked_project_ids: string[]; risk_notes: string; expense_category: string; projects: string[] };
type Agent = { id: string; version: number; name: string; kind: string; purpose: string; stack: string; inputs: string; outputs: string; linked_tool_ids: string[]; linked_project_ids: string[]; owner_founder: string | null; status: string; notes: string; projects: string[]; tools: string[] };
type Data = { today: string; vendors: Vendor[]; tools: Tool[]; agents: Agent[]; projects: { id: string; name: string }[]; toolsMonthlyMinor: number };

const AVAIL: Record<string, string> = { available: "Available", limited: "Limited", unavailable: "Unavailable" };
const DOC: Record<string, string> = { none: "None", sent: "Sent", draft: "Draft", signed: "Signed" };
const TOOL_STATUS: Record<string, string> = { planned: "Planned", testing: "Testing", live: "Live", retired: "Retired" };
const AGENT_STATUS: Record<string, string> = { draft: "Draft", tested: "Tested", in_use: "In use", retired: "Retired" };

/** Three separate registries, never mixed (spec 5.8): people, software, internal templates. */
export function PartnersRegistry() {
  const t = useT();
  const [kind, setKind] = React.useState<"people" | "tools" | "agents">("people");
  const q = useQuery({ queryKey: ["clients", "partners"], queryFn: () => api<Data>("/api/clients/partners") });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto [&_button]:whitespace-nowrap"><SegmentedSwitch label={t("Registry")} value={kind} onChange={setKind} options={[{ value: "people", label: t("Contractors and suppliers") }, { value: "tools", label: t("Software and AI tools") }, { value: "agents", label: t("Internal agent templates") }]} /></div>
        <p className="text-[13px] text-text-3">{t(kind === "people" ? "Real people and companies we subcontract to. Never presented as employees." : kind === "tools" ? "Third-party software and AI providers. Never presented as our own technology." : "Our reusable agent and workflow templates. Never presented as people.")}</p>
      </div>
      {q.isPending ? <Skeleton className="h-72" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : kind === "people" ? <People d={q.data} /> : kind === "tools" ? <Tools d={q.data} /> : <Agents d={q.data} />}
    </div>
  );
}

const eur = (minor: number | null, cur: string) => (minor === null ? "—" : formatMoney(minor, cur || "EUR"));

function People({ d }: { d: Data }) {
  const t = useT();
  const [f, setF] = React.useState({ skill: "", hours: "", country: "", maxRate: "" });
  const [edit, setEdit] = React.useState<Vendor | "new" | null>(null);
  const list = shortlist(d.vendors, new Map(d.vendors.map((v) => [v.id, v.freeHoursWeek])), { skill: f.skill, minHours: Number(f.hours) || 0, country: f.country, maxRateMinor: f.maxRate ? Math.round(Number(f.maxRate) * 100) : null });
  const hidden = d.vendors.filter((v) => !list.includes(v));
  const filtering = Boolean(f.skill || f.hours || f.country || f.maxRate);
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label={t("Skill")} htmlFor="sl-skill"><Input id="sl-skill" className="w-40" value={f.skill} onChange={(e) => setF({ ...f, skill: e.target.value })} /></Field>
        <Field label={t("Free hours / week, at least")} htmlFor="sl-h"><Input id="sl-h" inputMode="numeric" className="w-28" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
        <Field label={t("Country")} htmlFor="sl-c"><Select id="sl-c" className="w-28" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}><option value="">{t("All")}</option>{[...new Set(d.vendors.map((v) => v.country).filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        <Field label={t("Max € / hour")} htmlFor="sl-r"><Input id="sl-r" inputMode="decimal" className="w-24" value={f.maxRate} onChange={(e) => setF({ ...f, maxRate: e.target.value })} /></Field>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => setEdit("new")}><Plus /> {t("Add a contractor")}</Button>
      </div>
      {d.vendors.length === 0 ? <EmptyState title={t("No contractor yet")}>{t("Add the people you really work with: rates, capacity and NDA status are entered by you, never assumed.")}</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="text-[12px] text-text-3"><th className="pb-2 font-medium">{t("Name")}</th><th className="pb-2 font-medium">{t("Skills")}</th><th className="pb-2 text-right font-medium">{t("Rate")}</th><th className="pb-2 pr-4 text-right font-medium">{t("Load / capacity")}</th><th className="pb-2 font-medium">{t("NDA · contract")}</th><th className="pb-2 font-medium">{t("Projects")}</th></tr></thead>
            <tbody>{list.map((v) => (
              <tr key={v.id} className="cursor-pointer border-t border-hairline align-top hover:bg-subtle/60" onClick={() => setEdit(v)}>
                <td className="py-2 pr-3"><span className="font-medium">{v.name}</span><span className="block text-[12px] text-text-3">{[v.company, v.country, t(AVAIL[v.availability])].filter(Boolean).join(" · ")}</span></td>
                <td className="py-2 pr-3 text-[13px]">{v.skills.join(", ") || "—"}</td>
                <td className="num py-2 text-right">{v.hourly_rate_minor !== null ? `${eur(v.hourly_rate_minor, v.currency)} ${t("/ h")}` : v.daily_rate_minor !== null ? `${eur(v.daily_rate_minor, v.currency)} ${t("/ day")}` : eur(v.fixed_rate_minor, v.currency)}{v.rateExpired ? <span className="block text-[12px] font-medium text-bad">{t("rate to confirm")}</span> : v.rate_valid_until ? <span className="block text-[12px] text-text-3">{t("valid until {d}", { d: v.rate_valid_until })}</span> : null}</td>
                <td className={cn("num py-2 pr-4 text-right", v.load.over && "font-semibold text-bad")}>{v.load.over ? <AlertTriangle className="mr-1 inline size-3.5" aria-label={t("Over capacity")} /> : null}{v.load.plannedPerWeek} / {v.capacity_hours_week} h</td>
                <td className="py-2 pr-3 text-[13px]">{t(DOC[v.nda_status])} · {t(DOC[v.contract_status])}</td>
                <td className="py-2 text-[13px]">{v.projects.join(", ") || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          {filtering ? <p className="mt-2 text-[12px] text-text-3">{t("{n} shown, {h} hidden by the filters (unavailable people are never shortlisted).", { n: list.length, h: hidden.length })}</p> : null}
        </div>
      )}
      {edit ? <VendorForm v={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
    </Panel>
  );
}

function VendorForm({ v, onClose }: { v: Vendor | null; onClose: () => void }) {
  const t = useT();
  const [id] = React.useState(() => v?.id ?? crypto.randomUUID());
  const s = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x / 100));
  const [f, setF] = React.useState({
    name: v?.name ?? "", company: v?.company ?? "", skills: v?.skills.join(", ") ?? "", services: v?.services ?? "", timezone: v?.timezone ?? "", country: v?.country ?? "", currency: v?.currency ?? "EUR",
    hourly: s(v?.hourly_rate_minor), daily: s(v?.daily_rate_minor), fixed: s(v?.fixed_rate_minor), capacity: String(v?.capacity_hours_week ?? ""), availability: v?.availability ?? "available",
    sla: v?.response_sla_hours === null || v?.response_sla_hours === undefined ? "" : String(v.response_sla_hours), nda: v?.nda_status ?? "none", contract: v?.contract_status ?? "none",
    valid: v?.rate_valid_until ?? "", email: v?.contact_email ?? "", phone: v?.contact_phone ?? "", notes: v?.notes ?? "", feedback: v?.quality_feedback ?? "",
  });
  const m = useSave(v ? "/api/clients/vendors" : "/api/clients/vendors", v ? "PATCH" : "POST", onClose);
  const n = (x: string) => (x.trim() ? Number(x.replace(",", ".")) || 0 : null);
  const body = { name: f.name, company: f.company, skills: f.skills.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30), services: f.services, timezone: f.timezone, country: f.country, currency: f.currency || "EUR", hourly_rate_eur: n(f.hourly), daily_rate_eur: n(f.daily), fixed_rate_eur: n(f.fixed), capacity_hours_week: Math.round(n(f.capacity) ?? 0), availability: f.availability, response_sla_hours: n(f.sla) === null ? null : Math.round(n(f.sla)!), nda_status: f.nda, contract_status: f.contract, rate_valid_until: f.valid, contact_email: f.email, contact_phone: f.phone, notes: f.notes, quality_feedback: f.feedback };
  const inp = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <Field label={t(label)} htmlFor={`vf-${k}`}><Input id={`vf-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></Field>;
  const sel = (k: keyof typeof f, label: string, opts: Record<string, string>) => <Field label={t(label)} htmlFor={`vf-${k}`}><Select id={`vf-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{Object.entries(opts).map(([a, b]) => <option key={a} value={a}>{t(b)}</option>)}</Select></Field>;
  return (
    <Modal wide open onOpenChange={(o) => !o && onClose()} title={v ? v.name : t("Add a contractor")} description={t("Rates are inputs from the contractor's quote, never assumed.")}>
      <form className="grid grid-cols-2 gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(v ? { id, expected_version: v.version, patch: body } : { id, vendor: body }); }}>
        {inp("name", "Name", { required: true, maxLength: 200 })}{inp("company", "Company")}{inp("skills", "Skills (comma separated)")}
        {inp("services", "Services")}{inp("country", "Country (FR, ES…)", { maxLength: 2 })}{inp("timezone", "Time zone")}
        {inp("currency", "Currency", { maxLength: 3 })}{inp("hourly", "Hourly rate", { inputMode: "decimal" })}{inp("daily", "Daily rate", { inputMode: "decimal" })}
        {inp("fixed", "Fixed fee", { inputMode: "decimal" })}{inp("valid", "Rate valid until", { type: "date" })}{inp("capacity", "Capacity (hours / week)", { inputMode: "numeric" })}
        {sel("availability", "Availability", AVAIL)}{inp("sla", "Response time (hours)", { inputMode: "numeric" })}{sel("nda", "NDA", { none: "None", sent: "Sent", signed: "Signed" })}
        {sel("contract", "Contract", { none: "None", draft: "Draft", signed: "Signed" })}{inp("email", "Email", { type: "email" })}{inp("phone", "Phone")}
        <Field label={t("Notes")} htmlFor="vf-notes" className="col-span-2 sm:col-span-3"><Textarea id="vf-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2_000} /></Field>
        <Field label={t("Quality feedback")} htmlFor="vf-fb" className="col-span-2 sm:col-span-3"><Textarea id="vf-fb" value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })} maxLength={2_000} /></Field>
        <Button type="submit" variant="primary" className="col-span-2 sm:col-span-3" disabled={!f.name.trim() || m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Modal>
  );
}

function Tools({ d }: { d: Data }) {
  const t = useT();
  const [edit, setEdit] = React.useState<Tool | "new" | null>(null);
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-text-2">{t("Recurring cost of live and tested tools: {x} / month", { x: formatMoney(d.toolsMonthlyMinor) })}</p>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => setEdit("new")}><Plus /> {t("Add a tool")}</Button>
      </div>
      {d.tools.length === 0 ? <EmptyState title={t("No tool yet")}>{t("List each software or AI provider with its real price, its limits and the date of that price.")}</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="text-[12px] text-text-3"><th className="pb-2 font-medium">{t("Tool")}</th><th className="pb-2 font-medium">{t("Use")}</th><th className="pb-2 pr-4 text-right font-medium">{t("Cost / month")}</th><th className="pb-2 font-medium">{t("Limits")}</th><th className="pb-2 font-medium">{t("Pricing")}</th><th className="pb-2 font-medium">{t("Projects")}</th></tr></thead>
            <tbody>{d.tools.map((x) => (
              <tr key={x.id} className="cursor-pointer border-t border-hairline align-top hover:bg-subtle/60" onClick={() => setEdit(x)}>
                <td className="py-2 pr-3"><span className="font-medium">{x.name}</span><span className="block text-[12px] text-text-3">{[x.provider, t(TOOL_STATUS[x.integration_status]), x.owner_founder ? FOUNDER_NAMES[x.owner_founder as "theo"] : ""].filter(Boolean).join(" · ")}</span></td>
                <td className="py-2 pr-3 text-[13px]">{x.use_case || "—"}{x.risk_notes ? <span className="block text-[12px] text-bad">{x.risk_notes}</span> : null}</td>
                <td className="num py-2 pr-4 text-right">{formatMoney(x.monthly_cost_minor, x.currency)}</td>
                <td className="py-2 pr-3 text-[13px]">{x.usage_limits || "—"}</td>
                <td className="py-2 pr-3 text-[13px]">{[x.pricing_version, x.pricing_date].filter(Boolean).join(" · ") || "—"}</td>
                <td className="py-2 text-[13px]">{x.projects.join(", ") || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {edit ? <ToolForm x={edit === "new" ? null : edit} projects={d.projects} onClose={() => setEdit(null)} /> : null}
    </Panel>
  );
}

function ToolForm({ x, projects, onClose }: { x: Tool | null; projects: Data["projects"]; onClose: () => void }) {
  const t = useT();
  const [id] = React.useState(() => x?.id ?? crypto.randomUUID());
  const [f, setF] = React.useState({ name: x?.name ?? "", provider: x?.provider ?? "", use_case: x?.use_case ?? "", apis: x?.apis ?? "", integration_status: x?.integration_status ?? "planned", cost: x ? String(x.monthly_cost_minor / 100) : "", currency: x?.currency ?? "EUR", usage_limits: x?.usage_limits ?? "", pricing_version: x?.pricing_version ?? "", pricing_date: x?.pricing_date ?? "", owner_founder: x?.owner_founder ?? "", environment: x?.environment ?? "production", risk_notes: x?.risk_notes ?? "", expense_category: x?.expense_category ?? "software", linked: x?.linked_project_ids ?? [] as string[] });
  const m = useSave("/api/clients/tools", x ? "PATCH" : "POST", onClose);
  const body = { name: f.name, provider: f.provider, use_case: f.use_case, apis: f.apis, integration_status: f.integration_status, monthly_cost_eur: Number(f.cost.replace(",", ".")) || 0, currency: f.currency || "EUR", usage_limits: f.usage_limits, pricing_version: f.pricing_version, pricing_date: f.pricing_date, owner_founder: f.owner_founder || null, environment: f.environment, risk_notes: f.risk_notes, expense_category: f.expense_category, linked_project_ids: f.linked };
  const inp = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <Field label={t(label)} htmlFor={`tf-${k}`}><Input id={`tf-${k}`} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></Field>;
  return (
    <Modal wide open onOpenChange={(o) => !o && onClose()} title={x ? x.name : t("Add a tool")} description={t("Third-party software or AI provider: its price, limits and the date of that price.")}>
      <form className="grid grid-cols-2 gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(x ? { id, expected_version: x.version, patch: body } : { id, tool: body }); }}>
        {inp("name", "Product", { required: true, maxLength: 200 })}{inp("provider", "Provider")}{inp("use_case", "Use case")}
        {inp("apis", "APIs and integration")}
        <Field label={t("Integration status")} htmlFor="tf-st"><Select id="tf-st" value={f.integration_status} onChange={(e) => setF({ ...f, integration_status: e.target.value })}>{Object.entries(TOOL_STATUS).map(([a, b]) => <option key={a} value={a}>{t(b)}</option>)}</Select></Field>
        {inp("cost", "Cost per month", { inputMode: "decimal" })}{inp("currency", "Currency", { maxLength: 3 })}{inp("usage_limits", "Token / call / minute limits")}{inp("pricing_version", "Pricing version")}
        {inp("pricing_date", "Pricing date", { type: "date" })}
        <Field label={t("Owner")} htmlFor="tf-ow"><Select id="tf-ow" value={f.owner_founder} onChange={(e) => setF({ ...f, owner_founder: e.target.value })}><option value="">—</option>{FOUNDERS.map((o) => <option key={o} value={o}>{FOUNDER_NAMES[o]}</option>)}</Select></Field>
        <Field label={t("Environment")} htmlFor="tf-env"><Select id="tf-env" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}><option value="production">{t("Production")}</option><option value="test">{t("Test")}</option><option value="both">{t("Both")}</option></Select></Field>
        <Field label={t("Money category")} htmlFor="tf-cat"><Select id="tf-cat" value={f.expense_category} onChange={(e) => setF({ ...f, expense_category: e.target.value })}>{BANK_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>)}</Select></Field>
        <Field label={t("Linked projects")} htmlFor="tf-pj" className="col-span-2 sm:col-span-3">
          <Select id="tf-pj" multiple className="h-24" value={f.linked} onChange={(e) => setF({ ...f, linked: [...e.target.selectedOptions].map((o) => o.value) })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
        <Field label={t("Risk and privacy notes")} htmlFor="tf-risk" className="col-span-2 sm:col-span-3"><Textarea id="tf-risk" value={f.risk_notes} onChange={(e) => setF({ ...f, risk_notes: e.target.value })} maxLength={1_000} /></Field>
        <Button type="submit" variant="primary" className="col-span-2 sm:col-span-3" disabled={!f.name.trim() || m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Modal>
  );
}

function Agents({ d }: { d: Data }) {
  const t = useT();
  const [edit, setEdit] = React.useState<Agent | "new" | null>(null);
  return (
    <Panel>
      <div className="mb-4 flex justify-end"><Button variant="primary" onClick={() => setEdit("new")}><Plus /> {t("Add a template")}</Button></div>
      {d.agents.length === 0 ? <EmptyState title={t("No template yet")}>{t("Record the agents and workflows you reuse from one client to the next, with the tools they rely on.")}</EmptyState> : (
        <ul className="flex flex-col">{d.agents.map((a) => (
          <li key={a.id}><button type="button" onClick={() => setEdit(a)} className="flex w-full flex-col gap-0.5 border-t border-hairline py-2 text-left first:border-t-0 hover:bg-subtle/60">
            <span className="text-sm font-medium">{a.name} <span className="font-normal text-text-3">· {t(a.kind === "agent" ? "Agent" : "Workflow")} · {t(AGENT_STATUS[a.status])}</span></span>
            <span className="text-[13px] text-text-2">{a.purpose || "—"}</span>
            <span className="text-[12px] text-text-3">{[a.tools.length ? `${t("Tools")}: ${a.tools.join(", ")}` : "", a.projects.length ? `${t("Projects")}: ${a.projects.join(", ")}` : ""].filter(Boolean).join(" · ")}</span>
          </button></li>
        ))}</ul>
      )}
      {edit ? <AgentForm a={edit === "new" ? null : edit} d={d} onClose={() => setEdit(null)} /> : null}
    </Panel>
  );
}

function AgentForm({ a, d, onClose }: { a: Agent | null; d: Data; onClose: () => void }) {
  const t = useT();
  const [id] = React.useState(() => a?.id ?? crypto.randomUUID());
  const [f, setF] = React.useState({ name: a?.name ?? "", kind: a?.kind ?? "workflow", purpose: a?.purpose ?? "", stack: a?.stack ?? "", inputs: a?.inputs ?? "", outputs: a?.outputs ?? "", status: a?.status ?? "draft", owner_founder: a?.owner_founder ?? "", notes: a?.notes ?? "", tools: a?.linked_tool_ids ?? [] as string[], projects: a?.linked_project_ids ?? [] as string[] });
  const m = useSave("/api/clients/agents", a ? "PATCH" : "POST", onClose);
  const body = { name: f.name, kind: f.kind, purpose: f.purpose, stack: f.stack, inputs: f.inputs, outputs: f.outputs, status: f.status, owner_founder: f.owner_founder || null, notes: f.notes, linked_tool_ids: f.tools, linked_project_ids: f.projects };
  const inp = (k: "name" | "stack" | "inputs" | "outputs", label: string) => <Field label={t(label)} htmlFor={`af-${k}`}><Input id={`af-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={k === "name" ? 200 : 500} required={k === "name"} /></Field>;
  return (
    <Modal wide open onOpenChange={(o) => !o && onClose()} title={a ? a.name : t("Add a template")} description={t("An internal, reusable agent or workflow template.")}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(a ? { id, expected_version: a.version, patch: body } : { id, agent: body }); }}>
        {inp("name", "Name")}
        <Field label={t("Kind")} htmlFor="af-kind"><Select id="af-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="workflow">{t("Workflow")}</option><option value="agent">{t("Agent")}</option></Select></Field>
        <Field label={t("Purpose")} htmlFor="af-p" className="col-span-2"><Textarea id="af-p" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} maxLength={1_000} /></Field>
        {inp("stack", "Stack")}{inp("inputs", "Inputs")}{inp("outputs", "Outputs")}
        <Field label={t("Status")} htmlFor="af-st"><Select id="af-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(AGENT_STATUS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select></Field>
        <Field label={t("Tools used")} htmlFor="af-tools"><Select id="af-tools" multiple className="h-24" value={f.tools} onChange={(e) => setF({ ...f, tools: [...e.target.selectedOptions].map((o) => o.value) })}>{d.tools.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label={t("Linked projects")} htmlFor="af-pj"><Select id="af-pj" multiple className="h-24" value={f.projects} onChange={(e) => setF({ ...f, projects: [...e.target.selectedOptions].map((o) => o.value) })}>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label={t("Owner")} htmlFor="af-ow"><Select id="af-ow" value={f.owner_founder} onChange={(e) => setF({ ...f, owner_founder: e.target.value })}><option value="">—</option>{FOUNDERS.map((o) => <option key={o} value={o}>{FOUNDER_NAMES[o]}</option>)}</Select></Field>
        <Field label={t("Notes")} htmlFor="af-n" className="col-span-2"><Textarea id="af-n" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2_000} /></Field>
        <Button type="submit" variant="primary" className="col-span-2" disabled={!f.name.trim() || m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Modal>
  );
}
