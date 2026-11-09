"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { BANK_CATEGORIES, CATEGORY_LABELS, NEUTRAL, isIncome, type BankCategory } from "@/domain/bank";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";
import { Bars } from "./charts";
import { VerdictPanel } from "./verdicts";
import { moneyVerdicts } from "@/domain/verdicts";

type Tx = { bank: "wise" | "stripe"; id: string; version: number; occurred_at: string; date: string; amount_minor: number; currency: string; description: string; counterparty: string; category: BankCategory; category_source: "auto" | "manual"; direction: "credit" | "debit"; origin: string };
type Money = {
  connected: boolean; status: string | null; lastSync: string | null; syncError: string | null;
  stripe: { connected: boolean; lastSync: string | null; mrr: number | null; mrrPrevious: number | null; subscriptions: number | null };
  balances: { bank: "wise" | "stripe"; currency: string; amount_minor: number; name: string; as_of: string }[];
  summary: { previousExpensesByCategory: { category: BankCategory; amount: number }[]; topClientShare: { name: string; share: number } | null; months: { month: string; income: number; expenses: number; net: number }[]; current: { income: number; expenses: number; net: number }; expensesByCategory: { category: BankCategory; amount: number }[]; contributions: number; toReview: number };
  transactions: Tx[];
};

