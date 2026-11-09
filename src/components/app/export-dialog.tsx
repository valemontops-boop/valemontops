"use client";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, SegmentedSwitch } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { presetPeriod, type PeriodPreset } from "@/domain/export";
import { localDate } from "@/domain/time";
import { useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { useMe } from "./providers";

type Sprints = { progress: { sprint: { start_date: string; end_date: string } } | null };

/** "Export for AI": a period of our data as Markdown (default) or Excel, to send to Claude or another AI. */
export function ExportButton({ defaultScope = "team" }: { defaultScope?: "team" | "me" }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}><Download /> {t("Export for AI")}</Button>
      {open ? <ExportDialog defaultScope={defaultScope} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ExportDialog({ defaultScope, onClose }: { defaultScope: "team" | "me"; onClose: () => void }) {
  const t = useT();
  const me = useMe();
  const browserPreview = me.config.backend === "browser";
  const today = React.useMemo(() => localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris"), []);
  const sprints = useQuery({ queryKey: ["sprints"], queryFn: () => api<Sprints>("/api/sprints") });
  const sprint = sprints.data?.progress?.sprint ?? null;
  const [preset, setPreset] = React.useState<PeriodPreset>("30d");
  const [from, setFrom] = React.useState(presetPeriod("30d", today)!.from);
  const [to, setTo] = React.useState(today);
  const [scope, setScope] = React.useState<"team" | "me">(defaultScope);
  const [format, setFormat] = React.useState<"md" | "xlsx">("md");
  const [busy, setBusy] = React.useState(false);
  const period = presetPeriod(preset, today, { sprint, from, to });

  const choose = (p: PeriodPreset) => {
    setPreset(p);
    const r = presetPeriod(p, today, { sprint, from, to });
    if (r && p !== "custom") { setFrom(r.from); setTo(r.to); }
  };

  const download = async () => {
    if (!period) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/export?from=${period.from}&to=${period.to}&scope=${scope}&format=${format}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? t("The export failed. Retry."));
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `valemont-${period.from}_${period.to}.${format}`;
      const blob = await res.blob();
      // Inside the claude.ai preview viewer, plain downloads are blocked: hand the file over through its downloads capability.
      const host = (window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (f: { filename: string; data: Blob }) => Promise<unknown> } | null> } }).claude;
      const saver = host?.use ? await host.use("downloads").catch(() => null) : null;
      if (saver) {
        try { await saver.save({ filename: name, data: blob }); toast.success(`${t("File downloaded")}: ${name}`); onClose(); }
        catch (err) { if ((err as { code?: string }).code !== "declined") toast.error(t("The export failed. Retry.")); }
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(`${t("File downloaded")}: ${name}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).name === "TimeoutError" ? t("The export failed. Retry.") : t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={t("Export for AI analysis")} description={t("A file to send to Claude or another AI: our numbers over the period, without prospects' phone numbers or emails.")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">{t("Period")}</span>
          <div className="flex flex-wrap gap-2">
            <SegmentedSwitch size="sm" label={t("Period")} value={preset} onChange={choose} options={[
              { value: "7d", label: t("7 days") }, { value: "30d", label: t("30 days") }, { value: "month", label: t("This month") },
              ...(sprint ? [{ value: "sprint" as const, label: t("Sprint") }] : []), { value: "custom", label: t("Custom") },
            ]} />
          </div>
          {preset === "custom" ? (
            <div className="mt-1 grid grid-cols-2 gap-3">
              <Field label={t("Start date")} htmlFor="export-from"><Input id="export-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={t("End date")} htmlFor="export-to"><Input id="export-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
          ) : period ? <span className="text-[13px] text-text-3">{period.from} → {period.to}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">{t("Scope")}</span>
          <SegmentedSwitch size="sm" label={t("Scope")} value={scope} onChange={setScope} options={[{ value: "team", label: t("Team") }, { value: "me", label: t("Only my data") }]} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">{t("Format")}</span>
          <SegmentedSwitch size="sm" label={t("Format")} value={format} onChange={setFormat} options={[{ value: "md", label: t("Markdown (for AI)") }, ...(browserPreview ? [] : [{ value: "xlsx" as const, label: t("Excel") }])]} />
          {browserPreview ? <span className="text-[13px] text-text-3">{t("Excel export is available in the installed app, not in this browser preview.")}</span> : null}
        </div>
        <p className="text-[13px] text-text-2">{t("Included: activity, conversions by channel, objections, calls, messages, pipeline, tasks, content, audience, money, verdicts and weekly reviews, then questions to ask the AI.")}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button type="button" variant="dark" disabled={!period || busy} onClick={download}><Download /> {busy ? t("Preparing…") : t("Download")}</Button>
        </div>
      </div>
    </Modal>
  );
}
