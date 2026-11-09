"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe, Mail, MessageCircle, MessageSquareReply, Plus, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { FOUNDER_NAMES } from "@/domain/constants";
import { INBOX_SOURCES, INBOX_SOURCE_LABELS, type InboxSource, type ReplyKey } from "@/domain/inbox";
import { useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { InboxView } from "@/server/services/inbox";
import { useMe } from "./providers";

/**
 * "To reply" (iteration 8): comments and messages waiting for an answer, signalled automatically (webhooks,
 * replied emails/WhatsApp, LinkedIn replies, new website leads). Nothing is sent for the founder: "Copy a reply"
 * copies a ready reply in his language and opens the conversation; he sends it himself (spec 4.15).
 */
type Scope = "me" | "team";
type InboxData = { items: InboxView[]; count: number };
export function useInbox(scope: Scope) {
  return useQuery({ queryKey: ["inbox", scope], queryFn: () => api<InboxData>(`/api/inbox?scope=${scope}`), refetchInterval: 120_000 });
}

const REPLY_LABELS: Record<ReplyKey, string> = { thanks: "Thanks", price: "Price", call: "Book a call" };
const ACCOUNT_SUGGESTIONS = ["Instagram Valemont", "Instagram 30/30 AI", "LinkedIn Valemont", "LinkedIn 30/30 AI", "LinkedIn Théo", "LinkedIn Pablo", "Gmail", "WhatsApp"];

function NetworkIcon({ source }: { source: InboxSource }) {
  const t = useT();
  const base = "flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-[11px] font-semibold text-ink";
  const label = t(INBOX_SOURCE_LABELS[source]);
  if (source.startsWith("instagram")) return <span className={base} role="img" aria-label={label}>IG</span>;
  if (source.startsWith("linkedin")) return <span className={base} role="img" aria-label={label}>in</span>;
  const Icon = source === "email_reply" ? Mail : source === "website_form" ? Globe : MessageCircle;
  return <span className={base} role="img" aria-label={label}><Icon className="size-4" /></span>;
}

function useAge() {
  const t = useT();
  return (iso: string) => {
    const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
    const text = h < 1 ? t("{n} min ago", { n: Math.max(1, Math.round(h * 60)) }) : h < 48 ? t("{n} h ago", { n: Math.floor(h) }) : t("{n} d ago", { n: Math.floor(h / 24) });
    return { text, late: h > 24 };
  };
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const el = document.createElement("textarea");
    el.value = text; el.setAttribute("readonly", ""); el.style.position = "fixed"; el.style.opacity = "0";
    document.body.appendChild(el); el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch { return false; }
}

function useSetStatus() {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: "replied" | "ignored"; expected_version: number }) => api("/api/inbox", { method: "PATCH", body: v }),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["inbox"] }); toast(v.status === "replied" ? t("Marked as replied") : t("Ignored")); },
    onError: (e) => { qc.invalidateQueries({ queryKey: ["inbox"] }); toast(e instanceof ApiError && e.status === 409 ? t("Someone else changed this record. Review both versions.") : e.message); },
  });
}

