"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RefreshCw, Search, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { BANK_CATEGORIES, CATEGORY_LABELS, NEUTRAL, isIncome, type BankCategory } from "@/domain/bank";
import { COST_CENTER_LABELS } from "@/domain/finance-constants";
import type { FinanceOverview } from "@/server/services/finance";
import { useDateTag, useT } from "@/i18n/react";
import { api } from "@/lib/api";
import { cn, formatMoney } from "@/lib/utils";
import { VerdictPanel } from "./verdicts";
import { moneyVerdicts } from "@/domain/verdicts";
import { ExportButton } from "./export-dialog";
import { AllocationPanel, ContractsTab, EntriesPanel, FmtContext, PnlTab, UsdRatePanel, useFmt, type Fmt } from "./money-finance";
import { UsdAmount } from "./usd-line";
import { CsvExportButton } from "./csv-tools";
import { splitCsv, type BackfillSummary } from "@/domain/bank-history";

type Tx = { bank: "wise" | "stripe"; id: string; version: number; occurred_at: string; date: string; amount_minor: number; currency: string; description: string; counterparty: string; category: BankCategory; category_source: "auto" | "manual"; direction: "credit" | "debit"; origin: string };
type Money = {
  connected: boolean; status: string | null; lastSync: string | null; syncError: string | null;
  stripe: { connected: boolean; lastSync: string | null; mrr: number | null; mrrPrevious: number | null; subscriptions: number | null };
  balances: { bank: "wise" | "stripe"; currency: string; amount_minor: number; name: string; as_of: string }[];
  summary: { previousExpensesByCategory: { category: BankCategory; amount: number }[]; topClientShare: { name: string; share: number } | null; months: { month: string; income: number; expenses: number; net: number }[]; current: { income: number; expenses: number; net: number }; expensesByCategory: { category: BankCategory; amount: number }[]; contributions: number; toReview: number };
  transactions: Tx[];
  backfill: BackfillSummary;
};
type BackfillRun = BackfillSummary & { added_now: number };
type Movements = {
  first_date: string | null; years: string[]; today: string;
  totals: { income: number; expenses: number; net: number; non_eur: number; count: number };
  by_category: { category: BankCategory; amount: number; count: number }[];
  total: number; page: number; size: number; rows: Tx[]; items: FinItemView[];
};
export type Fin = FinanceOverview;
export type FinItemView = Fin["items"][number];


type Tab = "overview" | "pnl" | "ledger" | "contracts";

