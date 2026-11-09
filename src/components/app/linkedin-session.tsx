"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, SkipForward } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Input, Panel, PanelTitle, Skeleton, Textarea } from "@/components/ui/form";
import {
  LINKEDIN_RESULTS, LINKEDIN_RESULT_KEYS, LINKEDIN_RESULT_LABELS, LI_STAGE_LABELS, normalizeLinkedInUrl, resultForKey, resultsFor,
  type LinkedInResult, type LiStage, type LiStats,
} from "@/domain/linkedin";
import { LINKEDIN_NOTE_MAX, LINKEDIN_TEMPLATES, LINKEDIN_TEMPLATE_LABELS, fill, findItem, type Lang, type LinkedInTemplate } from "@/domain/playbook";
import { useDateTag, useLocale, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Playbook } from "./instant-send";
import { MenuItem, MoreMenu } from "./call-live";

/** Free mode: the founder pastes a profile instead of picking a list. */
export const LI_FREE = "free";
type Limits = { invitations: { today: number; week: number; daily: number; weekly: number; left: number; blocked: boolean; reason: string | null }; inmails: { used: number; budget: number; left: number; blocked: boolean } };
type Prospect = {
  key: string; accountId: string; contactId: string; name: string; firstName: string; role: string; company: string; niche: string; city: string; country: "FR" | "ES" | null; linkedinUrl: string; listId: string;
  stage: LiStage; lastTouch: { type: string; outcome: string | null; date: string } | null; messagesSinceReply: number; next: { template: LinkedInTemplate | null; action: string; due: string | null };
};
type Queue = { today: string; due: Prospect[]; fresh: Prospect[]; dueCount: number; freshCount: number; total: number; lists: { id: string; name: string; count: number }[]; limits: Limits };
type Summary = { session: { id: string; started_at: string; ended_at: string | null }; stats: LiStats; last30: LiStats; limits: Limits };
type LogRow = { id: string; at: string; date: string; result: LinkedInResult; name: string; company: string; accountId: string; linkedinUrl: string; next_action: string; next_action_due: string | null };

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const TYPE_RESULT: Record<string, LinkedInResult> = { linkedin_invitation: "invited", linkedin_accepted: "accepted", linkedin_dm: "messaged", inmail: "inmail", qualified_conversation: "qualified", meeting_booked: "meeting" };
const YES: LinkedInResult[] = ["qualified", "meeting"];

function LimitsLine({ l }: { l: Limits }) {
  const t = useT();
  return (
    <p className="num text-[13px] text-text-2">
      <span className={cn(l.invitations.blocked && "font-semibold text-bad")}>{t("Invitations: {n}/{total} today", { n: l.invitations.today, total: l.invitations.daily })} · {t("{n}/{total} this week", { n: l.invitations.week, total: l.invitations.weekly })}</span>
      {" · "}<span className={cn(l.inmails.blocked && "font-semibold text-bad")}>{t("InMail credits left: {n}", { n: l.inmails.left })}</span>
    </p>
  );
}

