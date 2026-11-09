"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import type { HubAction, HubStatus, IntegrationKey, IntegrationMode } from "@/domain/integrations";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { Pill, fmtDateTime } from "./bits";

type Item = {
  key: IntegrationKey; name: string; does: string; mode: IntegrationMode; status: HubStatus; scopes: string[]; note: string; docs: string; href: string | null;
  env: { name: string; required: boolean; set: boolean }[]; lastSync: string | null; lastError: string; lastErrorAt: string | null; expiresAt: string | null; daysLeft: number | null;
  detail: string; detailVars: Record<string, string>; actions: HubAction[];
};
type Hub = { mode: "live" | "demo"; items: Item[]; counts: Record<"connected" | "not_configured" | "error" | "needs_renewal", number> };
type TestResult = { ok: boolean; message: string; vars: Record<string, string>; error: string };

const STATUS_LABEL: Record<HubStatus, string> = {
  connected: "Connected service", not_configured: "Not configured", error: "Error", needs_renewal: "Needs renewal", import_only: "Import only", pending_approval: "Awaiting approval", demo: "Demo, simulated",
};
const STATUS_TONE: Record<HubStatus, "good" | "bad" | "neutral" | "dark"> = { connected: "good", not_configured: "neutral", error: "bad", needs_renewal: "bad", import_only: "neutral", pending_approval: "neutral", demo: "neutral" };
const MODE_LABEL: Record<IntegrationMode, string> = {
  two_way: "Read and write", sign_in: "Sign-in", read_only: "Read-only", send_only: "Send only", import: "Import (files)", webhook_in: "Incoming webhook", webhook_out: "Outgoing webhook", scheduler: "Scheduled job",
};
const REAUTH: Partial<Record<IntegrationKey, string>> = { gmail: "/api/auth/google/gmail?back=/settings", drive: "/api/auth/google/drive?back=/settings" };

/**
 * Settings › Integrations (spec 7, Stage 4A, D083): the honest capability matrix. Status from the server only;
 * env variables are listed by name with "set" / "missing", never their values.
 */
export function IntegrationsHub() {
  const t = useT();
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api<Hub>("/api/integrations") });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  return (
    <div className="flex flex-col gap-5" data-testid="integrations-hub">
      <Panel>
        <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => q.refetch()}>{t("Refresh")}</Button>}>{t("Integrations")}</PanelTitle>
        {h.mode === "demo" ? <p className="mb-3 rounded-[12px] bg-subtle p-3 text-[13px] text-text-2">{t("DEMO: no real account is connected. Statuses below say “Demo, simulated”; tests answer from demo data.")}</p> : null}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["connected", "not_configured", "error", "needs_renewal"] as const).map((k) => (
            <div key={k} className="rounded-[12px] bg-subtle px-3 py-2"><dt className="text-[12px] text-text-3">{t(STATUS_LABEL[k])}</dt><dd className={`num text-xl font-semibold ${k === "error" || k === "needs_renewal" ? (h.counts[k] ? "text-bad" : "") : ""}`}>{h.counts[k]}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-text-3">{t("Secrets stay in the host's environment settings: this page shows only whether each variable is set. Guides: docs/INTEGRATIONS.md.")}</p>
      </Panel>
      <Panel className="p-0">
        <ul className="divide-y divide-hairline">{h.items.map((it) => <HubRow key={it.key} it={it} />)}</ul>
      </Panel>
    </div>
  );
}

function HubRow({ it }: { it: Item }) {
  const t = useT();
  const tag = useDateTag();
  const qc = useQueryClient();
  const [result, setResult] = React.useState<TestResult | null>(null);
  const act = useMutation({
    mutationFn: (a: "test" | "sync") => api<TestResult>(`/api/integrations/${a}`, { body: { key: it.key } }),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["integrations"] }); },
    onError: () => setResult(null),
  });
  const missing = it.env.filter((e) => e.required && !e.set);
  return (
    <li className="flex flex-col gap-2 px-5 py-4" data-testid={`integration-${it.key}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{t(it.name)}</span>
        <Pill tone={STATUS_TONE[it.status]}>{t(STATUS_LABEL[it.status])}</Pill>
        <span className="text-[12px] text-text-3">{t(MODE_LABEL[it.mode])}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          {it.actions.includes("test") ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("test")}>{t("Test connection")}</Button> : null}
          {it.actions.includes("sync") ? <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("sync")}>{t("Sync now")}</Button> : null}
          {it.actions.includes("reauthorize") && REAUTH[it.key] ? <Button asChild size="sm" variant="outline"><a href={REAUTH[it.key]}>{it.status === "connected" ? t("Authorize again") : t("Authorize")}</a></Button> : null}
          {it.href ? <Button asChild size="sm" variant="ghost"><a href={it.href}>{t("Open")}</a></Button> : null}
        </span>
      </div>
      <p className="text-sm text-text-2">{t(it.does)}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[160px_1fr]">
        {it.detail ? <><dt className="text-text-3">{t("Detail")}</dt><dd>{t(it.detail, it.detailVars)}</dd></> : null}
        <dt className="text-text-3">{it.mode === "import" ? t("Last import") : t("Last sync")}</dt><dd>{it.lastSync ? fmtDateTime(it.lastSync, undefined, tag) : t("never")}</dd>
        {it.status === "error" ? <><dt className="text-text-3">{t("Last error")}</dt><dd className="text-bad">{it.lastErrorAt ? `${fmtDateTime(it.lastErrorAt, undefined, tag)} · ` : ""}{it.lastError || t("unknown error")}</dd></> : null}
        {it.daysLeft !== null ? <><dt className="text-text-3">{t("Token expiry")}</dt><dd className={it.daysLeft <= 14 ? "text-bad" : ""}>{it.daysLeft < 0 ? t("expired") : t("{n} days left", { n: String(it.daysLeft) })}</dd></> : null}
        {it.scopes.length ? <><dt className="text-text-3">{t("Permissions")}</dt><dd className="font-mono text-[12px]">{it.scopes.map((x) => t(x)).join(" · ")}</dd></> : null}
        {it.env.length ? (
          <><dt className="text-text-3">{t("Environment variables")}</dt>
            <dd className="flex flex-wrap gap-1.5">{it.env.map((e) => (
              <span key={e.name} className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${e.set ? "bg-[#e6f2ec] text-good" : e.required ? "bg-[#fbeceb] text-bad" : "bg-subtle text-text-3"}`}>
                {e.name} · {e.set ? t("set") : e.required ? t("missing") : t("optional")}
              </span>
            ))}</dd></>
        ) : null}
        <dt className="text-text-3">{t("Guide")}</dt><dd><span className="font-mono text-[12px]">{it.docs.split("#")[0]}</span> · {t(it.name)}</dd>
      </dl>
      {it.note ? <p className="text-[13px] text-text-3">{t(it.note)}</p> : null}
      {it.status === "not_configured" && missing.length ? <p className="text-[13px] text-text-2">{t("To connect: set {vars} in the host's environment, then redeploy.", { vars: missing.map((e) => e.name).join(", ") })}</p> : null}
      {act.isError ? <ErrorState error={act.error} /> : null}
      {result ? <p role="status" className={`text-[13px] ${result.ok ? "text-good" : "text-bad"}`}>{t(result.message, result.vars)}{result.error ? ` · ${result.error}` : ""}</p> : null}
    </li>
  );
}
