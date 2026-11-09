"use client";
/**
 * Deal workspace (Stage 2A, D074): from an opportunity, the audit questionnaire and its summary, the quote builder
 * (price book, policy, taxes, versions, PDF, Drive) and the discovery-call / audit note templates.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCopy, FileText } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/react";
import { FOUNDER_NAMES, STAGE_LABELS, type FounderKey } from "@/domain/constants";
import {
  COMPLEXITIES, COMPLEXITY_LABELS, NOTE_TEMPLATES, SECTORS, SECTOR_LABELS, SUMMARY_SECTIONS, SUMMARY_SECTION_LABELS, fillNote, auditProgress,
  type AuditLanguage, type AuditQuestion, type Sector,
} from "@/domain/audit";
import type { dealWorkspace } from "@/server/services/quotes";
import { useMe } from "./providers";
import { RecordFiles } from "./files-view";
import { QuoteWorkspace } from "./quote-editor";

export type Workspace = Awaited<ReturnType<typeof dealWorkspace>>;
type Audit = Workspace["audits"][number];

export function useWorkspace(oppId: string | null) {
  return useQuery({ queryKey: ["deal", oppId], enabled: Boolean(oppId), queryFn: () => api<Workspace>(`/api/quotes?opportunity_id=${oppId}`) });
}

export function DealView() {
  const t = useT();
  const params = useSearchParams();
  const oppId = params.get("opp");
  const [tab, setTab] = React.useState<"audit" | "quote" | "notes">(params.get("tab") === "quote" ? "quote" : "audit");
  const ws = useWorkspace(oppId);
  if (!oppId) return <EmptyState title={t("Choose a deal in the CRM first.")} action={<Button asChild variant="outline"><Link href="/crm">{t("Sales CRM")}</Link></Button>} />;
  if (ws.isPending) return <div className="flex flex-col gap-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  if (ws.isError) return <ErrorState error={ws.error} onRetry={() => ws.refetch()} />;
  const d = ws.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/crm?account=${d.opportunity.account_id}`} className="inline-flex items-center gap-1 text-[13px] text-text-2 hover:text-ink"><ArrowLeft className="size-4" />{t("Sales CRM")}</Link>
          <h1 className="text-2xl font-semibold tracking-tight">{d.account?.name ?? d.opportunity.name}</h1>
          <p className="text-[13px] text-text-2">{[t(STAGE_LABELS[d.opportunity.stage]), d.account?.country, d.account?.niche].filter(Boolean).join(" · ")}</p>
        </div>
        <SegmentedSwitch label={t("Deal workspace")} value={tab} onChange={setTab} options={[{ value: "audit", label: t("Audit") }, { value: "quote", label: t("Quote") }, { value: "notes", label: t("Note templates") }]} />
      </div>
      {tab === "audit" ? <AuditTab ws={d} onQuote={() => setTab("quote")} /> : tab === "quote" ? <QuoteWorkspace ws={d} /> : <NotesTab ws={d} />}
      <RecordFiles recordType="opportunity" recordId={d.opportunity.id} />
    </div>
  );
}

/* ---------------- audit ---------------- */