/** Wise account: balance now, income vs expenses, where the money goes, every movement with its category. */
export function MoneyView() {
  const t = useT();
  const dt = useDateTag();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["money"], queryFn: () => api<Money>("/api/money") });
  const sync = useMutation({
    mutationFn: async () => {
      let added = 0;
      if (q.data?.connected) added += (await api<{ added: number }>("/api/money/sync", { body: {} })).added;
      if (q.data?.stripe.connected) added += (await api<{ added: number }>("/api/money/stripe-sync", { body: {} })).added;
      return { added };
    },
    onSuccess: (r) => { toast(t("{n} new movements", { n: r.added })); qc.invalidateQueries({ queryKey: ["money"] }); },
    onError: (e) => toast((e as Error).message),
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const eur = d.balances.filter((b) => b.bank === "wise" && b.currency === "EUR").reduce((a, b) => a + b.amount_minor, 0);
  const stripeEur = d.balances.filter((b) => b.bank === "stripe" && b.currency === "EUR").reduce((a, b) => a + b.amount_minor, 0);
  const verdicts = moneyVerdicts({ ...d.summary, balance: d.connected || d.balances.length ? eur : null, mrr: d.stripe.mrr, mrrPrevious: d.stripe.mrrPrevious }, (m) => formatMoney(m), (k) => t(CATEGORY_LABELS[k as BankCategory] ?? k));
  const month = new Intl.DateTimeFormat(dt, { month: "long" });
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Money")}</h1>
          <p className="text-sm text-text-2">{[d.connected ? t("Wise · updated {when}", { when: d.lastSync ? new Date(d.lastSync).toLocaleString(dt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—" }) : t("Wise is not connected yet"), d.stripe.connected ? t("Stripe · updated {when}", { when: d.stripe.lastSync ? new Date(d.stripe.lastSync).toLocaleString(dt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—" }) : t("Stripe is not connected yet")].join(" · ")}</p>
        </div>
        <div className="flex gap-2">
          {d.connected || d.stripe.connected ? <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw /> {t("Update")}</Button> : null}
          <CsvImport />
        </div>
      </div>
      {!d.connected && !d.stripe.connected && !d.transactions.length ? (
        <EmptyState title={t("Connect Wise and Stripe")}>{t("Add the Wise and Stripe read-only keys on the server (see the setup guide), or import a CSV statement exported from Wise.")}</EmptyState>
      ) : null}
      {d.status === "sca_required" ? <p className="rounded-[12px] bg-subtle px-4 py-3 text-sm">{t("Wise asks for strong authentication to read the statement history. Live movements and balances still work. For the history: add the signing key (setup guide) or import a CSV statement.")}</p> : null}
      {d.syncError ? <p className="text-sm text-bad">{d.syncError}</p> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile dark label={t("Wise balance")} value={formatMoney(eur)} note={d.balances.filter((b) => b.bank === "wise" && b.currency !== "EUR").map((b) => formatMoney(b.amount_minor, b.currency)).join(" · ") || t("EUR")} />
        <Tile label={t("Stripe, to be paid out")} value={d.stripe.connected ? formatMoney(stripeEur) : "—"} note={d.stripe.connected ? t("arrives in Wise") : t("Stripe is not connected yet")} />
        <Tile label={t("Monthly recurring revenue")} value={d.stripe.mrr === null ? "—" : formatMoney(d.stripe.mrr)} note={d.stripe.subscriptions !== null ? t("{n} active subscriptions", { n: d.stripe.subscriptions }) : t("from Stripe subscriptions")} />
        <Tile label={t("Income in {m}", { m: month.format(new Date()) })} value={formatMoney(d.summary.current.income)} note={d.summary.toReview ? t("{n} to check", { n: d.summary.toReview }) : t("client revenue")} />
        <Tile label={t("Expenses in {m}", { m: month.format(new Date()) })} value={formatMoney(d.summary.current.expenses)} note={t("net {x}", { x: formatMoney(d.summary.current.net) })} bad={d.summary.current.net < 0} />
      </div>
      <VerdictPanel verdicts={verdicts} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>{t("Income and expenses, 6 months")}</PanelTitle>
          <MonthBars months={d.summary.months} />
        </Panel>
        <Panel>
          <PanelTitle>{t("Where the money went this month")}</PanelTitle>
          {d.summary.expensesByCategory.length ? <Bars tone="sales" data={d.summary.expensesByCategory.map((c) => ({ label: t(CATEGORY_LABELS[c.category]), value: Math.round(c.amount / 100), sub: formatMoney(c.amount) }))} /> : <p className="text-sm text-text-2">{t("No expense this month.")}</p>}
        </Panel>
      </div>
      <Transactions rows={d.transactions} toReview={d.summary.toReview} />
    </div>
  );
}

function Tile({ label, value, note, dark, bad }: { label: string; value: string; note?: string; dark?: boolean; bad?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[20px] p-4", dark ? "bg-ink text-panel" : "bg-panel")}>
      <p className={cn("text-[13px] first-letter:uppercase", dark ? "text-panel/80" : "text-text-2")}>{label}</p>
      <p className={cn("num truncate text-[28px] font-semibold leading-none tracking-tight", bad && "text-bad")}>{value}</p>
      {note ? <p className={cn("truncate text-[12px]", dark ? "text-panel/70" : "text-text-3")}>{note}</p> : null}
    </div>
  );
}

/** Two thin bars per month: income (green) and expenses (grey), values on hover and in the table view. */
function MonthBars({ months }: { months: Money["summary"]["months"] }) {
  const t = useT();
  const dt = useDateTag();
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expenses]));
  const fmt = new Intl.DateTimeFormat(dt, { month: "short" });
  return (
    <div>
      <div className="flex h-40 items-end gap-3" role="img" aria-label={t("Income and expenses, 6 months")}>
        {months.map((m) => (
          <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-1" title={`${m.month}: +${formatMoney(m.income)} / −${formatMoney(m.expenses)}`}>
            <div className="w-1/3 rounded-t-[4px] bg-win" style={{ height: `${(m.income / max) * 100}%`, minHeight: m.income ? 3 : 0 }} />
            <div className="w-1/3 rounded-t-[4px] bg-control" style={{ height: `${(m.expenses / max) * 100}%`, minHeight: m.expenses ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-3">{months.map((m) => <span key={m.month} className="flex-1 text-center text-[11px] text-text-3">{fmt.format(new Date(`${m.month}-15T12:00:00Z`))}</span>)}</div>
      <p className="mt-2 flex gap-4 text-[12px] text-text-2"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-win" />{t("Income")}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-control" />{t("Expenses")}</span></p>
    </div>
  );
}

function Transactions({ rows, toReview }: { rows: Tx[]; toReview: number }) {
  const t = useT();
  const dt = useDateTag();
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<"all" | "in" | "out" | "review">("all");
  const [source, setSource] = React.useState<"all" | "wise" | "stripe">("all");
  const set = useMutation({
    mutationFn: (b: { id: string; expected_version: number; category: BankCategory }) => api("/api/money/category", { method: "PATCH", body: b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["money"] }),
    onError: (e) => toast((e as Error).message),
  });
  const shown = rows.filter((r) => source === "all" || r.bank === source).filter((r) => filter === "all" || (filter === "in" ? r.direction === "credit" : filter === "out" ? r.direction === "debit" : r.bank !== "stripe" && r.category_source === "auto" && r.direction === "credit" && isIncome(r.category)));
  return (
    <Panel>
      <PanelTitle action={<div className="flex flex-wrap gap-2"><SegmentedSwitch size="sm" label={t("Source")} value={source} onChange={setSource} options={[{ value: "all", label: t("All") }, { value: "wise", label: "Wise" }, { value: "stripe", label: "Stripe" }]} /><SegmentedSwitch size="sm" label={t("Filter")} value={filter} onChange={setFilter} options={[{ value: "all", label: t("All") }, { value: "in", label: t("Money in") }, { value: "out", label: t("Money out") }, { value: "review", label: toReview ? `${t("To check")} · ${toReview}` : t("To check") }]} /></div>}>{t("Movements")}</PanelTitle>
      {shown.length === 0 ? <p className="text-sm text-text-2">{t("Nothing here.")}</p> : (
        <ul className="flex flex-col divide-y divide-hairline">
          {shown.slice(0, 60).map((r) => (
            <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[6rem_1fr_12rem_8rem]">
              <span className="num text-[12px] text-text-3">{new Date(r.occurred_at).toLocaleDateString(dt, { day: "2-digit", month: "short" })}</span>
              <span className="min-w-0 truncate text-sm">{r.bank === "stripe" ? <span className="mr-1.5 rounded bg-subtle px-1 text-[11px] text-text-2">Stripe</span> : null}{r.counterparty || t(r.description) || "—"}{r.counterparty && r.description ? <span className="text-text-3"> · {t(r.description)}</span> : null}</span>
              <Select aria-label={t("Category")} value={r.category} onChange={(e) => set.mutate({ id: r.id, expected_version: r.version, category: e.target.value as BankCategory })} className={cn("h-9 text-[13px]", r.bank !== "stripe" && r.category_source === "auto" && r.direction === "credit" && isIncome(r.category) && "border-ink")}>
                {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>)}
              </Select>
              <span className={cn("num text-right text-sm font-medium", r.direction === "credit" ? (NEUTRAL.includes(r.category) ? "text-text-2" : "text-win") : "")}>{r.direction === "credit" ? "+" : "−"}{formatMoney(Math.abs(r.amount_minor), r.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CsvImport() {
  const t = useT();
  const qc = useQueryClient();
  const ref = React.useRef<HTMLInputElement>(null);
  const imp = useMutation({
    mutationFn: async (f: File) => api<{ added: number; skipped: number; errors: string[] }>("/api/money/import", { body: { csv: await f.text() } }),
    onSuccess: (r) => { toast(t("{added} added, {skipped} already there", { added: r.added, skipped: r.skipped })); qc.invalidateQueries({ queryKey: ["money"] }); },
    onError: (e) => toast((e as Error).message),
  });
  return (
    <>
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) imp.mutate(f); e.target.value = ""; }} />
      <Button variant="ghost" disabled={imp.isPending} onClick={() => ref.current?.click()}><Upload /> {t("Import Wise CSV")}</Button>
    </>
  );
}
