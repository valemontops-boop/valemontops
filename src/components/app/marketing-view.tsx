"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { cn } from "@/lib/utils";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MessagesTab } from "./email-tab";
import { Spark } from "./charts";
import { GrowthOverviewTab } from "./marketing-funnels";
import { StatStrip, StepFunnel, useCostStat, useFunnels, type Days, type GrowthFilter, type GrowthTab, type Scope } from "./growth-common";
import { useDateTag, useT } from "@/i18n/react";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { BRANDS, BRAND_LABELS } from "@/domain/constants";
import { api } from "@/lib/api";
import { fmtDay } from "./bits";
import { CountrySplitButton, WebsiteTab, useMarketingOverview } from "./marketing-overview";
import { MarketingWeek, TasksFor } from "./my-day-extras";
import { ExportButton } from "./export-dialog";

type Account = { id: string; platform: "instagram" | "linkedin_page" | "linkedin_personal"; handle: string; brand: string | null; market: string | null; visibility: string; owner_founder: string | null };
type Series = { account: Account; metric: string; allowedMetrics: string[]; points: { date: string; value: number | null; source: string | null }[]; gaps: number; latest: { date: string; value: number; source: string } | null };
const METRIC_NAMES: Record<string, string> = { followers: "Followers", views: "Views", impressions: "Impressions", reach: "Reach", profile_visits: "Profile visits", interactions: "Interactions", link_clicks: "Link clicks" };
const PLATFORM: Record<string, string> = { instagram: "Instagram", linkedin_page: "LinkedIn page", linkedin_personal: "LinkedIn personal" };

/**
 * Growth (round 7): acquisition across every channel. One period and one scope at the top apply to every
 * tab that can use them; each tab reads the same way: key numbers → the channel funnel → the details.
 */
export function MarketingView() {
  const t = useT();
  const [tab, setTab] = React.useState<GrowthTab>("overview");
  const [days, setDays] = React.useState<Days>("30");
  const [scope, setScope] = React.useState<Scope>("team");
  const filter: GrowthFilter = { days, scope };
  const usesPeriod = tab !== "content";
  const usesScope = tab === "overview" || tab === "messages" || tab === "linkedin";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Growth")}</h1>
          <p className="text-sm text-text-2">{t("Which channel brings meetings, for how much work.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {usesPeriod ? <SegmentedSwitch size="sm" label={t("Period")} value={days} onChange={setDays} options={[{ value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }, { value: "90", label: t("90 days") }]} /> : null}
          {usesScope ? <SegmentedSwitch size="sm" label={t("Scope")} value={scope} onChange={setScope} options={[{ value: "team", label: t("Team") }, { value: "me", label: t("Me") }]} /> : null}
          <ExportButton />
        </div>
      </div>
      <div className="-mx-1 overflow-x-auto px-1 [&_button]:whitespace-nowrap">
        <SegmentedSwitch label={t("Section")} value={tab} onChange={setTab} options={[
          { value: "overview", label: t("Overview") }, { value: "messages", label: t("Messages") }, { value: "linkedin", label: "LinkedIn" },
          { value: "instagram", label: "Instagram" }, { value: "website", label: t("Web") }, { value: "content", label: t("Content") },
        ]} />
      </div>
      {tab === "overview" ? <GrowthOverviewTab filter={filter} onOpen={setTab} />
        : tab === "messages" ? <MessagesTab filter={filter} />
        : tab === "linkedin" ? <SocialTab key="li" network="linkedin" filter={filter} />
        : tab === "instagram" ? <SocialTab key="ig" network="instagram" filter={filter} />
        : tab === "website" ? <WebsiteTab filter={filter} />
        : <ContentTab />}
    </div>
  );
}

function ContentTab() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel><MarketingWeek /></Panel>
      <Panel><TasksFor area="marketing" /></Panel>
    </div>
  );
}

type Overview = { account: Account; followers: number | null; lastDate: string | null; change30: number | null; reach30: number | null; reachMetric: "views" | "impressions"; spark: number[] }[];
const isNetwork = (a: Account, n: "linkedin" | "instagram") => (n === "instagram" ? a.platform === "instagram" : a.platform !== "instagram");