function ItemRow({ item, full }: { item: InboxView; full?: boolean }) {
  const t = useT();
  const age = useAge()(item.received_at);
  const set = useSetStatus();
  const busy = set.isPending;
  const copy = async (key?: ReplyKey) => {
    const reply = item.replies.find((r) => r.key === key) ?? item.replies[0];
    // Open the conversation first (a popup opened after an await is blocked), then copy: the founder pastes and sends.
    if (item.url && !key) window.open(item.url, "_blank", "noopener,noreferrer");
    toast((await copyText(reply.text)) ? (item.url && !key ? t("Reply copied: paste it in the conversation that just opened.") : t("Reply copied.")) : t("Could not copy. Select the text and copy it."));
  };
  return (
    <li className="flex gap-3 border-t border-hairline py-3 first:border-t-0 first:pt-0">
      <NetworkIcon source={item.source} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{item.from_name || t("Someone")}</span>
          <span className="text-[12px] text-text-3">{t(item.account_label || INBOX_SOURCE_LABELS[item.source])} · {t(INBOX_SOURCE_LABELS[item.source])}</span>
          <span className={cn("num text-[12px]", age.late ? "font-medium text-bad" : "text-text-3")}>{age.text}</span>
          {full && item.assigned_founder ? <span className="text-[12px] text-text-3">· {FOUNDER_NAMES[item.assigned_founder]}</span> : null}
        </p>
        <p className={cn("mt-0.5 text-sm text-text-2", !full && "line-clamp-2")}>{item.excerpt ? `« ${item.excerpt} »` : t(item.summary)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => copy()} title={item.replies[0]?.text}><Copy />{t("Copy a reply")}</Button>
          {item.url ? <Button size="sm" variant="ghost" asChild><a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("Open")}</a></Button> : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => set.mutate({ id: item.id, status: "replied", expected_version: item.version })}><Check />{t("Mark as replied")}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => set.mutate({ id: item.id, status: "ignored", expected_version: item.version })}><X />{t("Ignore")}</Button>
        </div>
        {full ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-text-3">
            {t("Other replies:")}
            {item.replies.map((r) => <button key={r.key} type="button" title={r.text} onClick={() => copy(r.key)} className="rounded-full border border-hairline px-2 py-0.5 text-text-2 hover:bg-subtle hover:text-ink">{t(REPLY_LABELS[r.key])}</button>)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** My Day: compact "To reply" panel, only when something waits for this founder. */
export function InboxPanel() {
  const t = useT();
  const q = useInbox("me");
  const [all, setAll] = React.useState(false);
  if (!q.data?.count) return null;
  const items = all ? q.data.items : q.data.items.slice(0, 3);
  return (
    <Panel aria-labelledby="inbox-title">
      <PanelTitle action={<Button asChild size="sm" variant="ghost"><Link href="/marketing?channel=inbox">{t("All in Growth")}</Link></Button>}>
        <span id="inbox-title" className="flex items-center gap-2"><MessageSquareReply className="size-4" />{t("To reply")} <span className="num text-text-3">{q.data.count}</span></span>
      </PanelTitle>
      <ul>{items.map((i) => <ItemRow key={i.id} item={i} />)}</ul>
      {q.data.count > 3 ? <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAll((v) => !v)}>{all ? t("Show fewer") : t("See all {n}", { n: q.data.count })}</Button> : null}
    </Panel>
  );
}

/** Shell: count of replies waiting for this founder, next to the notification bell. */
export function InboxBell() {
  const t = useT();
  const q = useInbox("me");
  const n = q.data?.count ?? 0;
  if (!n) return null;
  return (
    <Link href="/my-day" aria-label={t("{n} to reply", { n })} title={t("{n} to reply", { n })} className="relative flex size-10 items-center justify-center rounded-full text-text-2 hover:bg-subtle hover:text-ink">
      <MessageSquareReply className="size-5" />
      <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-ink px-1 text-center text-[11px] leading-4 text-panel">{n}</span>
    </Link>
  );
}

/** Growth › Messages: every item waiting for a reply (mine or the team's), with manual add. */
export function InboxList() {
  const t = useT();
  const [scope, setScope] = React.useState<Scope>("team");
  const [adding, setAdding] = React.useState(false);
  const q = useInbox(scope);
  return (
    <Panel>
      <PanelTitle action={<div className="flex flex-wrap items-center gap-2"><SegmentedSwitch size="sm" label={t("Scope")} value={scope} onChange={setScope} options={[{ value: "team", label: t("Team") }, { value: "me", label: t("Me") }]} /><Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus />{t("Add")}</Button></div>}>
        {t("To reply")}{q.data ? <span className="num ml-2 text-text-3">{q.data.count}</span> : null}
      </PanelTitle>
      {q.isPending ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data.count === 0 ? (
        <EmptyState title={t("Nothing waits for a reply")}>{t("Instagram comments and messages arrive here by webhook; replied emails and WhatsApp, LinkedIn replies and new website leads are added automatically. Use “Add” for anything seen elsewhere.")}</EmptyState>
      ) : <ul>{q.data.items.map((i) => <ItemRow key={i.id} item={i} full />)}</ul>}
      <p className="mt-3 text-[12px] text-text-3">{t("Nothing is sent for you: “Copy a reply” copies a ready answer in your language and opens the conversation. Red = waiting for more than 24 h.")}</p>
      <AddItem open={adding} onOpenChange={setAdding} />
    </Panel>
  );
}

function AddItem({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const empty = { source: "instagram_comment" as InboxSource, account_label: "", from_name: "", excerpt: "", url: "", mine: true };
  const [v, setV] = React.useState(empty);
  const m = useMutation({
    mutationFn: () => api("/api/inbox", { body: { source: v.source, account_label: v.account_label, from_name: v.from_name, excerpt: v.excerpt, url: v.url, assigned_founder: v.mine ? me.founder : null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inbox"] }); toast(t("Saved")); setV(empty); onOpenChange(false); },
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("Add something to reply to")} description={t("A comment or a message seen elsewhere (LinkedIn notification, phone).")}>
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("Where")} htmlFor="ib-s"><Select id="ib-s" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value as InboxSource })}>{INBOX_SOURCES.map((s) => <option key={s} value={s}>{t(INBOX_SOURCE_LABELS[s])}</option>)}</Select></Field>
        <Field label={t("Account")} htmlFor="ib-a"><Input id="ib-a" list="ib-accounts" value={v.account_label} onChange={(e) => setV({ ...v, account_label: e.target.value })} /><datalist id="ib-accounts">{ACCOUNT_SUGGESTIONS.map((a) => <option key={a} value={a} />)}</datalist></Field>
        <Field label={t("From")} htmlFor="ib-f"><Input id="ib-f" value={v.from_name} onChange={(e) => setV({ ...v, from_name: e.target.value })} /></Field>
        <Field label={t("Link to the conversation")} htmlFor="ib-u"><Input id="ib-u" type="url" inputMode="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://" /></Field>
        <Field label={t("What they wrote")} htmlFor="ib-e" className="sm:col-span-2"><Textarea id="ib-e" rows={3} maxLength={500} value={v.excerpt} onChange={(e) => setV({ ...v, excerpt: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.mine} onChange={(e) => setV({ ...v, mine: e.target.checked })} />{t("For me (otherwise for both of us)")}</label>
        {m.isError ? <div className="sm:col-span-2"><ErrorState error={m.error} onRetry={() => m.mutate()} /></div> : null}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" variant="primary" disabled={m.isPending || (!v.from_name && !v.excerpt)}>{t("Add")}</Button><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button></div>
      </form>
    </Modal>
  );
}
