"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, Input, Panel, PanelTitle, SegmentedSwitch, Select, Skeleton, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { OBJECTION_LABELS, type Objection } from "@/domain/constants";
import { REPLY_STEP_MAX_WORDS, REPLY_STEP_NAMES, replySteps, wordCount } from "@/domain/objections";
import {
  CUSTOM_KINDS, DEFAULT_PLAYBOOK, EMAIL_TEMPLATE_LABELS, LINKEDIN_TEMPLATE_LABELS, PLACEHOLDERS, fill, textLimit,
  type CustomKind, type Lang, type PlaybookItem, type PlaybookKind, type TemplateKey,
} from "@/domain/playbook";
import type { PlaybookData } from "@/domain/messages";
import { useLocale, useT } from "@/i18n/react";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConflictNotice } from "./conflict";
import { SenderLine } from "./instant-send";

/**
 * Settings › Templates (D090): ONE place for every text the app sends or shows to prospects — call opener and downsell
 * pitches, objection replies (3 steps, both variants), emails, WhatsApp, LinkedIn, inbox suggested replies — plus the
 * founders' own templates per channel. FR and ES by tab, search, live preview on a sample prospect, placeholder chips,
 * counters and limits, back to the original text, and a visible 409 when the other founder saved first.
 */
type Group = "call" | "objection" | "email" | "whatsapp" | "linkedin" | "inbox" | "custom";
const GROUPS: { id: Group; title: string; kinds: PlaybookKind[] }[] = [
  { id: "call", title: "Call: opener and downsell pitches", kinds: ["opener"] },
  { id: "objection", title: "Objection replies (3 steps, said live)", kinds: ["objection"] },
  { id: "email", title: "Emails", kinds: ["email"] },
  { id: "whatsapp", title: "WhatsApp", kinds: ["whatsapp"] },
  { id: "linkedin", title: "LinkedIn", kinds: ["linkedin"] },
  { id: "inbox", title: "Inbox suggested replies", kinds: ["inbox"] },
  { id: "custom", title: "Your own templates", kinds: [] },
];
const INBOX_LABELS: Record<string, string> = { thanks: "Thank-you for a comment", price: "Answer to a price question", call: "Invitation to a call" };
const OPENER_LABELS: Record<string, string> = { default: "Call opener", pitch_local: "Local pitch (after a no to Consulting, said live)", pitch_thirty: "30/30 pitch (after a no to Local, said live)" };
const KIND_NAMES: Record<CustomKind, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn" };
const PLACEHOLDER_HINTS: Record<string, string> = {
  contact: "Contact's name", first_name: "First name", business: "Business name", founder: "Your first name", signature: "Your signature",
  calendly: "Your Calendly link", deck: "Deck link", local_price: "Local price per month", thirty: "30/30 link",
};

type Entry = { item: PlaybookItem; title: string; group: Group; missing?: boolean };

function useTitle() {
  const t = useT();
  return (i: PlaybookItem): string => {
    if (i.custom) return i.name ?? i.key;
    if (i.kind === "objection") { const [o, v] = i.key.split("#"); return `${t(OBJECTION_LABELS[o as Objection] ?? o)} · ${t("reply {n}", { n: v ?? "1" })}`; }
    if (i.kind === "email" || i.kind === "whatsapp") return t(EMAIL_TEMPLATE_LABELS[i.key as TemplateKey] ?? i.key);
    if (i.kind === "linkedin") return t(LINKEDIN_TEMPLATE_LABELS[i.key as keyof typeof LINKEDIN_TEMPLATE_LABELS] ?? i.key);
    if (i.kind === "inbox") return t(INBOX_LABELS[i.key] ?? i.key);
    return t(OPENER_LABELS[i.key] ?? i.key);
  };
}