/** Money: cash, recurring revenue, managerial P&L (recognized revenue vs cash), movements and contracts. */
export function MoneyView() {
  const t = useT();
  const dt = useDateTag();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("overview");
  const q = useQuery({ queryKey: ["money"], queryFn: () => api<Money>("/api/money") });
  // Finance reads after the bank sync of /api/money so the P&L sees the latest movements.
  const f = useQuery({ queryKey: ["finance"], queryFn: () => api<Fin>("/api/finance?months=12"), enabled: q.isSuccess });
  const sync = useMutation({
    mutationFn: async () => {
      let added = 0;
      if (q.data?.connected) added += (await api<{ added: number }>("/api/money/sync", { body: {} })).added;
      if (q.data?.stripe.connected) added += (await api<{ added: number }>("/api/money/stripe-sync", { body: {} })).added;
      return { added };
    },
    onSuccess: (r) => { toast(t("{n} new movements", { n: r.added })); qc.invalidateQueries({ queryKey: ["money"] }); qc.invalidateQueries({ queryKey: ["finance"] }); },
    onError: (e) => toast((e as Error).message),
  });
  const history = useBackfill(q.data);
  // Everything is EUR (D082): no display currency, no conversion.
  const fmt = React.useCallback<Fmt>((m) => (m === null || m === undefined ? "—" : formatMoney(m)), []);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  return (
    <FmtContext.Provider value={fmt}>
      <div className="flex max-w-6xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Money")}</h1>
            <p className="text-sm text-text-2">{[d.connected ? t("Wise · updated {when}", { when: when(d.lastSync) }) : t("Wise is not connected yet"), d.stripe.connected ? t("Stripe · updated {when}", { when: when(d.stripe.lastSync) }) : t("Stripe is not connected yet")].join(" · ")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d.connected || d.stripe.connected ? <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw /> {t("Update")}</Button> : null}
            <ExportButton />
            <CsvImport />
          </div>
        </div>
        <SegmentedSwitch label={t("View")} value={tab} onChange={setTab} options={[{ value: "overview", label: t("Overview") }, { value: "pnl", label: t("P&L") }, { value: "ledger", label: t("Movements") }, { value: "contracts", label: t("Contracts") }]} />
        {!d.connected && !d.stripe.connected && !d.transactions.length && tab === "overview" ? (
          <EmptyState title={t("Connect Wise and Stripe")}>{t("Add the Wise and Stripe read-only keys on the server (see the setup guide), or import a CSV statement exported from Wise.")}</EmptyState>
        ) : null}
        {d.status === "sca_required" ? <p className="rounded-[12px] bg-subtle px-4 py-3 text-sm">{t("Wise asks for strong authentication to read the statement history. Live movements and balances still work. For the history: add the signing key (setup guide) or import a CSV statement.")}</p> : null}
        {d.syncError ? <p className="text-sm text-bad">{d.syncError}</p> : null}
        {f.isError ? <ErrorState error={f.error} onRetry={() => f.refetch()} /> : null}
        {f.data?.usd_missing.count ? <p className="rounded-[12px] bg-subtle px-4 py-3 text-sm">{t("{n} USD payments have no rate ({x}): left out of EUR totals.", { n: f.data.usd_missing.count, x: formatMoney(f.data.usd_missing.usd_minor, "USD") })}</p> : null}
        {f.data?.non_eur ? <p className="rounded-[12px] bg-subtle px-4 py-3 text-sm">{t("{n} movements are not in EUR: shown in their own currency, not converted and left out of the EUR totals.", { n: f.data.non_eur })}</p> : null}
        {tab === "overview" ? <Overview money={d} fin={f.data} onTab={setTab} /> : null}
        {tab === "pnl" ? (f.data ? <PnlTab fin={f.data} /> : <Skeleton className="h-96" />) : null}
        {tab === "ledger" ? (
          <>
            <HistoryPanel money={d} run={history} />
            <Transactions toReview={d.summary.toReview} fin={f.data} />
            {f.data ? <EntriesPanel fin={f.data} /> : null}
            {f.data ? <UsdRatePanel fin={f.data} /> : null}
          </>
        ) : null}
        {tab === "contracts" ? (f.data ? <ContractsTab fin={f.data} /> : <Skeleton className="h-96" />) : null}
      </div>
    </FmtContext.Provider>
  );
}

function Overview({ money: d, fin, onTab }: { money: Money; fin: Fin | undefined; onTab: (t: Tab) => void }) {
  const t = useT();
  const dt = useDateTag();
  const fmt = useFmt();
  const qc = useQueryClient();
  const mk = useMutation({
    mutationFn: () => api<{ added: number }>("/api/finance/contracts/from-projects", { body: {} }),
    onSuccess: (r) => { toast(t("{n} contracts created", { n: r.added })); qc.invalidateQueries({ queryKey: ["finance"] }); },
    onError: (e) => toast((e as Error).message),
  });
  const eur = d.balances.filter((b) => b.bank === "wise" && b.currency === "EUR").reduce((a, b) => a + b.amount_minor, 0);
  const verdicts = moneyVerdicts({ ...d.summary, balance: d.connected || d.balances.length ? eur : null, mrr: fin?.numbers.mrr.value ?? d.stripe.mrr, mrrPrevious: d.stripe.mrrPrevious }, (m) => fmt(m), (k) => t(CATEGORY_LABELS[k as BankCategory] ?? k));
  const month = new Intl.DateTimeFormat(dt, { month: "long" }).format(new Date());
  if (!fin) return <Skeleton className="h-64" />;
  const n = fin.numbers;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile dark label={t("Cash")} value={fmt(n.cash)} note={t("Wise + Stripe, today")} />
        <Tile label={t("Monthly recurring revenue")} value={fmt(n.mrr.value)} note={n.arr !== null ? t("ARR {x} (MRR × 12, run rate)", { x: fmt(n.arr) }) : t("no active subscription")} />
        <Tile label={t("Revenue in {m}", { m: month })} value={fmt(n.revenue_month)} note={t("recognized · cash received {x}", { x: fmt(n.cash_in_month) })} />
        <Tile label={n.provisional ? t("Provisional EBITDA") : t("Estimated EBITDA")} value={fmt(n.ebitda_month)} note={n.provisional ? t("invoice-based estimate, managerial") : t("managerial, not accounting")} bad={n.ebitda_month < 0} />
        <Tile label={t("Runway")} value={n.runway === null ? "—" : t("{n} months", { n: n.runway })} note={n.runway === null ? t("no net cash burn over 3 months") : t("at the pace of the last 3 months")} />
      </div>
      {fin.projects_without_contract ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-subtle px-4 py-3 text-sm">
          <span>{t("{n} projects have no contract yet: MRR and the revenue schedule do not see them.", { n: fin.projects_without_contract })}</span>
          <Button size="sm" variant="outline" disabled={mk.isPending} onClick={() => mk.mutate()}>{t("Create contracts from projects")}</Button>
        </div>
      ) : null}
      <VerdictPanel verdicts={verdicts} />
      <Panel>
        <PanelTitle action={<Button size="sm" variant="ghost" onClick={() => onTab("pnl")}>{t("See the table")}</Button>}>{t("Revenue and costs, 12 months")}</PanelTitle>
        <RevenueCostBars months={fin.pnl} />
      </Panel>
    </>
  );
}