/** LinkedIn (4 accounts + outreach) or Instagram (2 accounts): key numbers → funnels → accounts and the selected curve. */
function SocialTab({ network, filter }: { network: "linkedin" | "instagram"; filter: GrowthFilter }) {
  const t = useT();
  const tag = useDateTag();
  const accounts = useQuery({ queryKey: ["audience-accounts"], queryFn: () => api<Account[]>("/api/audience/accounts") });
  const overview = useQuery({ queryKey: ["audience-overview"], queryFn: () => api<Overview>("/api/audience/overview") });
  const funnels = useFunnels(filter);
  const content = useMarketingOverview(filter.days);
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const mine = (accounts.data ?? []).filter((a) => isNetwork(a, network));
  const cards = (overview.data ?? []).filter((o) => isNetwork(o.account, network));
  const current = mine.find((a) => a.id === accountId) ?? mine[0];
  const followers = cards.reduce((s, o) => s + (o.followers ?? 0), 0);
  const known = cards.filter((o) => o.followers !== null).length;
  const change = cards.some((o) => o.change30 !== null) ? cards.reduce((s, o) => s + (o.change30 ?? 0), 0) : null;
  const li = funnels.data?.all.find((c) => c.key === "linkedin");
  const steps = content.data?.platforms?.[network] ?? [];
  const n = (v: number | undefined) => (v === undefined ? "…" : v.toLocaleString(tag));
  // Round 9: the network is never free — outreach and content time (+ its share of costs) per meeting and per client.
  const costStat = useCostStat()(funnels.data?.networks?.[network]);

  const followerStat = { label: t("Followers"), value: known ? followers.toLocaleString(tag) : "—", note: known ? `${t("{n} account(s)", { n: known })}${change === null ? "" : ` · ${change >= 0 ? "+" : ""}${change.toLocaleString(tag)} ${t("in 30 days")}`}` : t("enter or import the numbers below") };
  const stats = network === "linkedin" ? [
    followerStat,
    { label: t("Invitations & messages"), value: n(li?.touches), note: t("{n} people reached", { n: li?.steps[1]?.value ?? 0 }) },
    { label: t("Replies"), value: n(li?.steps[2]?.value), note: li?.steps[1]?.value ? t("{pct} of people reached", { pct: `${Math.round(((li.steps[2]?.value ?? 0) / li.steps[1].value) * 100)}%` }) : t("replies to invitations and messages") },
    { label: t("Meetings"), value: n(li?.meetings), note: t("credited to LinkedIn (last touch)"), result: true },
    costStat,
  ] : [
    followerStat,
    { label: t("Views"), value: n(steps[0]?.value), note: t("Instagram views in this period") },
    { label: t("Website visits"), value: n(steps[3]?.value), note: t("sessions coming from Instagram (GA4)") },
    costStat,
  ];

  return (
    <div className="flex flex-col gap-5">
      <StatStrip stats={stats} />
      <div className={cn("grid grid-cols-1 gap-5", network === "linkedin" && "lg:grid-cols-2")}>
        {network === "linkedin" ? (
          <StepFunnel title={t("LinkedIn outreach")} steps={li ? li.steps : []} hours={li?.hours} empty={t("No LinkedIn invitation or message logged in this period. Log them with “Log activity”.")} />
        ) : null}
        <StepFunnel title={network === "linkedin" ? t("LinkedIn content → website") : t("Instagram content → website")} steps={steps}
          empty={network === "linkedin" ? t("No LinkedIn impressions in this period: import the LinkedIn export of each account below.") : t("No Instagram numbers in this period: open an account below and enter its numbers.")}
          footnote={network === "linkedin" ? t("Team pages only. Website visits and leads come from the GA4 import (source LinkedIn). The % is the share kept from the step before.") : t("Website visits and leads come from the GA4 import (source Instagram). The % is the share kept from the step before.")} />
      </div>

      <Panel>
        <PanelTitle action={<Button size="sm" variant="outline" onClick={() => setAdding(true)}>{t("Add account")}</Button>}>{network === "linkedin" ? t("LinkedIn accounts") : t("Instagram accounts")}</PanelTitle>
        {accounts.isPending ? <Skeleton className="h-40" /> : accounts.isError ? <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} /> : mine.length === 0 ? (
          <EmptyState title={network === "linkedin" ? t("No LinkedIn account yet") : t("No Instagram account yet")} action={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>{t("Add your first account")}</Button>}>{network === "linkedin" ? t("Add the Valemont and 30/30 pages and your own profile, then import their LinkedIn exports.") : t("Add the Valemont and 30/30 Instagram accounts, then enter their numbers once a week.")}</EmptyState>
        ) : (
          <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", mine.length > 2 && "lg:grid-cols-4")}>
            {mine.map((a) => <AccountCard key={a.id} account={a} o={cards.find((c) => c.account.id === a.id)} selected={current?.id === a.id} onSelect={() => setAccountId(a.id)} />)}
          </div>
        )}
      </Panel>
      {current ? <AccountChart key={current.id} account={current} days={filter.days} /> : null}
      <AddAccountModal open={adding} onOpenChange={setAdding} platform={network === "instagram" ? "instagram" : "linkedin_page"} />
    </div>
  );
}

