"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, RotateCcw } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { FOUNDERS, FOUNDER_NAMES } from "@/domain/constants";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { useMe } from "./providers";

type RunResult = { status: "done" | "failed" | "running"; failedStep: string | null; error: string; runId: string; steps: Record<string, { ids: string[] }> };

/**
 * Won → Client & Project in one click (spec 5.7, through WorkflowRuns 4.4). The short handoff (what was promised,
 * stakeholders, success criteria) is asked once; a retry finishes the same run and never duplicates the client or project.
 */
export function WonDialog({ opportunityId, name, onClose, onDone }: { opportunityId: string; name: string; onClose: () => void; onDone: (projectId: string | null) => void }) {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const [v, setV] = React.useState({ promised: "", stakeholders: "", success: "", start_date: "", owner_founder: me.founder as string });
  const m = useMutation({
    mutationFn: () => api<RunResult>("/api/clients/won", { body: { opportunity_id: opportunityId, ...v, owner_founder: v.owner_founder || null } }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      if (r.status === "done") { toast(t("Client and project ready")); onDone(r.steps.project?.ids[0] ?? null); }
      else toast(t("Stopped at step {step}: {error}. Nothing is duplicated: resume to finish.", { step: t(r.failedStep ?? ""), error: t(r.error) }));
    },
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("Create client & project")} description={t("{name}: the client, the project (services, milestones, checklist, budget, costs) and a kick-off task are created together.", { name })}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("What was promised")} htmlFor="won-p"><Textarea id="won-p" value={v.promised} onChange={(e) => setV({ ...v, promised: e.target.value })} maxLength={2_000} /></Field>
        <Field label={t("Stakeholders")} htmlFor="won-s"><Input id="won-s" value={v.stakeholders} onChange={(e) => setV({ ...v, stakeholders: e.target.value })} maxLength={1_000} /></Field>
        <Field label={t("Success criteria")} htmlFor="won-c"><Input id="won-c" value={v.success} onChange={(e) => setV({ ...v, success: e.target.value })} maxLength={1_000} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Start")} htmlFor="won-d"><Input id="won-d" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></Field>
          <Field label={t("Project owner")} htmlFor="won-o"><Select id="won-o" value={v.owner_founder} onChange={(e) => setV({ ...v, owner_founder: e.target.value })}>{FOUNDERS.map((f) => <option key={f} value={f}>{FOUNDER_NAMES[f]}</option>)}</Select></Field>
        </div>
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? t("Creating…") : t("Create client & project")}</Button>
      </form>
    </Modal>
  );
}

/** CRM: shown on a WON deal. Opens the dialog, or links to the project, or resumes an interrupted run. */
export function WonToProject({ opportunityId, name }: { opportunityId: string; name: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const q = useQuery({ queryKey: ["clients", "won", opportunityId], queryFn: () => api<{ status: "none" | "running" | "failed" | "done"; projectId: string | null }>(`/api/clients/won?opportunity_id=${opportunityId}`) });
  const resume = useMutation({ mutationFn: () => api<RunResult>("/api/clients/won", { body: { opportunity_id: opportunityId } }), onSuccess: (r) => { qc.invalidateQueries(); toast(r.status === "done" ? t("Client and project ready") : t("Stopped at step {step}: {error}. Nothing is duplicated: resume to finish.", { step: t(r.failedStep ?? ""), error: t(r.error) })); } });
  if (!q.data) return null;
  if (q.data.status === "done") return <Button asChild variant="outline" size="sm" className="self-start"><Link href={`/clients?project=${q.data.projectId ?? ""}`}><Briefcase /> {t("Open the project")}</Link></Button>;
  if (q.data.status !== "none") return <Button variant="dark" size="sm" className="self-start" disabled={resume.isPending} onClick={() => resume.mutate()}><RotateCcw /> {t("Resume client & project creation")}</Button>;
  return (
    <>
      <Button variant="primary" size="sm" className="self-start" onClick={() => setOpen(true)}><Briefcase /> {t("Create client & project")}</Button>
      {open ? <WonDialog opportunityId={opportunityId} name={name} onClose={() => setOpen(false)} onDone={() => setOpen(false)} /> : null}
    </>
  );
}