function Tile({ label, value, note, dark, bad }: { label: string; value: string; note?: string; dark?: boolean; bad?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[20px] p-4", dark ? "bg-ink text-panel" : "bg-panel")}>
      <p className={cn("text-[13px] first-letter:uppercase", dark ? "text-panel/80" : "text-text-2")}>{label}</p>
      <p className={cn("num truncate text-[28px] font-semibold leading-none tracking-tight", bad && "text-bad")}>{value}</p>
      {note ? <p className={cn("text-[12px] leading-snug", dark ? "text-panel/70" : "text-text-3")}>{note}</p> : null}
    </div>
  );
}

/** One chart: recognized revenue (green, solid) vs costs (direct + operating, grey) per month; EBITDA in the tooltip. */
function RevenueCostBars({ months }: { months: Fin["pnl"] }) {
  const t = useT();
  const dt = useDateTag();
  const fmt = useFmt();
  const costs = (m: Fin["pnl"][number]) => m.direct + m.opex;
  const max = Math.max(1, ...months.flatMap((m) => [m.revenue.total, costs(m)]));
  const label = new Intl.DateTimeFormat(dt, { month: "short" });
  return (
    <div>
      <div className="flex h-44 items-end gap-2" role="img" aria-label={t("Revenue and costs, 12 months")}>
        {months.map((m) => (
          <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-0.5" title={`${m.month} · ${t("Recognized revenue")} ${fmt(m.revenue.total)} · ${t("Costs")} ${fmt(costs(m))} · EBITDA ${fmt(m.ebitda)}${m.provisional ? ` (${t("provisional")})` : ""}`}>
            <div className="w-[40%] rounded-t-[4px] bg-win" style={{ height: `${(Math.max(0, m.revenue.total) / max) * 100}%`, minHeight: m.revenue.total > 0 ? 3 : 0 }} />
            <div className="w-[40%] rounded-t-[4px] bg-control" style={{ height: `${(costs(m) / max) * 100}%`, minHeight: costs(m) ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">{months.map((m) => <span key={m.month} className="flex-1 text-center text-[11px] text-text-3">{label.format(new Date(`${m.month}-15T12:00:00Z`))}</span>)}</div>
      <p className="mt-2 flex flex-wrap gap-4 text-[12px] text-text-2"><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-win" />{t("Recognized revenue")}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-control" />{t("Direct costs and operating expenses")}</span></p>
    </div>
  );
}

/**
 * D091: the full Wise history. Started once by the page itself right after the first successful sync (its own request,
 * never inside /api/money), then by the button; each call walks ~4 minutes and the loop resumes until done.
 */
function useBackfill(d: Money | undefined) {
  const t = useT();
  const qc = useQueryClient();
  const [last, setLast] = React.useState<BackfillRun | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      let added = 0;
      let r: BackfillRun | null = null;
      for (let i = 0; i < 30; i++) {
        r = await api<BackfillRun>("/api/money/backfill", { body: {} });
        added += r.added_now;
        setLast(r);
        if (r.status !== "partial" || r.running) break;
        qc.invalidateQueries({ queryKey: ["money"] });
      }
      return { added, r };
    },
    onSuccess: ({ added, r }) => {
      if (r?.done) toast(t("Wise history imported: {n} movements added.", { n: added }));
      qc.invalidateQueries({ queryKey: ["money"] });
      qc.invalidateQueries({ queryKey: ["finance"] });
    },
    onError: (e) => { toast((e as Error).message); qc.invalidateQueries({ queryKey: ["money"] }); },
  });
  const started = React.useRef(false);
  const { mutate } = run;
  React.useEffect(() => {
    if (started.current || !d?.connected || d.status !== "ok" || !d.lastSync || d.backfill.started) return;
    started.current = true;
    mutate();
  }, [d, mutate]);
  return { start: () => run.mutate(), pending: run.isPending, state: last ?? d?.backfill ?? null };
}

function HistoryPanel({ money: d, run }: { money: Money; run: ReturnType<typeof useBackfill> }) {
  const t = useT();
  const dt = useDateTag();
  const s = run.state;
  const until = s?.reached ? new Date(s.reached).toLocaleDateString(dt, { month: "2-digit", year: "numeric" }) : null;
  const line = !d.connected ? null
    : run.pending || s?.running ? (until ? t("Importing the Wise history… back to {d}", { d: until }) : t("Importing the Wise history…"))
    : !s?.started ? t("Only the last 90 days come from Wise for now.")
    : s.status === "done" ? t("Full Wise history imported, back to {d} · {n} movements added. Done.", { d: until ?? "—", n: s.added })
    : s.status === "sca_required" ? t("Wise asks for strong authentication to read the statement history: import the full history as a CSV (steps below).")
    : s.status === "error" ? t("The import stopped on an error: {e}", { e: t(s.error) })
    : t("Import paused, back to {d} · {n} movements added. Resume to continue.", { d: until ?? "—", n: s.added });
  return (
    <Panel>
      <PanelTitle action={d.connected && s?.status !== "done" ? (
        <Button size="sm" variant="outline" disabled={run.pending || Boolean(s?.running)} onClick={run.start}><History /> {s?.started ? t("Resume the Wise history import") : t("Import the whole Wise history")}</Button>
      ) : null}>{t("History since the account was opened")}</PanelTitle>
      {line ? <p className="text-sm" role="status">{line}</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-[12px] leading-relaxed text-text-3">{t("Without the API, export everything from Wise: Statements & reports › select all balances › date range from the account opening to today › CSV, then import the file here (up to 15 MB; movements already there are skipped).")}</p>
        <CsvImport />
      </div>
    </Panel>
  );
}

function Transactions({ toReview, fin }: { toReview: number; fin: Fin | undefined }) {
  const t = useT();
  const dt = useDateTag();
  const fmt = useFmt();
  const qc = useQueryClient();
  const [period, setPeriod] = React.useState("all");
  const [category, setCategory] = React.useState<BankCategory | "">("");
  const [filter, setFilter] = React.useState<"all" | "in" | "out" | "review">("all");
  const [source, setSource] = React.useState<"all" | "wise" | "stripe">("all");
  const [text, setText] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => { const h = setTimeout(() => { setSearch(text.trim()); setPage(0); }, 250); return () => clearTimeout(h); }, [text]);
  const params = new URLSearchParams({ period, category, kind: filter, source, q: search, page: String(page), size: "100" });
  const q = useQuery({ queryKey: ["money", "movements", params.toString()], queryFn: () => api<Movements>(`/api/money/movements?${params}`), placeholderData: keepPreviousData });
  const set = useMutation({
    mutationFn: (b: { id: string; expected_version: number; category: BankCategory }) => api("/api/money/category", { method: "PATCH", body: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["money"] }); qc.invalidateQueries({ queryKey: ["finance"] }); },
    onError: (e) => toast((e as Error).message),
  });
  const reset = <V,>(fn: (v: V) => void) => (v: V) => { fn(v); setPage(0); };
  const m = q.data;
  const items = new Map((m?.items ?? []).map((i) => [i.id, i]));
  const item = open ? items.get(open) : undefined;
  const firstYear = m?.first_date ? new Date(`${m.first_date}T12:00:00Z`).toLocaleDateString(dt, { month: "2-digit", year: "numeric" }) : null;
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <Panel className="min-w-0 flex-1">
        <PanelTitle action={<CsvExportButton list="bank" />}>{t("Bank movements")}</PanelTitle>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select aria-label={t("Period")} value={period} onChange={(e) => reset(setPeriod)(e.target.value)} className="h-9 w-auto text-[13px]">
            <option value="all">{firstYear ? t("Since the start ({d})", { d: firstYear }) : t("Since the start")}</option>
            <option value="12m">{t("Last 12 months")}</option>
            {(m?.years ?? []).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select aria-label={t("Category")} value={category} onChange={(e) => reset(setCategory)(e.target.value as BankCategory | "")} className="h-9 w-auto text-[13px]">
            <option value="">{t("All categories")}</option>
            {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>)}
          </Select>
          <label className="relative">
            <span className="sr-only">{t("Search")}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-3" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Search a supplier, a client, a label")} className="h-9 w-64 pl-8 text-[13px]" />
          </label>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <SegmentedSwitch size="sm" label={t("Source")} value={source} onChange={reset(setSource)} options={[{ value: "all", label: t("All") }, { value: "wise", label: "Wise" }, { value: "stripe", label: "Stripe" }]} />
          <SegmentedSwitch size="sm" label={t("Filter")} value={filter} onChange={reset(setFilter)} options={[{ value: "all", label: t("All") }, { value: "in", label: t("Money in") }, { value: "out", label: t("Money out") }, { value: "review", label: toReview ? `${t("To check")} · ${toReview}` : t("To check") }]} />
        </div>
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {!m ? <Skeleton className="h-64" /> : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3" aria-label={t("Totals of the movements shown")}>
              <Total label={t("Expenses")} value={fmt(m.totals.expenses)} />
              <Total label={t("Income")} value={fmt(m.totals.income)} />
              <Total label={t("Net")} value={fmt(m.totals.net)} bad={m.totals.net < 0} />
            </div>
            <p className="mb-3 text-[12px] text-text-3">
              {t("{n} movements", { n: m.total })}{m.totals.non_eur ? ` · ${t("{n} not in EUR, left out of the totals", { n: m.totals.non_eur })}` : ""} · {t("transfers between our balances, founder contributions and loans are neither income nor expenses")}
            </p>
            {m.rows.length === 0 ? <p className="text-sm text-text-2">{t("Nothing here.")}</p> : (
              <ul className={cn("flex flex-col divide-y divide-hairline", q.isPlaceholderData && "opacity-60")}>
                {m.rows.map((r) => {
                  const it = items.get(r.id);
                  return (
                    <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[6rem_1fr_11rem_8rem]">
                      <span className="num text-[12px] text-text-3">{new Date(r.occurred_at).toLocaleDateString(dt, { day: "2-digit", month: "short", year: "2-digit" })}</span>
                      <button type="button" onClick={() => setOpen(r.id)} className="min-w-0 truncate rounded-[8px] text-left text-sm hover:underline" aria-label={t("Details of {name}", { name: r.counterparty || r.description || "—" })}>
                        {r.bank === "stripe" ? <span className="mr-1.5 rounded bg-subtle px-1 text-[11px] text-text-2">Stripe</span> : null}
                        {r.counterparty || t(r.description) || "—"}{r.counterparty && r.description ? <span className="text-text-3"> · {t(r.description)}</span> : null}
                        {it && !NEUTRAL.includes(r.category) ? <span className="ml-1.5 text-[11px] text-text-3">· {t(COST_CENTER_LABELS[it.cost_center])}{it.receipt_url ? ` · ${t("receipt")}` : ""}{it.reconciled ? ` · ${t("reconciled")}` : ""}</span> : null}
                      </button>
                      <Select aria-label={t("Category")} value={r.category} onChange={(e) => set.mutate({ id: r.id, expected_version: r.version, category: e.target.value as BankCategory })} className={cn("h-9 text-[13px]", r.bank !== "stripe" && r.category_source === "auto" && r.direction === "credit" && isIncome(r.category) && "border-ink")}>
                        {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABELS[c])}</option>)}
                      </Select>
                      <span className={cn("num text-right text-sm font-medium", r.direction === "credit" ? (NEUTRAL.includes(r.category) ? "text-text-2" : "text-win") : "")}>
                        {r.direction === "credit" ? "+" : "−"}{formatMoney(Math.abs(r.amount_minor), r.currency)}
                        {r.currency !== "EUR" && it ? <span className="block text-[11px] font-normal text-text-3">{t("not in EUR, not converted")}</span> : null}
                        {it?.fx && it.fx_minor ? <UsdAmount usd={it.fx_minor} eur={Math.abs(r.amount_minor)} rate={it.fx} className="block text-[11px] font-normal text-text-3" /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {m.total > m.size ? (
              <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-text-2">
                <span className="num">{t("{from}–{to} of {n}", { from: m.page * m.size + 1, to: Math.min(m.total, (m.page + 1) * m.size), n: m.total })}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={m.page === 0} onClick={() => setPage(m.page - 1)}>{t("Previous")}</Button>
                  <Button size="sm" variant="outline" disabled={(m.page + 1) * m.size >= m.total} onClick={() => setPage(m.page + 1)}>{t("Next")}</Button>
                </div>
              </div>
            ) : null}
            {m.by_category.length ? (
              <div className="mt-6">
                <h3 className="mb-2 text-[13px] font-semibold text-text-2">{t("Expenses by category over the period")}</h3>
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-text-3"><th className="py-1.5 font-medium">{t("Category")}</th><th className="num py-1.5 text-right font-medium">{t("Movements")}</th><th className="num py-1.5 text-right font-medium">{t("Amount")}</th><th className="num py-1.5 pl-3 text-right font-medium">{t("Share")}</th></tr></thead>
                  <tbody>
                    {m.by_category.map((c) => (
                      <tr key={c.category} className="border-t border-hairline">
                        <td className="py-1.5"><button type="button" className="rounded hover:underline" onClick={() => { setCategory(c.category); setFilter("all"); setPage(0); }}>{t(CATEGORY_LABELS[c.category])}</button></td>
                        <td className="num py-1.5 text-right text-text-2">{c.count}</td>
                        <td className="num py-1.5 text-right">{fmt(c.amount)}</td>
                        <td className="num py-1.5 pl-3 text-right text-text-2">{m.totals.expenses ? `${Math.round((c.amount / m.totals.expenses) * 100)} %` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </Panel>
      {item && fin ? <AllocationPanel key={item.id} item={item} fin={fin} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Total({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-subtle px-3 py-2">
      <p className="text-[12px] text-text-2">{label}</p>
      <p className={cn("num truncate text-lg font-semibold", bad && "text-bad")}>{value}</p>
    </div>
  );
}

/** Max file accepted in the browser (D091: a multi-year export), sent in parts the server and the host accept. */
const CSV_MAX_FILE = 15_000_000;
const CSV_PART = 500_000;
function CsvImport() {
  const t = useT();
  const qc = useQueryClient();
  const ref = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<string | null>(null);
  const imp = useMutation({
    mutationFn: async (f: File) => {
      if (f.size > CSV_MAX_FILE) throw new Error(t("File too large (15 MB max). Export one period at a time."));
      const parts = splitCsv(await f.text(), CSV_PART);
      const sum = { added: 0, skipped: 0, errors: [] as string[] };
      for (const [i, p] of parts.entries()) {
        if (parts.length > 1) setProgress(t("Part {n} of {total}", { n: i + 1, total: parts.length }));
        const r = await api<{ added: number; skipped: number; errors: string[] }>("/api/money/import", { body: { csv: p.csv, row_offset: p.offset } });
        sum.added += r.added; sum.skipped += r.skipped; sum.errors.push(...r.errors);
      }
      return sum;
    },
    onSuccess: (r) => { toast(t("{added} added, {skipped} already there", { added: r.added, skipped: r.skipped })); if (r.errors.length) toast(t(r.errors[0])); qc.invalidateQueries({ queryKey: ["money"] }); qc.invalidateQueries({ queryKey: ["finance"] }); },
    onError: (e) => toast((e as Error).message),
    onSettled: () => setProgress(null),
  });
  return (
    <>
      <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) imp.mutate(f); e.target.value = ""; }} />
      <Button variant="ghost" disabled={imp.isPending} onClick={() => ref.current?.click()}><Upload /> {imp.isPending && progress ? progress : t("Import Wise CSV")}</Button>
    </>
  );
}
