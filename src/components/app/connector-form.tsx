"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { checkValue, connectorForm, type ConnectorField, type ConnectorKey } from "@/domain/connectors";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { fmtDateTime } from "./bits";

export type VaultField = {
  name: string; template: string; kind: "secret" | "setting"; source: "env" | "app" | null; saved: boolean; last4: string; value: string;
  unreadable: boolean; oldKey: boolean; updatedAt: string | null; updatedBy: string; version: number;
};
export type Vault = {
  mode: "live" | "demo"; baseUrl: string;
  key: { source: "dedicated" | "session" | "demo" | "none"; ok: boolean; problem: string | null; oldKeyRows: number; dedicated: boolean };
  connectors: { key: ConnectorKey; fields: VaultField[] }[];
  bootstrap: { name: string; required: boolean; set: boolean }[];
};
type TestResult = { ok: boolean; message: string; vars: Record<string, string>; error: string };
const WHO: Record<string, string> = { theo: "Théo", pablo: "Pablo", system: "system" };

/**
 * "Configure" for one integration (D087): what it does, numbered steps with links to the provider's page, the
 * addresses to copy, the fields to paste (write-only: a saved secret is never shown again), "Generate" for the
 * secrets WE create (shown once), then "Save and test" with a plain green/red result.
 */
