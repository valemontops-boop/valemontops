"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Input, Panel, Select, Skeleton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { BRAND_LABELS, FOUNDER_NAMES } from "@/domain/constants";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMe } from "./providers";

type Idea = { id: string; version: number; text: string; note: string; brand: string | null; category: string; status: string; votes: Record<string, string>; reason: string; created_by_founder: string; converted_type: string | null };
type Resp = { ideas: Idea[]; sprintActive: boolean; testingLimit: number };
const VOTE_LABEL: Record<string, string> = { yes: "Yes", maybe: "Maybe", no: "No" };
const STATUSES = [["new", "New"], ["discuss", "Discuss"], ["testing", "Testing"], ["parked", "Parked"], ["done", "Done"], ["rejected", "Rejected"]] as const;

export function IdeasView() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ideas"], queryFn: () => api<Resp>("/api/ideas") });
  const [text, setText] = React.useState("");
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const add = useMutation({ mutationFn: () => api("/api/ideas", { body: { id, text } }), onSuccess: () => { setText(""); setId(crypto.randomUUID()); qc.invalidateQueries({ queryKey: ["ideas"] }); } });
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Idea Box")}</h1>
        <p className="text-sm text-text-2">{t("Park ideas so they don't interrupt the work in progress. Press I anywhere to capture one. Discuss them in a founder point.")}</p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <Input aria-label={t("New idea")} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("One line is enough")} maxLength={300} />
        <Button type="submit" variant="primary" disabled={!text.trim() || add.isPending}>{add.isPending ? t("Saving…") : t("Add idea")}</Button>
      </form>
      {add.isError ? <ErrorState error={add.error} onRetry={() => add.mutate()} /> : null}
      {q.isPending ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {q.data.sprintActive ? <p className="text-[13px] text-text-2">{t("Sprint active: at most {n} ideas in Testing.", { n: q.data.testingLimit })}</p> : null}
          {STATUSES.map(([s, label]) => {
            const items = q.data.ideas.filter((i) => i.status === s);
            if (!items.length) return null;
            return (
              <Panel key={s} aria-label={t(label)} className="py-3">
                <h2 className="mb-1 text-sm font-semibold">{t(label)} <span className="num font-normal text-text-3">{items.length}</span></h2>
                <ul>{items.map((i) => <IdeaRow key={i.id + i.version} idea={i} />)}</ul>
              </Panel>
            );
          })}
        </>
      )}
    </div>
  );
}

function IdeaRow({ idea }: { idea: Idea }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const [reasonFor, setReasonFor] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [park, setPark] = React.useState<{ candidates: { id: string; text: string }[]; status: string } | null>(null);
  const upd = useMutation({
    mutationFn: (b: Record<string, unknown>) => api<{ needsPark: boolean; candidates?: { id: string; text: string }[] }>("/api/ideas", { method: "PATCH", body: { id: idea.id, expected_version: idea.version, ...b } }),
    onSuccess: (r, b) => {
      if (r.needsPark) setPark({ candidates: r.candidates ?? [], status: String(b.status) });
      else { setPark(null); setReasonFor(null); qc.invalidateQueries({ queryKey: ["ideas"] }); }
    },
    onError: (e) => toast((e as Error).message),
  });
  const conv = useMutation({ mutationFn: (to: string) => api<{ type: string }>("/api/ideas/convert", { body: { id: idea.id, expected_version: idea.version, to, owner: me.founder } }), onSuccess: (r) => { qc.invalidateQueries(); toast(r.type === "task" ? t("Task created") : t("Business and opportunity created")); } });
  const setStatus = (s: string) => (s === "parked" || s === "rejected" ? setReasonFor(s) : upd.mutate({ status: s }));
  return (
    <li className="flex flex-col gap-2 border-t border-hairline py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{idea.text}</p>
          <p className="text-[12px] text-text-3">{FOUNDER_NAMES[idea.created_by_founder as "theo"]}{idea.brand ? ` · ${t(BRAND_LABELS[idea.brand as "local"])}` : ""} · {t(idea.category)}{idea.reason ? ` · ${idea.reason}` : ""}{idea.converted_type ? ` · ${t(`converted to ${idea.converted_type}`)}` : ""}</p>
        </div>
        <Select aria-label={t("Status")} value={idea.status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-32 text-[13px]">{STATUSES.map(([s, l]) => <option key={s} value={s}>{t(l)}</option>)}</Select>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["yes", "maybe", "no"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={idea.votes[me.founder] === v} onClick={() => upd.mutate({ vote: v })} className={cn("h-8 rounded-full border px-3 text-[13px]", idea.votes[me.founder] === v ? "border-ink bg-ink text-panel" : "border-hairline text-text-2 hover:bg-subtle")}>{t(VOTE_LABEL[v])}</button>
        ))}
        <span className="text-[12px] text-text-3">{Object.entries(idea.votes).filter(([f]) => f !== me.founder).map(([f, v]) => `${FOUNDER_NAMES[f as "theo"]}: ${t(VOTE_LABEL[v] ?? v)}`).join(" · ")}</span>
        {!idea.converted_type ? <span className="ml-auto flex gap-1.5"><Button size="sm" variant="ghost" onClick={() => conv.mutate("task")} disabled={conv.isPending}>→ {t("Task")}</Button><Button size="sm" variant="ghost" onClick={() => conv.mutate("opportunity")} disabled={conv.isPending}>→ {t("Opportunity")}</Button></span> : null}
      </div>
      {reasonFor ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) upd.mutate({ status: reasonFor, reason }); }}>
          <Input aria-label={t("Reason")} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(`Why ${reasonFor}?`)} />
          <Button type="submit" size="md" variant="outline" disabled={!reason.trim()}>{t("Save")}</Button>
        </form>
      ) : null}
      <Modal open={Boolean(park)} onOpenChange={(o) => !o && setPark(null)} title={t("Park one idea first")} description={t("During a sprint, only a few ideas are tested at once. Which one waits?")}>
        <ul className="flex flex-col gap-2">{park?.candidates.map((c) => <li key={c.id}><Button variant="outline" className="w-full justify-start" onClick={() => upd.mutate({ status: park.status, park_id: c.id })}>{t("Park “{text}”", { text: c.text })}</Button></li>)}</ul>
      </Modal>
    </li>
  );
}