function AuditTab({ ws, onQuote }: { ws: Workspace; onQuote: () => void }) {
  const t = useT();
  const [selected, setSelected] = React.useState<string | null>(ws.audits[0]?.id ?? null);
  const [starting, setStarting] = React.useState(ws.audits.length === 0);
  const audit = ws.audits.find((a) => a.id === selected) ?? ws.audits[0];
  if (starting || !audit) return <StartAudit ws={ws} onStarted={(id) => { setSelected(id); setStarting(false); }} onCancel={ws.audits.length ? () => setStarting(false) : undefined} />;
  return (
    <div className="flex flex-col gap-4">
      {ws.audits.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="audit-pick" className="text-[13px] text-text-2">{t("Audit")}</label>
          <Select id="audit-pick" className="h-9 w-auto" value={audit.id} onChange={(e) => setSelected(e.target.value)}>
            {ws.audits.map((a) => <option key={a.id} value={a.id}>{`${t(SECTOR_LABELS[a.sector])} · ${a.created_at.slice(0, 10)}`}</option>)}
          </Select>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <AuditForm key={audit.id + audit.version} audit={audit} onNew={() => setStarting(true)} />
        <AuditSummaryPanel audit={audit} onQuote={onQuote} />
      </div>
    </div>
  );
}

function StartAudit({ ws, onStarted, onCancel }: { ws: Workspace; onStarted: (id: string) => void; onCancel?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const guess: Sector = /garage|taller|auto/i.test(`${ws.account?.sector} ${ws.account?.niche}`) ? "garage" : /b[âa]timent|constru|plomb|fontan|chauff|electr|toit|climat/i.test(`${ws.account?.sector} ${ws.account?.niche}`) ? "building_trades" : "generic";
  const [sector, setSector] = React.useState<Sector>(guess);
  const [complexity, setComplexity] = React.useState<(typeof COMPLEXITIES)[number]>("simple");
  const [id] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: () => api<Audit>("/api/audits", { body: { id, opportunity_id: ws.opportunity.id, sector, complexity } }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["deal"] }); onStarted(a.id); },
  });
  return (
    <Panel>
      <PanelTitle>{t("Start the audit")}</PanelTitle>
      <form className="flex max-w-xl flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("Sector")} htmlFor="aud-sector">
          <Select id="aud-sector" value={sector} onChange={(e) => setSector(e.target.value as Sector)}>{SECTORS.map((s) => <option key={s} value={s}>{t(SECTOR_LABELS[s])}</option>)}</Select>
        </Field>
        <Field label={t("Depth")} htmlFor="aud-depth" hint={t("Questions come from the stored templates, in the client's language. Nothing is invented.")}>
          <Select id="aud-depth" value={complexity} onChange={(e) => setComplexity(e.target.value as typeof complexity)}>{COMPLEXITIES.map((c) => <option key={c} value={c}>{t(COMPLEXITY_LABELS[c])}</option>)}</Select>
        </Field>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Start the audit")}</Button>
          {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>{t("Cancel")}</Button> : null}
        </div>
      </form>
    </Panel>
  );
}

