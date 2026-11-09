"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import type { UsdRate } from "@/domain/usd";
import { rateString } from "@/domain/usd";
import { useDateTag, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { formatMoney } from "@/lib/utils";

/**
 * USD for contractor payments (D085): "1 200 $US ≈ 1 104 € (taux Wise du 12/11)", or the USD amount with
 * "taux manquant" when no rate exists (then it is left out of EUR totals). Everything else in the app stays EUR.
 */
const shortDay = (d: string, tag: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(tag, { day: "2-digit", month: "2-digit", timeZone: "UTC" });

export function useRateLabel() {
  const t = useT();
  const tag = useDateTag();
  return (r: UsdRate) => {
    const d = shortDay(r.date, tag);
    if (r.source === "bank") return t("rate of the Wise payment of {d}", { d });
    if (r.source === "wise") return t("Wise rate of {d}", { d });
    if (r.source === "manual") return t("manual rate of {d}", { d });
    return t("demo rate");
  };
}

/** The USD amount with its EUR equivalent and the rate used, or "rate missing". */
export function UsdAmount({ usd, eur, rate, className }: { usd: number; eur: number | null; rate: UsdRate | null; className?: string }) {
  const t = useT();
  const label = useRateLabel();
  return (
    <span className={className}>
      {formatMoney(usd, "USD")}
      {rate && eur !== null ? <> ≈ {formatMoney(eur)} <span className="text-text-3">({label(rate)})</span></> : <span className="text-bad"> · {t("rate missing, left out of EUR totals")}</span>}
    </span>
  );
}

/** One line telling which USD→EUR rate is in use, and its source. */
export function RateInUse({ rate, className }: { rate: UsdRate | null; className?: string }) {
  const t = useT();
  const label = useRateLabel();
  return <p className={className}>{rate ? t("1 $US = {r} € ({src})", { r: rateString(rate.micro).replace(".", ","), src: label(rate) }) : t("No USD rate: enter one below, or connect Wise.")}</p>;
}

/** The founders' manual rate (fallback when Wise gives none). Version-checked: 409 if the other founder changed it. */
export function ManualRateForm({ manual, version, today, onSaved }: { manual: UsdRate | null; version: number; today: string; onSaved?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = React.useState({ rate: manual ? rateString(manual.micro).replace(".", ",") : "", date: manual?.date ?? today });
  const [err, setErr] = React.useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api("/api/finance/usd-rate", { method: "PUT", body: { rate: f.rate, date: f.date, expected_version: version } }),
    onSuccess: () => { toast(t("Saved")); for (const k of ["finance", "clients", "money"]) qc.invalidateQueries({ queryKey: [k] }); onSaved?.(); },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) { setErr(t("Someone else changed this record. Review both versions.")); for (const k of ["finance", "clients"]) qc.invalidateQueries({ queryKey: [k] }); return; }
      setErr((e as Error).message);
    },
  });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
      <Field label={t("Manual rate: € for 1 $US")} htmlFor="usd-rate"><Input id="usd-rate" className="w-28" inputMode="decimal" placeholder="0,92" required value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
      <Field label={t("Rate date")} htmlFor="usd-date"><Input id="usd-date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Button type="submit" size="sm" variant="outline" disabled={save.isPending || !f.rate.trim()}>{t("Save")}</Button>
      {err ? <p role="alert" className="w-full text-[13px] text-bad">{err}</p> : null}
    </form>
  );
}
