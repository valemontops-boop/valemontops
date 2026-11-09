"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Panel, PanelTitle, Skeleton } from "@/components/ui/form";
import { addDays, localDate } from "@/domain/time";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { relTime } from "@/lib/utils";
import type { trackerStatus } from "@/server/services/tracker";

type Status = Awaited<ReturnType<typeof trackerStatus>>;
type Result = { sent: number; failed: number; total: number; stopped?: boolean };

/** Settings › My tracker: connection status (never a secret), what is sent, test event, period backfill, feed path. */
export function TrackerPanel() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tracker"], queryFn: () => api<Status>("/api/tracker") });
  const today = React.useMemo(() => localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris"), []);
  const [from, setFrom] = React.useState(addDays(today, -29));
  const [to, setTo] = React.useState(today);
  const act = useMutation({
    mutationFn: (body: Record<string, string>) => api<Result>("/api/tracker", { body }),
    onSuccess: (r) => {
      if (r.failed) toast.error(t("{sent} sent, {failed} failed.", { sent: r.sent, failed: r.failed }));
      else toast.success(t("{sent} sent to your tracker.", { sent: r.sent }));
      qc.invalidateQueries({ queryKey: ["tracker"] });
    },
    onError: (e) => toast.error(t((e as Error).message)),
  });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const live = s.mode === "live";
  const canSend = live && s.configured;
  return (
    <Panel>
      <PanelTitle>{t("My tracker")}</PanelTitle>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-text-2">{t("Connect your personal performance app: every activity you log here is sent to it, and it can also read your activity.")}</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-text-3">{t("Sending (webhook)")}</dt>
          <dd className="font-medium">{s.configured ? `${t("Connected to")} ${s.host ?? ""}` : t("Not configured")}{s.problem ? <span className="ml-2 font-normal text-bad">{t(s.problem)}</span> : null}</dd>
          <dt className="text-text-3">{t("Reading (feed)")}</dt>
          <dd className="font-medium">{s.feedConfigured ? t("Token set") : t("Not configured")} · <code className="font-mono text-[13px]">GET {s.feedPath}?from=…&amp;to=…</code></dd>
          <dt className="text-text-3">{t("Day summary")}</dt>
          <dd>{s.dailySummary ? t("Sent when you save your daily review") : t("Not enabled")}</dd>
          <dt className="text-text-3">{t("Last delivery")}</dt>
          <dd>{s.last ? (s.last.status === "ok" ? `${t("OK")} · ${s.last.at ? t(relTime(s.last.at)) : ""}` : <span className="text-bad">{t(s.last.error || "Failed")}</span>) : t("Nothing sent yet")}</dd>
        </dl>
        {!live ? <p className="rounded-xl bg-subtle px-3 py-2 text-[13px] text-text-2">{t("DEMO data is never sent to your tracker. Connect it on the live app.")}</p> : null}
        <div>
          <p className="mb-1 font-medium">{t("What is sent")}</p>
          <p className="text-text-2">{t("For each activity: type, date and time, channel, outcome, business name, call duration, project Valemont. Never a phone number, an email or a contact's name.")}</p>
          <p className="mt-1 font-mono text-[12px] text-text-3">{s.fields.join(" · ")}</p>
        </div>
        <div>
          <p className="mb-1 font-medium">{t("Setup")}</p>
          <p className="text-text-2">{t("Set these variables in the host's settings (never in a sheet or in chat), then redeploy:")}</p>
          <p className="mt-1 font-mono text-[12px] text-text-3">{[s.envNames.url, s.envNames.secret, s.envNames.feed, s.envNames.summary].join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!canSend || act.isPending} onClick={() => act.mutate({ action: "test" })}>{t("Send a test event")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={!canSend || act.isPending} onClick={() => act.mutate({ action: "summary" })}>{t("Send today's summary")}</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
          <Field label={t("Start date")} htmlFor="tracker-from"><Input id="tracker-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t("End date")} htmlFor="tracker-to"><Input id="tracker-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button type="button" size="sm" disabled={!canSend || act.isPending || !from || !to || from > to} onClick={() => act.mutate({ action: "backfill", from, to })}>{act.isPending ? t("Sending…") : t("Send this period")}</Button>
        </div>
        <p className="text-[13px] text-text-3">{t("Sending a period again is safe: each activity keeps the same key, so your tracker can ignore duplicates.")}</p>
      </div>
    </Panel>
  );
}