function AuditForm({ audit, onNew }: { audit: Audit; onNew: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [answers, setAnswers] = React.useState<Record<string, string>>(audit.answers);
  const [questions, setQuestions] = React.useState<AuditQuestion[]>(audit.questions);
  const [editing, setEditing] = React.useState(false);
  const dirty = JSON.stringify(answers) !== JSON.stringify(audit.answers) || JSON.stringify(questions) !== JSON.stringify(audit.questions);
  const m = useMutation({
    mutationFn: () => api<Audit>("/api/audits", { method: "PATCH", body: { id: audit.id, expected_version: audit.version, answers, questions } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deal"] }); toast(t("Saved")); setEditing(false); },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  const p = auditProgress(questions, answers);
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  return (
    <Panel>
      <PanelTitle action={<div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>{editing ? t("Done") : t("Edit questions")}</Button><Button size="sm" variant="ghost" onClick={onNew}>{t("New audit")}</Button></div>}>
        {t("Questionnaire")} <span className="num ml-2 text-[13px] font-normal text-text-2">{t("{n} of {total} answered", { n: p.answered, total: p.total })}</span>
      </PanelTitle>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {questions.map((q, i) => (
          <div key={q.key} className="flex flex-col gap-1.5 border-t border-hairline pt-3 first:border-t-0 first:pt-0">
            {editing ? (
              <div className="flex gap-2">
                <Input aria-label={t("Question {n}", { n: i + 1 })} value={q.text} onChange={(e) => setQuestions((qs) => qs.map((x) => (x.key === q.key ? { ...x, text: e.target.value } : x)))} />
                <Button type="button" size="sm" variant="ghost" disabled={questions.length <= 1} onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}>{t("Remove")}</Button>
              </div>
            ) : <label htmlFor={`aq-${q.key}`} className="text-sm font-medium">{q.text}</label>}
            <AnswerInput q={q} id={`aq-${q.key}`} value={answers[q.key] ?? ""} onChange={(v) => set(q.key, v)} />
          </div>
        ))}
        {editing && questions.length < 20 ? (
          <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setQuestions((qs) => [...qs, { key: `custom_${crypto.randomUUID().slice(0, 8)}`, topic: "pain_points", kind: "text", text: t("New question"), options: [], unit: "", rules: [] }])}>{t("Add a question")}</Button>
        ) : null}
        {err?.isConflict ? (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-bad">{t("Someone else changed this record. Review both versions.")} <Button type="button" size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["deal"] })}>{t("Reload")}</Button></p>
        ) : m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <div className="sticky bottom-2 flex items-center gap-3">
          <Button type="submit" variant="dark" disabled={!dirty || m.isPending}>{m.isPending ? t("Saving…") : t("Save answers")}</Button>
          {dirty ? <span className="text-[13px] text-text-2">{t("Unsaved changes")}</span> : <span className="text-[13px] text-text-3">{t("Saved. You can come back to it any time.")}</span>}
        </div>
      </form>
    </Panel>
  );
}

function AnswerInput({ q, id, value, onChange }: { q: AuditQuestion; id: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  if (q.kind === "yesno")
    return <SegmentedSwitch size="sm" label={q.text} value={(value || "unset") as "yes" | "no" | "unset"} onChange={(v) => onChange(v === "unset" ? "" : v)} options={[{ value: "yes", label: t("Yes") }, { value: "no", label: t("No") }, { value: "unset", label: t("Not asked") }]} />;
  if (q.kind === "choice")
    return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{q.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>;
  if (q.kind === "number")
    return <div className="flex items-center gap-2"><Input id={id} inputMode="decimal" className="num w-32" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))} />{q.unit ? <span className="text-[13px] text-text-2">{q.unit}</span> : null}</div>;
  return <Textarea id={id} className="min-h-16" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function AuditSummaryPanel({ audit, onQuote }: { audit: Audit; onQuote: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api("/api/audits/validate", { body: { id: audit.id, expected_version: audit.version } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deal"] }); toast(t("Saved")); },
  });
  const s = audit.summary;
  return (
    <Panel aria-label={t("Opportunity summary")}>
      <PanelTitle>{t("Opportunity summary")}</PanelTitle>
      <p className="mb-4 text-[13px] text-text-2">{t("Built from the answers and the template rules, without AI. Lines marked draft are suggestions to validate with the client.")}</p>
      {s ? SUMMARY_SECTIONS.filter((k) => k !== "facts" && s[k].length).map((k) => (
        <section key={k} className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold">{t(SUMMARY_SECTION_LABELS[k])}</h3>
          <ul className="flex flex-col gap-1.5">
            {s[k].map((i) => (
              <li key={i.text} className="flex items-start justify-between gap-3 text-sm">
                <span>{i.text}</span>
                {i.draft ? <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-[11px] text-text-2">{t("draft to validate")}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )) : null}
      {s?.facts.length ? (
        <details className="mb-4"><summary className="cursor-pointer text-sm font-semibold">{t(SUMMARY_SECTION_LABELS.facts)} ({s.facts.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-[13px] text-text-2">{s.facts.map((f) => <li key={f.text}>{f.text}</li>)}</ul>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
        {audit.validated_by ? <span className="text-[13px] text-good">{t("Validated by {name}", { name: FOUNDER_NAMES[audit.validated_by as FounderKey] })}</span> : <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>{t("Validate the summary")}</Button>}
        <Button size="sm" variant="outline" onClick={onQuote}><FileText /> {t("Go to the quote")}</Button>
      </div>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </Panel>
  );
}

/* ---------------- note templates ---------------- */

function NotesTab({ ws }: { ws: Workspace }) {
  const t = useT();
  const me = useMe();
  const locale = useLocale();
  const clientLang: AuditLanguage = ws.account?.country === "ES" ? "ES" : ws.account?.country === "FR" ? "FR" : locale === "fr" ? "FR" : "ES";
  const [lang, setLang] = React.useState<AuditLanguage>(clientLang);
  const [kind, setKind] = React.useState<"discovery" | "audit_report">("discovery");
  const contact = ws.contacts.find((c) => c.id === ws.opportunity.primary_contact_id) ?? ws.contacts[0];
  const text = fillNote(NOTE_TEMPLATES[kind][lang], { client: ws.account?.name ?? ws.opportunity.name, date: ws.today, contact: contact?.full_name ?? "", founder: FOUNDER_NAMES[me.founder as FounderKey] ?? "" });
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast(t("Copied")); } catch { toast.error(t("Copy failed: select the text and copy it.")); }
  };
  return (
    <Panel>
      <PanelTitle action={<Button size="sm" variant="outline" onClick={copy}><ClipboardCopy /> {t("Copy")}</Button>}>{t("Note templates")}</PanelTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <SegmentedSwitch size="sm" label={t("Template")} value={kind} onChange={setKind} options={[{ value: "discovery", label: t("Discovery call") }, { value: "audit_report", label: t("Client audit") }]} />
        <SegmentedSwitch size="sm" label={t("Language")} value={lang} onChange={setLang} options={[{ value: "FR", label: t("French") }, { value: "ES", label: t("Spanish") }]} />
      </div>
      <Textarea readOnly aria-label={t("Note templates")} value={text} className={cn("num min-h-96 font-mono text-[13px]")} />
      <p className="mt-2 text-[13px] text-text-3">{t("Paste it into your notes or a Google Doc; attach the document to the deal in Files.")}</p>
    </Panel>
  );
}