export function TemplatesView() {
  const t = useT();
  const title = useTitle();
  const founderLang: Lang = useLocale() === "es" ? "ES" : "FR";
  const [lang, setLang] = React.useState<Lang>(founderLang);
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const q = useQuery({ queryKey: ["playbook"], queryFn: () => api<PlaybookData>("/api/playbook") });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pb = q.data;
  const entries: Entry[] = [];
  for (const i of pb.items) if (!i.custom && i.language === lang) entries.push({ item: i, title: title(i), group: (GROUPS.find((g) => g.kinds.includes(i.kind))?.id ?? "call") });
  // Own templates: one entry per key; a language not written yet is an empty text to write.
  for (const key of [...new Set(pb.items.filter((i) => i.custom).map((i) => i.key))]) {
    const mine = pb.items.find((i) => i.custom && i.key === key && i.language === lang);
    const any = pb.items.find((i) => i.custom && i.key === key)!;
    const item = mine ?? { ...any, language: lang, subject: "", body: "", version: 0 };
    entries.push({ item, title: item.name ?? key, group: "custom", missing: !mine });
  }
  const needle = search.trim().toLowerCase();
  const shown = needle ? entries.filter((e) => `${e.title} ${e.item.subject} ${e.item.body}`.toLowerCase().includes(needle)) : entries;
  const sample = { contact: "Julien", first_name: "Julien", business: lang === "ES" ? "Fontanería Gil" : "Plomberie Martin", founder: pb.founderName, signature: pb.signature, calendly: pb.links.calendly, deck: lang === "ES" ? pb.links.deckES : pb.links.deckFR, thirty: pb.links.thirty, local_price: pb.localPrice };
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-3">
        <PanelTitle action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus /> {t("New template")}</Button>}>{t("Templates")}</PanelTitle>
        <p className="max-w-2xl text-sm text-text-2">{t("Every text the app sends or shows to prospects, in one place. Edit it here: the call screen, the message cards, LinkedIn and the inbox use it at once. Nothing is ever sent without your click.")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
            <Input aria-label={t("Search templates")} placeholder={t("Search templates")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9" />
          </div>
          <SegmentedSwitch size="sm" label={t("Language")} value={lang} onChange={(v) => { setLang(v); setOpen(null); }} options={[{ value: "FR", label: t("French") }, { value: "ES", label: t("Spanish") }]} />
        </div>
        <p className="text-[13px]"><SenderLine sender={pb.sender} /> <span className="text-text-3">· {t("Preview with a sample prospect: {contact}, {business}.", { contact: sample.contact, business: sample.business })}</span></p>
      </Panel>
      {GROUPS.map((g) => {
        const list = shown.filter((e) => e.group === g.id);
        if (!list.length && !(g.id === "custom" && !needle)) return null;
        return (
          <Panel key={g.id} aria-label={t(g.title)}>
            <PanelTitle action={<span className="num text-[13px] text-text-3">{list.length}</span>}>{t(g.title)}</PanelTitle>
            {g.id === "custom" && list.length === 0 ? (
              <EmptyState title={t("No template of your own yet")} action={<Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus /> {t("New template")}</Button>}>{t("Create one for email, WhatsApp or LinkedIn: it shows up as an extra choice in the call screen, the message session, LinkedIn and the inbox.")}</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {list.map((e) => {
                  const id = `${e.item.kind}:${e.item.key}:${lang}`;
                  const isOpen = open === id;
                  return (
                    <li key={id} className="border-t border-hairline first:border-t-0">
                      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)} className="flex w-full items-center gap-2 py-2.5 text-left">
                        {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0 text-text-3" />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{e.title}{e.item.custom ? <span className="ml-2 text-[12px] font-normal text-text-3">{KIND_NAMES[e.item.kind as CustomKind]}</span> : null}</span>
                          {!isOpen ? <span className="block truncate text-[12px] text-text-3">{e.missing ? t("Not written in this language yet") : e.item.body.split("\n")[0]}</span> : null}
                        </span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", e.item.custom ? "bg-subtle text-text-2" : e.item.edited ? "bg-sales/15 text-ink" : "text-text-3")}>{e.item.custom ? t("yours") : e.item.edited ? t("edited") : t("original")}</span>
                      </button>
                      {isOpen ? <TemplateEditor key={`${id}:${e.item.version ?? 0}`} item={e.item} title={e.title} sample={sample} onDone={() => setOpen(null)} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        );
      })}
      {needle && shown.length === 0 ? <p className="text-sm text-text-2">{t("No template matches “{q}”.", { q: search.trim() })}</p> : null}
      <NewTemplate open={creating} onOpenChange={setCreating} lang={lang} onCreated={(id) => setOpen(id)} />
    </div>
  );
}

type Sample = Parameters<typeof fill>[1];

function TemplateEditor({ item, title, sample, onDone }: { item: PlaybookItem; title: string; sample: Sample; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const def = item.custom ? null : DEFAULT_PLAYBOOK.find((d) => d.kind === item.kind && d.key === item.key && d.language === item.language) ?? null;
  const [subject, setSubject] = React.useState(item.subject);
  const [body, setBody] = React.useState(item.body);
  const [name, setName] = React.useState(item.name ?? "");
  const [expected, setExpected] = React.useState(item.version ?? 0);
  const [conflict, setConflict] = React.useState<Record<string, unknown> | null>(null);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const hasSubject = item.kind === "email" || (item.kind === "linkedin" && (item.key === "inmail" || item.custom));
  const limit = textLimit(item.kind, item.key);
  const len = body.trim().length;
  const over = limit !== null && len > limit;
  const steps = item.kind === "objection" ? [0, 1, 2].map((n) => replySteps(body)[n] ?? "") : null;
  const save = useMutation({
    mutationFn: (v: { subject: string; body: string; expected: number }) => api<{ version?: number } | null>("/api/playbook", { body: { kind: item.kind, key: item.key, language: item.language, subject: v.subject, body: v.body, expected_version: v.expected, ...(item.custom ? { name: name.trim() } : {}) } }),
    onSuccess: (_r, v) => { setConflict(null); qc.invalidateQueries({ queryKey: ["playbook"] }); qc.invalidateQueries({ queryKey: ["inbox"] }); toast(v.body.trim() ? t("Saved") : t("Back to the original text")); if (!v.body.trim()) onDone(); },
    onError: (e) => { if (e instanceof ApiError && e.isConflict) setConflict(e.body.current ?? {}); else toast((e as Error).message); },
  });
  const del = useMutation({
    mutationFn: () => api("/api/playbook/custom", { method: "DELETE", body: { kind: item.kind, key: item.key, expected_versions: { [item.language]: expected } } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["playbook"] }); toast(t("Template deleted")); onDone(); },
    onError: (e) => { if (e instanceof ApiError && e.isConflict) setConflict(e.body.current ?? {}); else toast((e as Error).message); },
  });
  const insert = (p: string) => {
    const el = ref.current;
    const token = `{${p}}`;
    if (!el) { setBody((b) => `${b}${token}`); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };
  const setStep = (n: number, v: string) => { const s = [...(steps ?? ["", "", ""])]; s[n] = v.replace(/\n/g, " "); setBody(s.join("\n")); };
  const isOriginal = def ? def.body === body && def.subject === subject : false;
  const dirty = body !== item.body || subject !== item.subject || (item.custom ? name.trim() !== (item.name ?? "") : false);
  const id = `tpl-${item.kind}-${item.key}-${item.language}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  return (
    <form className="mb-3 flex flex-col gap-3 rounded-[14px] bg-subtle/50 p-3" aria-label={title}
      onSubmit={(e) => { e.preventDefault(); if (!over && body.trim()) save.mutate({ subject, body, expected }); }}>
      {conflict ? (
        <ConflictNotice mine={{ subject, body }} current={conflict} fields={hasSubject ? ["subject", "body"] : ["body"]}
          onKeepTheirs={() => { setSubject(String(conflict.subject ?? "")); setBody(String(conflict.is_archived ? def?.body ?? "" : conflict.body ?? "")); setExpected(Number(conflict.version ?? 0)); setConflict(null); qc.invalidateQueries({ queryKey: ["playbook"] }); }}
          onApplyMine={() => { const v = Number(conflict.version ?? 0); setExpected(v); save.mutate({ subject, body, expected: v }); }} />
      ) : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          {item.custom ? <Field label={t("Name")} htmlFor={`${id}-name`}><Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="h-9 bg-panel" /></Field> : null}
          {hasSubject ? <Field label={t("Subject")} htmlFor={`${id}-subj`}><Input id={`${id}-subj`} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} className="h-9 bg-panel font-medium" /></Field> : null}
          {steps ? (
            steps.map((s, n) => {
              const words = wordCount(s);
              return (
                <Field key={n} label={`${n + 1}/3 ${t(REPLY_STEP_NAMES[n])}`} htmlFor={`${id}-s${n}`} hint={<span className={cn(words > REPLY_STEP_MAX_WORDS && "text-bad")}>{t("{n} words (aim for {max} at most: it is read out live)", { n: words, max: REPLY_STEP_MAX_WORDS })}</span>}>
                  <Input id={`${id}-s${n}`} value={s} onChange={(e) => setStep(n, e.target.value)} className="h-9 bg-panel" />
                </Field>
              );
            })
          ) : (
            <>
              <Field label={t("Text")} htmlFor={`${id}-body`}>
                <Textarea ref={ref} id={`${id}-body`} rows={item.kind === "email" ? 9 : 5} value={body} onChange={(e) => setBody(e.target.value)} className={cn("bg-panel text-[14px] leading-relaxed", over && "border-bad")} />
              </Field>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("Insert a placeholder")}>
                <span className="text-[12px] text-text-3">{t("Insert:")}</span>
                {PLACEHOLDERS.map((p) => (
                  <button key={p} type="button" title={t(PLACEHOLDER_HINTS[p])} onClick={() => insert(p)} className="rounded-full border border-control bg-panel px-2 py-0.5 font-mono text-[11px] hover:bg-subtle">{`{${p}}`}</button>
                ))}
              </div>
            </>
          )}
          <p className={cn("num text-[12px]", over ? "font-semibold text-bad" : "text-text-3")} aria-live="polite">
            {limit !== null ? t("{n} / {max} characters", { n: len, max: limit }) : t("{n} characters", { n: len })}
            {over ? ` · ${t("Too long: LinkedIn refuses a connection note over {max} characters.", { max: limit ?? 0 })}` : ""}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-[12px] border border-hairline bg-panel p-3" aria-label={t("Preview")}>
          <p className="text-[12px] font-medium text-text-2">{t("Preview")}</p>
          {hasSubject && subject ? <p className="text-sm font-semibold">{fill(subject, sample)}</p> : null}
          <p className="whitespace-pre-line text-[13px] leading-relaxed">{body.trim() ? fill(body, sample) : <span className="text-text-3">{t("Write the text to see it here.")}</span>}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={save.isPending || !dirty || over || !body.trim() || (item.custom && !name.trim())}>{save.isPending ? t("Saving…") : t("Save")}</Button>
        {def && (item.edited || !isOriginal) ? (
          <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => { if (item.edited) save.mutate({ subject: "", body: "", expected }); else { setBody(def.body); setSubject(def.subject); } }}><RotateCcw /> {t("Back to the original text")}</Button>
        ) : null}
        {item.custom ? <Button type="button" size="sm" variant="ghost" disabled={del.isPending} onClick={() => { if (window.confirm(t("Delete “{name}” in both languages?", { name: item.name ?? "" }))) del.mutate(); }}><Trash2 /> {t("Delete template")}</Button> : null}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t("Close")}</Button>
      </div>
    </form>
  );
}

function NewTemplate({ open, onOpenChange, lang, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; lang: Lang; onCreated: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const empty = { kind: "whatsapp" as CustomKind, name: "", subject: "", body: "" };
  const [v, setV] = React.useState(empty);
  const [uid, setUid] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: () => api<{ key: string; kind: string }>("/api/playbook/custom", { body: { id: uid, kind: v.kind, name: v.name, language: lang, subject: v.kind === "whatsapp" ? "" : v.subject, body: v.body } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["playbook"] }); toast(t("Template created")); onCreated(`${r.kind}:${r.key}:${lang}`); setV(empty); setUid(crypto.randomUUID()); onOpenChange(false); },
    onError: (e) => toast((e as Error).message),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("New template")} description={t("Written in {language} first; open it again to add the other language.", { language: lang === "ES" ? t("Spanish") : t("French") })}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.name.trim() && v.body.trim()) m.mutate(); }}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Channel")} htmlFor="nt-kind"><Select id="nt-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as CustomKind })}>{CUSTOM_KINDS.map((k) => <option key={k} value={k}>{k === "email" ? t("Email") : KIND_NAMES[k]}</option>)}</Select></Field>
          <Field label={t("Name")} htmlFor="nt-name" hint={t("Shown on the template chips.")}><Input id="nt-name" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        </div>
        {v.kind !== "whatsapp" ? <Field label={t("Subject")} htmlFor="nt-subj"><Input id="nt-subj" value={v.subject} maxLength={300} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field> : null}
        <Field label={t("Text")} htmlFor="nt-body" hint={<>{t("Placeholders:")} {PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}</>}><Textarea id="nt-body" rows={6} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={m.isPending || !v.name.trim() || !v.body.trim()}>{m.isPending ? t("Saving…") : t("Create")}</Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
        </div>
      </form>
    </Modal>
  );
}