/** One account: followers, change over 30 days, trend; click to see its curve below. */
function AccountCard({ account, o, selected, onSelect }: { account: Account; o: Overview[number] | undefined; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const tag = useDateTag();
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={cn("flex min-w-0 flex-col gap-1 rounded-[12px] border p-3 text-left transition-colors hover:border-control", selected ? "border-ink" : "border-hairline")}>
      <span className="text-[12px] text-text-3">{t(PLATFORM[account.platform])}{account.visibility === "owner" ? ` ${t("(private to you)")}` : ""}</span>
      <span className="truncate font-semibold">{account.handle}</span>
      {!o || o.followers === null ? <span className="text-[13px] text-text-3">{t("No data yet: import or enter the numbers")}</span> : (
        <>
          <span className="num text-[24px] font-semibold leading-none">{o.followers.toLocaleString(tag)} <span className="text-[12px] font-normal text-text-3">{t("followers")}</span></span>
          <span className="num text-[12px] text-text-3">{o.change30 !== null ? <>{o.change30 >= 0 ? "+" : ""}{o.change30.toLocaleString(tag)} {t("in 30 days")}</> : t("no change measured yet")}</span>
          <Spark values={o.spark} tone="sales" className="mt-1" />
        </>
      )}
    </button>
  );
}