/** Start screen of the LinkedIn tab: follow-ups due first, then lists, then free mode. Limits are shown before anything. */
export function LinkedInStart({ onStart }: { onStart: (s: { id: string; listId: string; kind: "linkedin" }) => void }) {
  const t = useT();
  const dt = useDateTag();
  const q = useQuery({ queryKey: ["li-queue", ""], queryFn: () => api<Queue>("/api/linkedin/queue?list_id=") });
  const sessions = useQuery({ queryKey: ["li-sessions"], queryFn: () => api<{ session: { id: string; started_at: string }; stats: LiStats }[]>("/api/linkedin/sessions") });
  const start = useMutation({
    mutationFn: (listId: string) => { const id = crypto.randomUUID(); return api("/api/calls/sessions", { body: { id, list_id: listId === LI_FREE ? "" : listId, kind: "linkedin" } }).then(() => ({ id, listId, kind: "linkedin" as const })); },
    onSuccess: onStart,
  });
  if (q.isPending) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-col gap-3">
        <PanelTitle>{t("LinkedIn session")}</PanelTitle>
        <p className="text-sm text-text-2">{t("The app opens each profile and copies the message; you act in LinkedIn or Sales Navigator, then tap the result. Each tap counts once.")}</p>
        <LimitsLine l={d.limits} />
        {d.limits.invitations.blocked ? <p className="text-sm font-medium text-bad">{t("Invitation limit reached: messages and follow-ups only for now.")}</p> : null}
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-hairline p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("LinkedIn follow-ups due")} <span className="num text-text-2">{d.dueCount}</span></p>
            <p className="text-[13px] text-text-2">{t("{n} prospects never contacted", { n: d.freshCount })}</p>
          </div>
          <Button variant="primary" disabled={start.isPending || d.total === 0} onClick={() => start.mutate("")}>{t("Start the session")}</Button>
        </div>
        {d.lists.length ? (
          <ul className="flex flex-col gap-2">
            {d.lists.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-hairline p-3">
                <p className="min-w-0 flex-1 font-medium">{l.name} <span className="num text-[13px] font-normal text-text-2">· {t("{n} profiles", { n: l.count })}</span></p>
                <Button variant="outline" size="sm" disabled={start.isPending} onClick={() => start.mutate(l.id)}>{t("This list only")}</Button>
              </li>
            ))}
          </ul>
        ) : null}
        {d.total === 0 ? <EmptyState title={t("No prospect with a LinkedIn profile yet")}>{t("Import a CSV with a LinkedIn column, add the profile on a contact, or use free mode.")}</EmptyState> : null}
      </Panel>
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-medium">{t("Free mode")}</p><p className="text-sm text-text-2">{t("Paste a profile link, a name and a company: the prospect lands in your CRM on the first tap.")}</p></div>
        <Button variant="outline" disabled={start.isPending} onClick={() => start.mutate(LI_FREE)}>{t("Start free mode")}</Button>
      </Panel>
      {start.isError ? <ErrorState error={start.error} onRetry={() => start.reset()} /> : null}
      {sessions.data?.length ? (
        <Panel>
          <PanelTitle>{t("Recent LinkedIn sessions")}</PanelTitle>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[12px] text-text-3"><th className="py-1 font-medium">{t("Started")}</th><th className="text-right font-medium">{t("Invitations")}</th><th className="text-right font-medium">{t("Messages")}</th><th className="text-right font-medium">{t("Replies")}</th><th className="text-right font-medium">{t("Meetings")}</th></tr></thead>
            <tbody>{sessions.data.slice(0, 5).map((s) => <tr key={s.session.id} className="border-t border-hairline"><td className="py-1.5">{new Date(s.session.started_at).toLocaleString(dt, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td className="num text-right">{s.stats.invitations}</td><td className="num text-right">{s.stats.messages + s.stats.inmails}</td><td className="num text-right">{s.stats.replies}</td><td className="num text-right">{s.stats.meetings}</td></tr>)}</tbody>
          </table>
        </Panel>
      ) : null}
      <LinkedInLog days={14} />
    </div>
  );
}

/**
 * The live LinkedIn screen: one prospect at a time (follow-ups due first), "Open the profile", the suggested message
 * for this step (copy with first name and company filled), then one tap for what happened. Keys: O open, C copy,
 * I A M N R Q 7 4 results, S skip.
 */