export function ConnectorDialog({ vault, connector, name, onClose }: { vault: Vault; connector: ConnectorKey; name: string; onClose: () => void }) {
  const t = useT();
  const tag = useDateTag();
  const qc = useQueryClient();
  const form = connectorForm(connector)!;
  const state = vault.connectors.find((c) => c.key === connector)!;
  const byTemplate = new Map(state.fields.map((f) => [f.template, f]));
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(form.fields.filter((f) => f.kind === "setting").map((f) => [f.name, byTemplate.get(f.name)?.value ?? ""])));
  const [shown, setShown] = React.useState<{ field: string; value: string } | null>(null);
  const [result, setResult] = React.useState<TestResult | null>(null);
  const [saved, setSaved] = React.useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["vault"] }), qc.invalidateQueries({ queryKey: ["integrations"] })]);

  const changes = Object.fromEntries(form.fields.filter((f) => {
    const v = (values[f.name] ?? "").trim();
    const cur = byTemplate.get(f.name);
    return v && !(f.kind === "setting" && cur?.value === v);
  }).map((f) => [f.name, values[f.name]]));
  const errors = Object.fromEntries(Object.entries(changes).map(([k, v]) => {
    const c = checkValue(form.fields.find((f) => f.name === k)!, v);
    return [k, c.ok ? "" : c.error];
  }).filter(([, e]) => e));

  const save = useMutation({
    mutationFn: async () => {
      setResult(null);
      setSaved(false);
      if (Object.keys(changes).length) {
        await api("/api/integrations/vault", { body: { action: "save", integration: connector, changes, expected_versions: Object.fromEntries(Object.keys(changes).map((k) => [k, byTemplate.get(k)?.version ?? 0])) } });
        setSaved(true);
      }
      return form.testable ? api<TestResult>("/api/integrations/test", { body: { key: connector } }) : null;
    },
    onSuccess: async (r) => {
      setResult(r);
      // Secrets are write-only: the inputs empty again. Settings show what was stored (e.g. the folder id from a pasted address).
      setValues((v) => Object.fromEntries(Object.entries(v).map(([k, x]) => {
        const f = form.fields.find((y) => y.name === k);
        if (f?.kind !== "setting") return [k, ""];
        const c = x.trim() ? checkValue(f, x) : null;
        return [k, c?.ok ? c.value : x];
      })));
      await refresh();
    },
    onError: () => refresh(),
  });
  const gen = useMutation({
    mutationFn: (f: ConnectorField) => api<{ value: string; field: string }>("/api/integrations/vault", { body: { action: "generate", integration: connector, field: f.name, expected_version: byTemplate.get(f.name)?.version ?? 0 } }),
    onSuccess: async (r) => { setShown({ field: r.field, value: r.value }); await refresh(); },
    onError: () => refresh(),
  });
  const del = useMutation({
    mutationFn: (f: ConnectorField) => api("/api/integrations/vault", { body: { action: "delete", integration: connector, field: f.name, expected_version: byTemplate.get(f.name)?.version ?? 0 } }),
    onSuccess: async () => { setResult(null); await refresh(); },
    onError: () => refresh(),
  });
  const busy = save.isPending || gen.isPending || del.isPending;
  const canSubmit = !busy && !Object.keys(errors).length && (Object.keys(changes).length > 0 || form.testable);

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={t("Configure {name}", { name: t(name) })} description={t(form.does)} wide>
      <div className="flex flex-col gap-5" data-testid={`connector-form-${connector}`}>
        {vault.mode === "demo" ? <p className="rounded-[12px] bg-subtle p-3 text-[13px] text-text-2">{t("Demo: nothing is really saved. Values are encrypted with a temporary key and never used to reach a real service.")}</p> : null}
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {form.steps.map((s, i) => (
            <li key={i}>{t(s.text)}{s.link ? <> <a className="font-medium text-accent underline underline-offset-2" href={s.link} target="_blank" rel="noopener noreferrer">{t("Open the page")}</a></> : null}</li>
          ))}
        </ol>
        {form.urls.map((u) => <CopyLine key={u.path} label={t(u.label)} value={`${vault.baseUrl}${u.path}`} />)}
        <div className="flex flex-col gap-4">
          {form.fields.map((f) => {
            const cur = byTemplate.get(f.name);
            const id = `connector-${connector}-${f.name}`;
            const fromEnv = cur?.source === "env";
            const status = fromEnv ? t("Set in Vercel (this value wins).")
              : cur?.unreadable ? t("Saved but unreadable: the encryption key changed. Paste it again.")
              : cur?.saved ? `${f.kind === "secret" ? (cur.last4 ? t("Set · ends with {tail}", { tail: cur.last4 }) : t("Configured (value hidden)")) : t("Saved")}${cur.updatedAt ? ` · ${t("by {who} on {date}", { who: WHO[cur.updatedBy] ?? cur.updatedBy, date: fmtDateTime(cur.updatedAt, undefined, tag) })}` : ""}`
              : f.optional ? t("Optional, not set.") : t("Not set.");
            const Control = f.multiline ? Textarea : Input;
            return (
              <div key={f.name} className="flex flex-col gap-1.5 rounded-[12px] border border-hairline p-3" data-testid={`connector-field-${f.name}`}>
                <Field label={t(f.label)} htmlFor={id} hint={t(f.hint)} error={errors[f.name] ? t(errors[f.name]) : undefined}>
                  <Control
                    id={id}
                    {...(f.multiline ? { rows: 3 } : { type: f.kind === "secret" ? "password" : "text" })}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={fromEnv || busy}
                    placeholder={f.kind === "secret" && cur?.saved ? t("Paste a new value to replace it") : ""}
                    value={values[f.name] ?? ""}
                    onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    className="font-mono text-[13px]"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={cur?.unreadable ? "text-bad" : "text-text-3"} data-testid={`connector-status-${f.name}`}>{status}</span>
                  <span className="ml-auto flex gap-2">
                    {f.generate && !fromEnv ? <Button size="sm" variant="outline" disabled={busy} onClick={() => gen.mutate(f)}>{cur?.saved ? t("Generate a new one") : t("Generate")}</Button> : null}
                    {cur?.saved && !fromEnv ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => del.mutate(f)}>{t("Delete")}</Button> : null}
                  </span>
                </div>
                {shown?.field === f.name ? (
                  <div className="flex flex-col gap-1 rounded-[10px] bg-subtle p-2">
                    <CopyLine label={t("Copy it now: it will not be shown again.")} value={shown.value} testId="connector-generated" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {save.isError ? <ErrorState error={save.error} /> : null}
        {gen.isError ? <ErrorState error={gen.error} /> : null}
        {del.isError ? <ErrorState error={del.error} /> : null}
        {saved && !result ? <p role="status" className="text-[13px] text-good">{t("Saved.")}</p> : null}
        {result ? (
          <p role="status" data-testid="connector-result" className={`rounded-[12px] p-3 text-sm ${result.ok ? "bg-[#e6f2ec] text-good" : "bg-[#fbeceb] text-bad"}`}>
            {result.ok ? t("It works.") : t("It does not work yet.")} {t(result.message, result.vars)}{result.error ? ` · ${result.error}` : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => save.mutate()}>{form.testable ? t("Save and test") : t("Save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function CopyLine({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-text-2">{label}</span>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} data-testid={testId} className="font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" variant="outline" className="h-10" onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); }
        }}>{copied ? t("Copied") : t("Copy")}</Button>
      </div>
    </div>
  );
}