function AccountChart({ account, days }: { account: Account; days: Days }) {
  const t = useT();
  const tag = useDateTag();
  const [metric, setMetric] = React.useState<string | null>(null);
  const [asTable, setAsTable] = React.useState(false);
  const [entry, setEntry] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const q = useQuery({ queryKey: ["audience-series", account.id, metric, days], queryFn: () => api<Series>(`/api/audience/series?account_id=${account.id}&days=${days}${metric ? `&metric=${metric}` : ""}`) });
  const s = q.data;
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{account.handle}</h2>
          <p className="text-[13px] text-text-2">{t(PLATFORM[account.platform])}{account.brand ? ` · ${t(BRAND_LABELS[account.brand as "local"])}` : ""}{account.market ? ` · ${account.market}` : ""}</p>
          {s?.latest ? (
            <p className="num mt-1 text-[13px] text-text-2"><b className="text-[20px] font-semibold text-ink">{s.latest.value.toLocaleString(tag)}</b> {t("{metric} on {date} · source: {source}", { metric: t(METRIC_NAMES[s.metric]).toLowerCase(), date: fmtDay(s.latest.date), source: t(s.latest.source) })}</p>
          ) : <p className="mt-1 text-[13px] text-text-3">{t("No data yet: import or enter the numbers")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {s ? <SegmentedSwitch size="sm" label={t("Metric")} value={s.metric} onChange={setMetric} options={s.allowedMetrics.map((m) => ({ value: m, label: t(METRIC_NAMES[m]) }))} /> : null}
          <SegmentedSwitch size="sm" label={t("Display")} value={asTable ? "table" : "chart"} onChange={(v) => setAsTable(v === "table")} options={[{ value: "chart", label: t("Chart") }, { value: "table", label: t("Table") }]} />
        </div>
      </div>
      {q.isPending ? <Skeleton className="h-72" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : asTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm"><thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Date")}</th><th className="text-right font-medium">{t(METRIC_NAMES[s!.metric])}</th><th className="pl-4 font-medium">{t("Source")}</th></tr></thead>
            <tbody>{[...s!.points].reverse().map((p) => <tr key={p.date} className="border-t border-hairline"><td className="py-1">{fmtDay(p.date)}</td><td className="num text-right">{p.value === null ? <span className="text-text-3">{t("gap")}</span> : p.value.toLocaleString(tag)}</td><td className="pl-4 text-text-2">{p.source ? t(p.source) : "—"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="h-72" aria-label={t("{metric} over {n} days", { metric: t(METRIC_NAMES[s!.metric]), n: days })} role="img">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={s!.points} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => fmtDay(d).slice(4)} stroke="var(--text-3)" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis stroke="var(--text-3)" fontSize={12} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
              <Tooltip cursor={{ stroke: "var(--control-border)" }} contentStyle={{ borderRadius: 999, border: "none", background: "var(--ink)", color: "var(--panel)", fontSize: 12, padding: "4px 12px" }} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => [Number(v).toLocaleString(tag), t(METRIC_NAMES[s!.metric])]} />
              <Line type="linear" dataKey="value" name={t(METRIC_NAMES[s!.metric])} stroke="var(--sales)" strokeWidth={2} dot={{ r: 3, fill: "var(--sales)" }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {s ? <p className="mt-2 text-[12px] text-text-3">{t("{n} day(s) without data in this period are left as gaps.", { n: s.gaps })} {account.platform === "instagram" ? t("Instagram views and LinkedIn impressions are different measures and are never added together.") : t("LinkedIn impressions are never added to Instagram views.")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-4">
        <Button size="sm" variant="outline" onClick={() => setEntry(true)}>{t("Enter numbers")}</Button>
        {account.platform !== "instagram" ? <Button size="sm" variant="outline" onClick={() => setImporting(true)}>{t("Import LinkedIn export")}</Button> : null}
        {account.visibility === "team" ? <CountrySplitButton accountId={account.id} /> : null}
      </div>
      <ManualEntryModal open={entry} onOpenChange={setEntry} account={account} allowed={s?.allowedMetrics ?? []} />
      <ImportModal open={importing} onOpenChange={setImporting} account={account} />
    </Panel>
  );
}

function ManualEntryModal({ open, onOpenChange, account, allowed }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account; allowed: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [date, setDate] = React.useState(() => new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA"));
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api("/api/audience/manual", { body: { account_id: account.id, date, ...Object.fromEntries(["followers", "views", "impressions", "reach", "profile_visits", "interactions", "link_clicks"].map((k) => [k, vals[k] ? Number(vals[k]) : null])) } }),
    onSuccess: () => { for (const k of ["audience-series", "audience-overview", "marketing-overview"]) qc.invalidateQueries({ queryKey: [k] }); toast(t("Saved")); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${t("Enter numbers")} · ${account.handle}`} description={t("Recorded as source: manual. An import or API value for the same day takes precedence.")}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("Date")} htmlFor="me-date" className="col-span-2"><Input id="me-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {allowed.map((k) => <Field key={k} label={t(METRIC_NAMES[k])} htmlFor={`me-${k}`}><Input id={`me-${k}`} inputMode="numeric" className="num" value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value.replace(/\D/g, "") })} /></Field>)}
        {m.isError ? <div className="col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
        <Button type="submit" variant="primary" className="col-span-2" disabled={m.isPending}>{m.isPending ? t("Saving…") : t("Save")}</Button>
      </form>
    </Modal>
  );
}

type Preview = { mapped: Record<string, string>; unrecognized: string[]; days: number; newRows: number; alreadyImported: number; range: { from: string; to: string } | null; committed: boolean };
function ImportModal({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account: Account }) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = React.useState<{ name: string; b64: string } | null>(null);
  const run = useMutation({
    mutationFn: (commit: boolean) => api<Preview>("/api/audience/import", { body: { account_id: account.id, file_name: file!.name, data_base64: file!.b64, commit } }),
    onSuccess: (r) => { if (r.committed) { for (const k of ["audience-series", "audience-overview", "marketing-overview"]) qc.invalidateQueries({ queryKey: [k] }); toast(t("Imported {n} day(s)", { n: r.newRows })); } },
  });
  const onFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast(t("File too large (max 2 MB)"));
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    setFile({ name: f.name, b64: btoa(bin) });
    run.reset();
  };
  const p = run.data;
  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFile(null); run.reset(); } }} title={`${t("Import LinkedIn export")} · ${account.handle}`} description={t("Page analytics (.xls) or creator analytics (.xlsx). Columns are matched by name; re-importing a file adds nothing.")}>
      <div className="flex flex-col gap-3">
        <Field label={t("Export file")} htmlFor="li-file"><input id="li-file" type="file" accept=".xls,.xlsx" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm file:mr-3 file:h-9 file:rounded-full file:border file:border-control file:bg-panel file:px-4" /></Field>
        <Button variant="outline" className="self-start" disabled={!file || run.isPending} onClick={() => run.mutate(false)}>{run.isPending && !run.variables ? t("Reading…") : t("Preview")}</Button>
        {run.isError ? <ErrorState error={run.error} onRetry={() => run.mutate(false)} /> : null}
        {p ? (
          <div className="flex flex-col gap-2 rounded-[12px] bg-subtle p-3 text-sm">
            <p className="num">{p.range ? t("{n} day(s) from {from} to {to}", { n: p.days, from: p.range.from, to: p.range.to }) : t("{n} day(s)", { n: p.days })} · {t("{n} new", { n: p.newRows })} · {t("{n} already imported", { n: p.alreadyImported })}</p>
            <p className="text-[13px] text-text-2">{t("Mapped:")} {Object.entries(p.mapped).map(([h, f]) => `${h} → ${f}`).join(", ") || t("none")}</p>
            {p.unrecognized.length ? <p className="text-[13px] text-text-2">{t("Not recognised (ignored):")} {p.unrecognized.join(", ")}</p> : null}
            {p.committed ? <p className="font-medium">{t("Imported.")}</p> : <Button variant="primary" className="self-start" disabled={p.newRows === 0 || run.isPending} onClick={() => run.mutate(true)}>{t("Import {n} day(s)", { n: p.newRows })}</Button>}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function AddAccountModal({ open, onOpenChange, platform }: { open: boolean; onOpenChange: (o: boolean) => void; platform: Account["platform"] }) {
  const t = useT();
  const qc = useQueryClient();
  const [id, setId] = React.useState(() => crypto.randomUUID());
  const [v, setV] = React.useState({ platform: platform as string, handle: "", brand: "consulting", market: "" });
  const m = useMutation({
    mutationFn: () => api("/api/audience/accounts", { body: { id, platform: v.platform, handle: v.handle, brand: v.platform === "linkedin_personal" ? null : v.brand, market: v.market || null } }),
    onSuccess: () => { for (const k of ["audience-accounts", "audience-overview"]) qc.invalidateQueries({ queryKey: [k] }); toast(t("Saved")); setId(crypto.randomUUID()); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("Add a social account")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.handle.trim()) m.mutate(); }}>
        <Field label={t("Platform")} htmlFor="sa-p"><Select id="sa-p" value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value })}><option value="linkedin_page">{t("LinkedIn company page")}</option><option value="instagram">{t("Instagram (professional)")}</option><option value="linkedin_personal">{t("My personal LinkedIn (private to me)")}</option></Select></Field>
        <Field label={t("Name or handle")} htmlFor="sa-h"><Input id="sa-h" value={v.handle} onChange={(e) => setV({ ...v, handle: e.target.value })} /></Field>
        {v.platform !== "linkedin_personal" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Brand")} htmlFor="sa-b"><Select id="sa-b" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })}>{BRANDS.map((b) => <option key={b} value={b}>{t(BRAND_LABELS[b])}</option>)}</Select></Field>
            <Field label={t("Market")} htmlFor="sa-m"><Select id="sa-m" value={v.market} onChange={(e) => setV({ ...v, market: e.target.value })}><option value="">FR + ES</option><option value="FR">{t("France")}</option><option value="ES">{t("Spain")}</option></Select></Field>
          </div>
        ) : <p className="text-[13px] text-text-2">{t("Personal profile statistics are visible to you only and are never tagged with a brand.")}</p>}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending || !v.handle.trim()}>{m.isPending ? t("Saving…") : t("Add account")}</Button>
      </form>
    </Modal>
  );
}

/** Content tab of the Command Center: latest figure per team account, with source and date. */
export function AudienceSummary() {
  const t = useT();
  const accounts = useQuery({ queryKey: ["audience-accounts"], queryFn: () => api<Account[]>("/api/audience/accounts") });
  if (accounts.isPending) return <Skeleton className="h-40" />;
  if (accounts.isError) return <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />;
  const team = accounts.data.filter((a) => a.visibility === "team");
  return (
    <Panel>
      <PanelTitle>{t("Audience, latest figures")}</PanelTitle>
      {team.length === 0 ? <p className="text-sm text-text-2">{t("No team account yet. Add them in Marketing.")}</p> : <ul className="flex flex-col divide-y divide-hairline">{team.map((a) => <AudienceRow key={a.id} account={a} />)}</ul>}
      <p className="mt-3 text-[12px] text-text-3">{t("Content planning and weekly content targets arrive in Stage 3.")}</p>
    </Panel>
  );
}
function AudienceRow({ account }: { account: Account }) {
  const t = useT();
  const tag = useDateTag();
  const q = useQuery({ queryKey: ["audience-series", account.id, null, "30"], queryFn: () => api<Series>(`/api/audience/series?account_id=${account.id}&days=30`) });
  return (
    <li className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
      <span><span className="font-medium">{account.handle}</span> <span className="text-text-3">{t(PLATFORM[account.platform])}</span></span>
      <span className="num text-right">{q.data?.latest ? `${q.data.latest.value.toLocaleString(tag)} ${t(METRIC_NAMES[q.data.metric]).toLowerCase()} · ${t(q.data.latest.source)} · ${fmtDay(q.data.latest.date)}` : q.isPending ? "…" : t("no data")}</span>
    </li>
  );
}