export function LinkedInSession({ id, listId, onEnd }: { id: string; listId: string; onEnd: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const lang: Lang = useLocale() === "es" ? "ES" : "FR";
  const free = listId === LI_FREE;
  const ensured = useQuery({ queryKey: ["call-session-ensure", id], queryFn: () => api("/api/calls/sessions", { body: { id, list_id: free ? "" : listId, kind: "linkedin" } }), staleTime: Infinity, retry: 3 });
  const summary = useQuery({ queryKey: ["li-summary", id], queryFn: () => api<Summary>(`/api/linkedin/summary?id=${id}`), enabled: ensured.isSuccess });
  const queue = useQuery({ queryKey: ["li-queue", free ? "" : listId], queryFn: () => api<Queue>(`/api/linkedin/queue?list_id=${free ? "" : listId}`) });
  const pb = useQuery({ queryKey: ["playbook"], queryFn: () => api<Playbook>("/api/playbook") });
  const [skipped, setSkipped] = React.useState<string[]>([]);
  // After "Accepted" or "Replied" the same person stays on screen for the next step (first message, qualification).
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ url: "", name: "", company: "", role: "" });
  const list = free ? [] : [...(queue.data?.due ?? []), ...(queue.data?.fresh ?? [])];
  const current: Prospect | null = free
    ? { key: "free", accountId: "", contactId: "", name: form.name, firstName: form.name.trim().split(/\s+/)[0] ?? "", role: form.role, company: form.company, niche: "", city: "", country: null, linkedinUrl: normalizeLinkedInUrl(form.url) ?? "", listId: "", stage: "new", lastTouch: null, messagesSinceReply: 0, next: { template: "invitation", action: "Send an invitation", due: null } }
    : list.find((p) => p.key === pinned && !skipped.includes(p.key)) ?? list.find((p) => !skipped.includes(p.key)) ?? null;
  const isDue = Boolean(current && queue.data?.due.some((p) => p.key === current.key));
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const limits = summary.data?.limits ?? queue.data?.limits;
  // A new prospect (or a new step for the same one) brings its own suggested message; a choice or an edit sticks to it.
  const curKey = current ? `${current.key}:${current.stage}:${current.messagesSinceReply}` : "";
  const [choice, setChoice] = React.useState<{ k: string; tpl: LinkedInTemplate } | null>(null);
  const tpl: LinkedInTemplate = choice?.k === curKey ? choice.tpl : current?.next.template ?? (current?.stage === "new" ? "invitation" : "follow_up");
  const setTpl = (v: LinkedInTemplate) => setChoice({ k: curKey, tpl: v });
  const textFor = (k: LinkedInTemplate) => {
    const it = pb.data ? findItem(pb.data.items, "linkedin", k, lang) : null;
    const v = { first_name: current?.firstName, business: current?.company, founder: pb.data?.founderName, signature: pb.data?.signature, calendly: pb.data?.links.calendly, deck: lang === "ES" ? pb.data?.links.deckES : pb.data?.links.deckFR };
    return { subject: k === "inmail" ? fill(it?.subject ?? "", v) : "", body: fill(it?.body ?? "", v) };
  };
  const [draft, setDraft] = React.useState<{ k: string; subject: string; body: string } | null>(null);
  const draftKey = `${curKey}:${tpl}`;
  const text = draft?.k === draftKey ? draft : textFor(tpl);
  const setText = (v: { subject: string; body: string }) => setDraft({ k: draftKey, ...v });
  const tooLong = tpl === "invitation" && text.body.length > LINKEDIN_NOTE_MAX;

  const end = useMutation({ mutationFn: () => api("/api/calls/sessions", { method: "PATCH", body: { id } }), onSuccess: () => { qc.invalidateQueries(); onEnd(); } });
  const log = useMutation({
    mutationFn: (result: LinkedInResult) => api<{ duplicate: boolean; opportunityId: string | null }>("/api/linkedin", {
      body: { idempotency_key: key, session_id: id, result, account_id: current?.accountId ?? "", contact_id: current?.contactId ?? "", profile_url: free ? form.url : "", full_name: free ? form.name : "", company: free ? form.company : "", role: free ? form.role : "", market: free ? lang : current?.country ?? null },
    }),
    onSuccess: (r, result) => {
      toast(r.opportunityId ? t("{outcome}: added to your pipeline", { outcome: t(LINKEDIN_RESULT_LABELS[result]) }) : t(LINKEDIN_RESULT_LABELS[result]));
      setKey(crypto.randomUUID());
      setDraft(null);
      setPinned(["accepted", "replied"].includes(result) && current ? current.key : null);
      if (free && !["accepted", "replied"].includes(result)) setForm({ url: "", name: "", company: "", role: "" });
      ["li-queue", "li-summary", "li-log", "li-sessions", "my-day", "crm"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : t("Error: {message}. Tap again to retry (it won't count twice).", { message: (e as Error).message })),
  });
  const copy = async () => {
    const s = tpl === "inmail" ? `${text.subject}\n\n${text.body}` : text.body;
    try { await navigator.clipboard.writeText(s); toast(t("Copied: paste it in LinkedIn")); } catch { toast(t("Copy blocked by the browser: select the text")); }
  };
  const openProfile = () => { if (current?.linkedinUrl) window.open(current.linkedinUrl, "_blank", "noopener"); else toast(t("Paste the LinkedIn profile link (linkedin.com/in/…).")); };
  const blockedOf = (r: LinkedInResult) => (r === "invited" && limits?.invitations.blocked) || (r === "inmail" && limits?.inmails.blocked) || (free && !current?.linkedinUrl);
  const tap = (r: LinkedInResult) => {
    if (!current || log.isPending) return;
    if (blockedOf(r)) { toast(r === "invited" ? t("Invitation limit reached: messages and follow-ups only for now.") : r === "inmail" ? t("No InMail credit left this month.") : t("Paste the LinkedIn profile link (linkedin.com/in/…).")); return; }
    log.mutate(r);
  };
  const skip = () => { if (current && !free) { setSkipped((x) => [...x, current.key]); setPinned(null); } };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const r = resultForKey(e);
      if (r) { e.preventDefault(); tap(r); return; }
      const k = e.key.toLowerCase();
      if (k === "o") { e.preventDefault(); openProfile(); }
      else if (k === "c") { e.preventDefault(); void copy(); }
      else if (k === "s") { e.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const s = summary.data?.stats;
  const tag = useDateTag();
  const primary = current ? resultsFor(current.stage) : [];
  const counts: [string, number | undefined][] = [["Invitations", s?.invitations], ["Messages", s ? s.messages + s.inmails : undefined], ["Replies", s?.replies], ["Meetings", s?.meetings]];
  return (
    <div data-call-live className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{t("LinkedIn session")}</h1>
          {limits ? <LimitsLine l={limits} /> : null}
        </div>
        <div className="flex items-center gap-2">
          <MoreMenu>
            <MenuItem onClick={openProfile} hint="O">{t("Open the profile")}</MenuItem>
            <MenuItem onClick={() => void copy()} hint="C">{t("Copy the message")}</MenuItem>
            {!free ? <MenuItem onClick={skip} hint="S">{t("Skip")}</MenuItem> : null}
            <p className="max-w-72 px-3 py-2 text-[12px] text-text-3">{t("O open · C copy · I invitation · A accepted · M message · N InMail · R replied · Q qualified · 7 meeting · 4 not interested · S skip")}</p>
          </MoreMenu>
          <Button variant="outline" onClick={() => end.mutate()} disabled={end.isPending}>{t("End session")}</Button>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label={t("Session counts")}>
        {counts.map(([l, v]) => <div key={l} className="flex items-baseline gap-1.5"><dt className="text-text-2">{t(l)}</dt><dd className="num text-lg font-semibold">{v ?? 0}</dd></div>)}
        {!free && queue.data ? <div className="flex items-baseline gap-1.5"><dt className="text-text-2">{t("Left")}</dt><dd className="num text-lg font-semibold">{Math.max(0, list.length - skipped.length)}</dd></div> : null}
      </dl>

      <Panel className="flex flex-col gap-4">
        {free ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input aria-label={t("LinkedIn profile link")} placeholder="linkedin.com/in/…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="sm:col-span-2" />
            <Input aria-label={t("Full name")} placeholder={t("Full name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input aria-label={t("Company")} placeholder={t("Company")} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
        ) : queue.isPending ? <Skeleton className="h-24" /> : !current ? (
          <EmptyState title={t("Nobody left in this session")} action={<Button variant="primary" size="sm" onClick={() => end.mutate()}>{t("See the session summary")}</Button>}>{t("Follow-ups come back on their date (J+3, J+7).")}</EmptyState>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] text-text-2">{isDue ? <b className="font-semibold text-ink">{t(current.next.action)}</b> : t("New prospect")}{current.niche ? ` · ${t(current.niche)}` : ""}{current.city ? ` · ${current.city}` : ""}</p>
              <p className="truncate text-2xl font-semibold tracking-tight">{current.name}</p>
              <p className="text-sm text-text-2">{[current.role, current.company !== current.name ? current.company : ""].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 text-[12px] text-text-3">
                <span className="rounded-full bg-subtle px-2 py-0.5 font-medium text-text-2">{t(LI_STAGE_LABELS[current.stage])}</span>
                {current.lastTouch ? ` ${t("Last touch:")} ${t(LINKEDIN_RESULT_LABELS[TYPE_RESULT[current.lastTouch.type] ?? (current.lastTouch.outcome === "not_interested" ? "not_interested" : "replied")])} · ${new Date(`${current.lastTouch.date}T12:00:00Z`).toLocaleDateString(tag, { day: "numeric", month: "short" })}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={skip}><SkipForward /> {t("Skip")} <span className="text-[11px] opacity-60">S</span></Button>
          </div>
        )}

        {current ? (
          <>
            <Button size="lg" variant="primary" onClick={openProfile} disabled={!current.linkedinUrl} className="h-14 w-full text-base"><ExternalLink /> {t("Open the profile")} <span className="text-[11px] opacity-70">O</span></Button>
            <div className="flex flex-col gap-2 rounded-[16px] bg-subtle/60 p-3">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Message")}>
                {LINKEDIN_TEMPLATES.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={tpl === k} onClick={() => setTpl(k)}
                    className={cn("min-h-8 rounded-full border px-3 text-[13px]", tpl === k ? "border-ink bg-ink text-panel" : "border-control bg-panel hover:bg-subtle")}>
                    {t(LINKEDIN_TEMPLATE_LABELS[k])}{k === current.next.template ? <span className={cn("ml-1 text-[11px]", tpl === k ? "text-panel/70" : "text-text-3")}>· {t("suggested")}</span> : null}
                  </button>
                ))}
              </div>
              {tpl === "inmail" ? <Input aria-label={t("Subject")} value={text.subject} onChange={(e) => setText({ ...text, subject: e.target.value })} className="h-9 bg-panel font-medium" /> : null}
              <Textarea aria-label={t("Message to copy")} rows={tpl === "invitation" ? 4 : 6} value={text.body} onChange={(e) => setText({ ...text, body: e.target.value })} className="bg-panel text-[14px] leading-relaxed" />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="dark" onClick={() => void copy()}><Copy /> {t("Copy")} <span className="text-[11px] opacity-60">C</span></Button>
                {tpl === "invitation" ? <span className={cn("num text-[12px]", tooLong ? "font-semibold text-bad" : "text-text-2")}>{text.body.length}/{LINKEDIN_NOTE_MAX}</span> : null}
                {tooLong ? <span className="text-[12px] text-bad">{t("Too long for a connection note: shorten it.")}</span> : null}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t("What did you do? One tap")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {LINKEDIN_RESULTS.map((r) => {
                  const main = primary.includes(r);
                  const blocked = blockedOf(r);
                  return (
                    <button key={r} type="button" onClick={() => tap(r)} disabled={log.isPending} aria-disabled={blocked || undefined}
                      className={cn("flex min-h-16 flex-col items-center justify-center rounded-[14px] border-2 px-2 text-center text-[15px] font-semibold transition-colors disabled:opacity-50",
                        YES.includes(r) ? (r === "meeting" ? "border-win bg-win text-panel hover:opacity-90" : "border-win bg-panel hover:bg-subtle") : main ? "border-ink bg-panel hover:bg-subtle" : "border-hairline bg-panel text-text-2 hover:bg-subtle",
                        blocked && "border-dashed opacity-50")}>
                      {t(LINKEDIN_RESULT_LABELS[r])}
                      <span className={cn("text-[12px] font-normal", r === "meeting" ? "text-panel/80" : "text-text-3")}>{LINKEDIN_RESULT_KEYS[r]}</span>
                    </button>
                  );
                })}
              </div>
              {limits?.invitations.blocked ? <p className="mt-2 text-[13px] font-medium text-bad">{t("Invitation limit reached: messages and follow-ups only for now.")}</p> : null}
            </div>
          </>
        ) : null}
      </Panel>

      <LinkedInLog sessionId={id} title="This session" />
    </div>
  );
}

/** End of a LinkedIn session: what was done, and the acceptance rate over 30 days (acceptances arrive later). */
export function LinkedInSummary({ id, onNew }: { id: string; onNew: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["li-summary", id], queryFn: () => api<Summary>(`/api/linkedin/summary?id=${id}`) });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { stats: s, last30 } = q.data;
  const tiles: [string, number, string][] = [
    [t("Invitations"), s.invitations, t("Accepted: {n}", { n: s.accepted })],
    [t("Messages"), s.messages + s.inmails, t("{n} InMails", { n: s.inmails })],
    [t("Replies"), s.replies, t("{n} qualified", { n: s.qualified })],
    [t("Meetings"), s.meetings, t("{n} not interested", { n: s.notInterested })],
  ];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold tracking-tight">{t("LinkedIn session summary")}</h1><Button variant="primary" onClick={onNew}>{t("New session")}</Button></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([l, v, n], i) => (
          <div key={l} className={cn("rounded-[20px] p-4", i === 3 ? "bg-ink text-panel" : "bg-panel")}><p className={cn("text-[13px]", i === 3 ? "text-panel/80" : "text-text-2")}>{l}</p><p className="num text-[36px] font-semibold leading-tight">{v}</p><p className={cn("text-[12px]", i === 3 ? "text-panel/75" : "text-text-3")}>{n}</p></div>
        ))}
      </div>
      <Panel>
        <p className="text-sm">{t("Acceptance rate, last 30 days:")} <b className="num font-semibold">{pct(last30.acceptanceRate)}</b> <span className="num text-text-2">({t("Accepted: {n}", { n: last30.accepted })} / {t("{n} invitations", { n: last30.invitations })})</span></p>
        <p className="mt-1 text-[13px] text-text-2">{t("Invitations are accepted days later: tap Accepted when you see it, the first message comes up in your follow-ups.")}</p>
      </Panel>
      <LinkedInLog sessionId={id} title="This session" />
    </div>
  );
}

/** Every LinkedIn tap, one line: when, who, what, next step. */
export function LinkedInLog({ sessionId, days = 14, title }: { sessionId?: string; days?: number; title?: string }) {
  const t = useT();
  const tag = useDateTag();
  const q = useQuery({ queryKey: ["li-log", sessionId ?? "", days], queryFn: () => api<LogRow[]>(`/api/linkedin/log?session_id=${sessionId ?? ""}&days=${days}`) });
  const rows = q.data ?? [];
  const time = (iso: string) => new Date(iso).toLocaleString(tag, sessionId ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Panel>
      <PanelTitle action={rows.length ? <span className="num text-[13px] text-text-2">{t("{n} actions", { n: rows.length })}</span> : null}>{t(title ?? "LinkedIn log")}</PanelTitle>
      {q.isPending ? <Skeleton className="h-16" /> : rows.length === 0 ? <p className="text-sm text-text-2">{t("Each tap of a LinkedIn session appears here.")}</p> : (
        <ul className="flex flex-col divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-[4.5rem_1fr_auto] items-start gap-x-3 py-2 text-sm">
              <span className="num pt-0.5 text-[12px] text-text-3">{time(r.at)}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.linkedinUrl ? <a href={r.linkedinUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.name}</a> : r.name}{r.company && r.company !== r.name ? <span className="font-normal text-text-3"> · {r.company}</span> : null}</span>
                {r.next_action ? <span className="block text-[12px] text-text-3">→ {t(r.next_action)}{r.next_action_due ? ` · ${new Date(`${r.next_action_due}T12:00:00Z`).toLocaleDateString(tag, { day: "2-digit", month: "short" })}` : ""}</span> : null}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", r.result === "meeting" ? "bg-win text-panel" : YES.includes(r.result) ? "border border-win text-win" : "bg-subtle text-text-2")}>{t(LINKEDIN_RESULT_LABELS[r.result])}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
