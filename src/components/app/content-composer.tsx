"use client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Copy, ExternalLink, File, FileImage, FileVideo, Folder, Info, Plus, Search, Trash2, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorState, Field, Input, SegmentedSwitch, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { useDateTag, useT } from "@/i18n/react";
import { addDays } from "@/domain/time";
import {
  CHECKPOINTS, CONTENT_FORMATS, FORMAT_LABELS, PLATFORM_LIMITS, PRODUCTION_STAGES, STAGE_LABELS, bestTimeFor, composeCaption, counters, inBestHours, mediaFit,
  mediaRefOf, utmUrl, type ContentFormat, type LinkPlacement, type MediaRef, type Network,
} from "@/domain/content-studio";
import { scorePost, type Finding, type ScoreResult } from "@/domain/content-score";
import type { MediaListing, Studio } from "@/server/services/content-studio";
import type { DriveFile } from "@/data/google/ports";
import { FOUNDER_NAMES } from "@/domain/constants";

/**
 * Content Studio composer (iteration 11, D081): one piece, its versions per account and language, the
 * Drive media picked "en mode shell" (ids only), per-network counters and a live, explainable score. Autosaves each
 * field group with expected_version; a 409 is shown with "load their version" / "keep mine". Publishing stays human.
 */
export type Piece = Studio["pieces"][number];
export type Variant = Piece["variants"][number];
export type Account = Studio["accounts"][number];

export const BRAND_NAME: Record<string, string> = { thirty: "30/30 AI", consulting: "Valemont" };
const BRAND_DOT: Record<string, string> = { thirty: "bg-brand-thirty", consulting: "bg-brand-consulting" };
export function BrandTag({ brand }: { brand: string | null }) {
  const t = useT();
  if (!brand) return <span className="text-[12px] text-text-3">{t("Personal")}</span>;
  return <span className="inline-flex items-center gap-1 text-[12px] text-text-2"><span aria-hidden className={cn("size-2 rounded-full", BRAND_DOT[brand] ?? "bg-brand-consulting")} />{BRAND_NAME[brand] ?? "Valemont"}</span>;
}
/** "in Théo · FR" / "IG 30/30 AI · ES": short label of a version on cards and chips. */
export const versionLabel = (v: { network: Network; account: string; language: string }) => `${v.account || (v.network === "linkedin" ? "LinkedIn" : "Instagram")} · ${v.language}`;
export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  const t = useT();
  if (score === null) return null;
  const tone = score >= 80 ? "bg-win-soft text-win" : score >= 60 ? "bg-subtle text-text-2" : "bg-bad/10 text-bad";
  return <span className={cn("num inline-flex items-center rounded-full px-1.5 text-[11px] font-semibold", tone, className)} title={t("Optimizer score")}>{score}/100</span>;
}

export function useSaveHandlers() {
  const qc = useQueryClient();
  const t = useT();
  return (onDone?: () => void) => ({
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["content-studio"] }); qc.invalidateQueries({ queryKey: ["marketing-week"] }); onDone?.(); },
    onError: (e: unknown) => { if (e instanceof ApiError && e.isConflict) { toast(t("Someone else changed this record. Review both versions.")); qc.invalidateQueries({ queryKey: ["content-studio"] }); } },
  });
}

/* ---------- autosave with expected_version ---------- */

type SaveStatus = "saved" | "pending" | "saving" | "conflict" | "error";
/**
 * Local copy of a mutable row, saved 1.2 s after the last change (one request at a time, always with the last confirmed
 * version). Another founder's change is taken in when nothing is pending; a 409 stops autosave until the founder chooses.
 */
function useAutosave<T>(remote: T, remoteVersion: number, save: (value: T, expected: number, action: string) => Promise<{ version: number }>) {
  const qc = useQueryClient();
  const [value, setValue] = React.useState<T>(remote);
  const [status, setStatus] = React.useState<SaveStatus>("saved");
  const [error, setError] = React.useState<unknown>(null);
  const valRef = React.useRef(value);
  const remoteRef = React.useRef({ remote, remoteVersion });
  const saveRef = React.useRef(save);
  const ver = React.useRef(remoteVersion);
  const saved = React.useRef(JSON.stringify(remote));
  const chain = React.useRef<Promise<unknown>>(Promise.resolve());
  const statusRef = React.useRef(status);
  React.useLayoutEffect(() => {
    valRef.current = value;
    remoteRef.current = { remote, remoteVersion };
    saveRef.current = save;
    statusRef.current = status;
  });

  const run = React.useCallback((action = "save") => {
    chain.current = chain.current.then(async () => {
      const v = valRef.current;
      const j = JSON.stringify(v);
      if (action === "save" && j === saved.current) return setStatus((s) => (s === "conflict" ? s : "saved"));
      setStatus("saving");
      try {
        const r = await saveRef.current(v, ver.current, action);
        ver.current = r.version;
        saved.current = j;
        setError(null);
        setStatus(JSON.stringify(valRef.current) === j ? "saved" : "pending");
        qc.invalidateQueries({ queryKey: ["content-studio"] });
        if (action !== "save") qc.invalidateQueries({ queryKey: ["marketing-week"] });
      } catch (e) {
        if (e instanceof ApiError && e.isConflict) { setStatus("conflict"); qc.invalidateQueries({ queryKey: ["content-studio"] }); } else { setStatus("error"); setError(e); }
      }
    });
    return chain.current;
  }, [qc]);

  const json = JSON.stringify(value);
  React.useEffect(() => {
    if (json === saved.current || statusRef.current === "conflict") return;
    setStatus("pending");
    const h = setTimeout(() => void run(), 1200);
    return () => clearTimeout(h);
  }, [json, run]);
  // Someone else saved and nothing is pending here: take their version in.
  React.useEffect(() => {
    const { remote: r, remoteVersion: rv } = remoteRef.current;
    if (rv > ver.current && JSON.stringify(valRef.current) === saved.current) {
      setValue(r);
      saved.current = JSON.stringify(r);
      ver.current = rv;
    }
  }, [remoteVersion]);
  // Closing the composer flushes the last change.
  React.useEffect(() => () => { if (JSON.stringify(valRef.current) !== saved.current && statusRef.current !== "conflict") void run(); }, [run]);

  const takeTheirs = () => { const { remote: r, remoteVersion: rv } = remoteRef.current; setValue(r); saved.current = JSON.stringify(r); ver.current = rv; setStatus("saved"); };
  const keepMine = () => { ver.current = remoteRef.current.remoteVersion; setStatus("pending"); void run(); };
  return { value, setValue, status, error, run, takeTheirs, keepMine };
}

function SaveState({ s, onTheirs, onMine, error }: { s: SaveStatus; onTheirs: () => void; onMine: () => void; error: unknown }) {
  const t = useT();
  if (s === "conflict") return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-bad p-2 text-[13px]">
      <AlertTriangle className="size-4 text-bad" />{t("Someone else changed this record. Review both versions.")}
      <Button size="sm" variant="outline" onClick={onTheirs}>{t("Load their version")}</Button>
      <Button size="sm" variant="ghost" onClick={onMine}>{t("Keep mine")}</Button>
    </div>
  );
  if (s === "error") return <ErrorState error={error} onRetry={onMine} />;
  return <span className="text-[12px] text-text-3" aria-live="polite">{s === "saved" ? t("Saved") : s === "saving" ? t("Saving…") : t("Not saved yet")}</span>;
}

/* ---------- composer dialog ---------- */

export function Composer({ piece, studio, onClose, focus }: { piece: Piece; studio: Studio; onClose: () => void; focus?: string | null }) {
  const t = useT();
  const [vid, setVid] = React.useState<string | null>(focus ?? piece.variants[0]?.id ?? null);
  const [adding, setAdding] = React.useState(false);
  const variant = piece.variants.find((v) => v.id === vid) ?? piece.variants[0] ?? null;
  return (
    <D.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <D.Content data-composer aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-canvas focus:outline-none lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[min(1120px,calc(100vw-2rem))] lg:shadow-[0_12px_40px_rgba(23,22,26,0.18)]">
          <div className="flex items-start justify-between gap-3 border-b border-hairline bg-panel px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <D.Title className="truncate text-lg font-semibold tracking-tight">{piece.title}</D.Title>
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-text-2"><BrandTag brand={piece.brand} /><span>{t(FORMAT_LABELS[piece.format])}</span><span>· {t(STAGE_LABELS[piece.column])}</span></p>
            </div>
            <D.Close className="rounded-full p-2 text-text-2 hover:bg-subtle" aria-label={t("Close")}><X className="size-5" /></D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4">
              <PieceFields key={piece.id} piece={piece} />
              <section aria-label={t("Versions")} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">{t("Versions")}</h2>
                  <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1" role="tablist" aria-label={t("Versions")}>
                    {piece.variants.map((v) => (
                      <button key={v.id} type="button" role="tab" aria-selected={variant?.id === v.id} onClick={() => setVid(v.id)}
                        className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px]", variant?.id === v.id ? "bg-ink text-panel" : "bg-panel text-text-2 hover:bg-subtle")}>
                        {versionLabel(v)}<ScoreBadge score={v.score.score} className={variant?.id === v.id ? "bg-panel/20 text-panel" : ""} />
                        {v.conflicts.length ? <AlertTriangle aria-label={t("Conflict")} className="size-3.5 text-bad" /> : null}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="size-4" />{t("Add an account")}</Button>
                </div>
                {variant ? <VersionEditor key={variant.id} piece={piece} variant={variant} studio={studio} /> : (
                  <p className="rounded-[12px] bg-panel p-4 text-sm text-text-2">{t("An idea with no version yet. Add the accounts where it will go out to write the post.")}</p>
                )}
              </section>
            </div>
          </div>
          <AddAccounts open={adding} onOpenChange={setAdding} piece={piece} accounts={studio.accounts} onAdded={(ids) => { setAdding(false); if (ids[0]) setVid(ids[0]); }} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const PERSONAL = "personal";
function PieceFields({ piece }: { piece: Piece }) {
  const t = useT();
  const remote = { title: piece.title, format: piece.format, brand: piece.brand ?? PERSONAL, notes: piece.notes, script: piece.script, target_persona: piece.target_persona, hook: piece.hook };
  const a = useAutosave(remote, piece.version, (v, expected) => api<{ version: number }>("/api/content", { method: "PATCH", body: { id: piece.id, expected_version: expected, patch: { ...v, title: v.title.trim() || piece.title, brand: v.brand === PERSONAL ? null : v.brand } } }));
  const stage = useStageMove(piece);
  const v = a.value;
  const prod = (PRODUCTION_STAGES as readonly string[]).includes(piece.column);
  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-panel p-4" aria-label={t("Idea")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {prod ? <SegmentedSwitch size="sm" label={t("Step")} value={piece.column} onChange={(s) => stage.mutate(s)} options={PRODUCTION_STAGES.map((s) => ({ value: s, label: t(STAGE_LABELS[s]) }))} />
          : <p className="text-[13px] text-text-2">{t("The versions drive this step: schedule or publish them below.")}</p>}
        <SaveState s={a.status} error={a.error} onTheirs={a.takeTheirs} onMine={a.keepMine} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_160px]">
        <Field label={t("Title")} htmlFor="cp-title"><Input id="cp-title" value={v.title} maxLength={200} onChange={(e) => a.setValue({ ...v, title: e.target.value })} /></Field>
        <Field label={t("Type")} htmlFor="cp-type"><Select id="cp-type" value={v.format} onChange={(e) => a.setValue({ ...v, format: e.target.value as ContentFormat })}>{CONTENT_FORMATS.map((f) => <option key={f} value={f}>{t(FORMAT_LABELS[f])}</option>)}</Select></Field>
        <Field label={t("Brand")} htmlFor="cp-brand"><Select id="cp-brand" value={v.brand} onChange={(e) => a.setValue({ ...v, brand: e.target.value })}><option value="consulting">Valemont</option><option value="thirty">30/30 AI</option><option value={PERSONAL}>{t("Personal")}</option></Select></Field>
      </div>
      <Field label={t("The idea in a few lines")} htmlFor="cp-notes"><Textarea id="cp-notes" rows={2} maxLength={2000} value={v.notes} onChange={(e) => a.setValue({ ...v, notes: e.target.value })} /></Field>
      {v.format === "reel" || v.format === "video" || v.format === "story" ? (
        <details className="text-sm" open={Boolean(v.script)}>
          <summary className="cursor-pointer text-[13px] font-semibold text-text-2">{t("Video script")}</summary>
          <Textarea aria-label={t("Video script")} className="mt-2" rows={4} value={v.script} onChange={(e) => a.setValue({ ...v, script: e.target.value })} />
        </details>
      ) : null}
      {stage.isError ? <ErrorState error={stage.error} onRetry={() => stage.reset()} /> : null}
      <div><Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("Archive this piece?"))) void api("/api/content", { method: "PATCH", body: { id: piece.id, expected_version: piece.version, patch: { is_archived: true } } }).then(() => window.dispatchEvent(new Event("content-archived"))); }}>{t("Archive")}</Button></div>
    </section>
  );
}

/** Board move (drag, keyboard or step switch): POST /api/content/move with the card's version. */
export function useStageMove(piece: { id: string; version: number }) {
  const save = useSaveHandlers();
  const t = useT();
  return useMutation({
    mutationFn: (to: string) => api<{ scheduled: number; unscheduled: number }>("/api/content/move", { body: { id: piece.id, expected_version: piece.version, to } }),
    ...save(),
    onSuccess: (r) => { save().onSuccess(); if (r.unscheduled) toast(t("{n} version(s) back to draft (dates kept).", { n: r.unscheduled })); if (r.scheduled) toast(t("{n} version(s) scheduled.", { n: r.scheduled })); },
  });
}

/* ---------- one version ---------- */

type Draft = {
  hook: string; caption: string; cta: string; hashtags: string; alt_text: string; first_comment: string; cover_text: string; link_placement: LinkPlacement;
  destination_url: string; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string;
  scheduled_date: string; scheduled_time: string; checklist_done: string[]; platform_post_url: string; media: MediaRef[];
};
const draftOf = (v: Variant): Draft => ({
  hook: v.hook, caption: v.caption, cta: v.cta, hashtags: v.hashtags, alt_text: v.alt_text, first_comment: v.first_comment, cover_text: v.cover_text, link_placement: v.link_placement,
  destination_url: v.destination_url, utm_source: v.utm_source, utm_medium: v.utm_medium, utm_campaign: v.utm_campaign, utm_content: v.utm_content,
  scheduled_date: v.scheduled_date ?? "", scheduled_time: v.scheduled_time, checklist_done: v.checklist_done, platform_post_url: v.platform_post_url, media: v.drive_media,
});
const patchOf = (d: Draft) => {
  const { media, scheduled_date, destination_url, platform_post_url, ...rest } = d;
  return { ...rest, scheduled_date: scheduled_date || null, destination_url: destination_url.trim(), platform_post_url: platform_post_url.trim(), drive_media: media.map((m) => ({ file_id: m.file_id })) };
};
const APP_URL: Record<Network, string> = { linkedin: "https://www.linkedin.com/feed/", instagram: "https://www.instagram.com/" };

function VersionEditor({ piece, variant, studio }: { piece: Piece; variant: Variant; studio: Studio }) {
  const t = useT();
  const a = useAutosave(draftOf(variant), variant.version, (d, expected, action) =>
    api<{ version: number }>("/api/content/variants", { method: "PATCH", body: { id: variant.id, expected_version: expected, action, patch: action === "unschedule" ? {} : patchOf(d) } }));
  const d = a.value;
  const set = (p: Partial<Draft>) => a.setValue({ ...d, ...p });
  const net = variant.network;
  const L = PLATFORM_LIMITS[net];
  const link = utmUrl(d.destination_url, d);
  const hook = d.hook || piece.hook;
  const caption = composeCaption(net, { ...d, hook, link });
  const firstComment = [d.first_comment.trim(), net === "linkedin" && d.link_placement === "first_comment" ? link : ""].filter(Boolean).join("\n\n");
  const c = counters(net, caption, firstComment);
  const score = scorePost({ network: net, type: piece.format, language: variant.language, ...d, hook, link, media: d.media, checklist: d.checklist_done, scheduled_date: d.scheduled_date || null, keywords: studio.keywords[variant.language], brandTerms: studio.brandTerms });
  const others = piece.variants.filter((x) => x.id !== variant.id);
  const items = studio.checklists[net];
  const [picking, setPicking] = React.useState(false);
  const copy = (text: string, msg: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); toast(t(msg)); };
  const conflicts = studio.schedule.filter((s) => variant.conflicts.includes(s.id));
  const published = variant.status === "published";

  const copyFrom = (id: string) => {
    const o = others.find((x) => x.id === id);
    if (!o) return;
    if ((d.caption || d.hook) && !window.confirm(t("Replace this version's text with the one of {name}?", { name: versionLabel(o) }))) return;
    set({ hook: o.hook, caption: o.caption, cta: o.cta, hashtags: o.hashtags, alt_text: o.alt_text, first_comment: o.first_comment, cover_text: o.cover_text, media: o.drive_media });
    if (o.language !== variant.language) toast(t("Copied from {name}: translate it into {lang}.", { name: versionLabel(o), lang: variant.language }));
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-[20px] bg-panel p-4" aria-label={t("Version {lang}", { lang: versionLabel(variant) })}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-text-2">{variant.account || t("No account linked")} · {t("Owner: {name}", { name: FOUNDER_NAMES[variant.owner_founder] })} · <span className="font-medium text-ink">{t(variant.status === "draft" ? "Draft" : STAGE_LABELS[variant.status])}</span></p>
            <SaveState s={a.status} error={a.error} onTheirs={a.takeTheirs} onMine={a.keepMine} />
          </div>
          {others.length && !published ? (
            <Field label={t("Copy from another version")} htmlFor="vd-copy">
              <Select id="vd-copy" value="" onChange={(e) => copyFrom(e.target.value)}><option value="">{t("Choose a version…")}</option>{others.map((o) => <option key={o.id} value={o.id}>{versionLabel(o)}</option>)}</Select>
            </Field>
          ) : null}
          <Field label={t("Hook")} htmlFor="vd-hook" hint={t("First line: visible before “see more” ({n} characters).", { n: L.fold })}>
            <Input id="vd-hook" value={d.hook} placeholder={piece.hook} maxLength={500} onChange={(e) => set({ hook: e.target.value })} />
          </Field>
          <Field label={t("Body / caption")} htmlFor="vd-cap"><Textarea id="vd-cap" rows={8} value={d.caption} onChange={(e) => set({ caption: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Call to action")} htmlFor="vd-cta"><Input id="vd-cta" value={d.cta} maxLength={300} onChange={(e) => set({ cta: e.target.value })} /></Field>
            <Field label={t("Hashtags")} htmlFor="vd-tags" hint={t("{n} / {max} · 3–5 recommended", { n: c.hashtags, max: L.hashtagsMax })}><Input id="vd-tags" value={d.hashtags} placeholder="#prospection #artisans" maxLength={1000} onChange={(e) => set({ hashtags: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Destination page")} htmlFor="vd-dest"><Input id="vd-dest" type="url" placeholder="https://" value={d.destination_url} onChange={(e) => set({ destination_url: e.target.value })} /></Field>
            <Field label={t("Where the link goes")} htmlFor="vd-place">
              <Select id="vd-place" value={d.link_placement} onChange={(e) => set({ link_placement: e.target.value as LinkPlacement })}>
                {net === "linkedin" ? <><option value="first_comment">{t("First comment")}</option><option value="post">{t("In the post")}</option></> : <><option value="bio">{t("Link in bio or story sticker")}</option><option value="first_comment">{t("First comment")}</option></>}
              </Select>
            </Field>
          </div>
          {link ? <p className="flex items-center gap-2 text-[12px]"><span className="min-w-0 flex-1 truncate text-text-2">{link}</span><Button size="sm" variant="ghost" onClick={() => copy(link, "Link copied")}><Copy className="size-4" />{t("Copy the link")}</Button></p> : null}
          <details className="text-sm">
            <summary className="cursor-pointer text-[13px] font-semibold text-text-2">{t("UTM parameters")}</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const).map((k) => <Field key={k} label={k} htmlFor={`vd-${k}`}><Input id={`vd-${k}`} value={d[k]} onChange={(e) => set({ [k]: e.target.value.replace(/[^\w.-]/g, "") })} /></Field>)}
            </div>
          </details>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("First comment")} htmlFor="vd-fc" hint={t("{n} / {max} characters", { n: c.firstComment, max: c.firstCommentMax })}><Textarea id="vd-fc" rows={2} value={d.first_comment} onChange={(e) => set({ first_comment: e.target.value })} /></Field>
            <Field label={t("Alt text")} htmlFor="vd-alt" hint={t("Describe the image for people who cannot see it.")}><Textarea id="vd-alt" rows={2} maxLength={1000} value={d.alt_text} onChange={(e) => set({ alt_text: e.target.value })} /></Field>
          </div>
          {piece.format !== "post" ? <Field label={t("Cover text")} htmlFor="vd-cover" hint={t("3–6 words, readable in the grid.")}><Input id="vd-cover" value={d.cover_text} maxLength={200} onChange={(e) => set({ cover_text: e.target.value })} /></Field> : null}
        </section>

        <MediaSection piece={piece} network={net} media={d.media} onChange={(media) => set({ media })} onPick={() => setPicking(true)} />
        <MediaPicker open={picking} onOpenChange={setPicking} selected={d.media} onPick={(ms) => { set({ media: [...d.media, ...ms.filter((m) => !d.media.some((x) => x.file_id === m.file_id))].slice(0, 20) }); setPicking(false); }} />

        <section className="flex flex-col gap-3 rounded-[20px] bg-panel p-4" aria-label={t("Schedule")}>
          <h3 className="text-sm font-semibold">{t("Schedule")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Publishing date")} htmlFor="vd-date"><Input id="vd-date" type="date" value={d.scheduled_date} disabled={published} onChange={(e) => set({ scheduled_date: e.target.value })} /></Field>
            <Field label={t("Time")} htmlFor="vd-time"><Input id="vd-time" type="time" value={d.scheduled_time} disabled={published} onChange={(e) => set({ scheduled_time: e.target.value })} /></Field>
          </div>
          {!published ? <RecommendedTimes network={net} accountId={variant.account_id} language={variant.language} today={studio.today} studio={studio} onPick={(date, time) => set({ scheduled_date: date, scheduled_time: time })} /> : null}
          {d.scheduled_date && d.scheduled_time && !inBestHours(net, d.scheduled_date, d.scheduled_time) ? <p className="text-[12px] text-text-2">{t("Outside the usual best hours for this network.")}</p> : null}
          {conflicts.length ? (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-bad"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t("Same account, same slot as: {list}.", { list: conflicts.map((x) => `${x.title} (${x.time || t("no time")})`).join(", ") })}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {variant.status === "draft" ? <Button size="sm" variant="outline" disabled={!d.scheduled_date || a.status === "saving"} onClick={() => void a.run("schedule")}>{t("Schedule")}</Button> : null}
            {variant.status === "scheduled" ? <Button size="sm" variant="ghost" onClick={() => void a.run("unschedule")}>{t("Unschedule")}</Button> : null}
            {variant.status === "draft" ? <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(t("Remove this version?"))) void api("/api/content/variants", { method: "PATCH", body: { id: variant.id, expected_version: variant.version, patch: { is_archived: true } } }).then(() => window.dispatchEvent(new Event("content-archived"))); }}><Trash2 className="size-4" />{t("Remove this version")}</Button> : null}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-[20px] bg-panel p-4" aria-label={t("Publish")}>
          <h3 className="text-sm font-semibold">{t("Publish")}</h3>
          <p className="text-[12px] text-text-2">{t("Publishing stays manual: Valemont OS does not post through the LinkedIn or Instagram API. Copy the caption, open the app, post, then mark it published.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!caption} onClick={() => copy(caption, "Caption copied")}><Copy className="size-4" />{t("Copy the caption")}</Button>
            {firstComment ? <Button size="sm" variant="outline" onClick={() => copy(firstComment, "First comment copied")}><Copy className="size-4" />{t("Copy the first comment")}</Button> : null}
            <Button asChild size="sm" variant="outline"><a href={APP_URL[net]} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />{t(net === "linkedin" ? "Open LinkedIn" : "Open Instagram")}</a></Button>
          </div>
          {net === "instagram" && d.link_placement === "bio" && link ? <p className="text-[12px] text-text-2">{t("Instagram links in captions are not clickable: put the link in the bio or a story sticker.")}</p> : null}
          {!published ? (
            <>
              <Field label={t("Post link (once it is out)")} htmlFor="vd-post"><Input id="vd-post" type="url" placeholder="https://" value={d.platform_post_url} onChange={(e) => set({ platform_post_url: e.target.value })} /></Field>
              <ChecklistTicks items={items} done={d.checklist_done} lang={variant.language} onChange={(checklist_done) => set({ checklist_done })} />
              <Button size="sm" variant="primary" disabled={a.status === "saving"} onClick={() => void a.run("publish")}>{t("Mark as published")}</Button>
            </>
          ) : <MetricsEntry variant={variant} />}
          {piece.format === "story" ? <p className="text-[12px] text-text-3">{t("Instagram serves story numbers for 24 hours only, and none under 5 viewers.")}</p> : null}
        </section>
      </div>
      <ScorePanel score={score} counts={c} network={net} />
    </div>
  );
}

function ChecklistTicks({ items, done, lang, onChange }: { items: { key: string; label: string }[]; done: string[]; lang: string; onChange: (d: string[]) => void }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-semibold text-text-2">{t("Checklist {done}/{total}", { done: items.filter((i) => done.includes(i.key)).length, total: items.length })}</legend>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.key}><label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={done.includes(i.key)} onChange={(e) => onChange(e.target.checked ? [...done, i.key] : done.filter((k) => k !== i.key))} />
            <span className={cn(done.includes(i.key) && "text-text-3 line-through")}>{t(i.label)}{i.key === "subtitles" ? ` (${lang})` : ""}</span>
          </label></li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Next 7 days of the weekly plan for this account (recommended time), plus the best hour of each day. */
function RecommendedTimes({ network, accountId, language, today, studio, onPick }: { network: Network; accountId: string; language: string; today: string; studio: Studio; onPick: (date: string, time: string) => void }) {
  const t = useT();
  const tag = useDateTag();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  const taken = new Set(studio.schedule.filter((s) => s.account_id === accountId).map((s) => s.date));
  const chips = days.map((date) => ({ date, time: bestTimeFor(network, date) })).filter((x) => x.time && !taken.has(x.date)).slice(0, 5);
  if (!chips.length) return null;
  const fmt = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(tag, { weekday: "short", day: "numeric", timeZone: "UTC" });
  return (
    <div>
      <p className="mb-1 text-[12px] text-text-3">{t("Recommended slots (free on this account, {lang})", { lang: language })}</p>
      <div className="flex flex-wrap gap-1.5">{chips.map((c) => <button key={c.date} type="button" onClick={() => onPick(c.date, c.time)} className="num h-8 rounded-full border border-dashed border-control px-3 text-[12px] hover:bg-subtle">{fmt(c.date)} · {c.time}</button>)}</div>
    </div>
  );
}

/* ---------- score panel ---------- */

const GROUP_LABEL: Record<Finding["group"], string> = { algorithm: "Algorithm of the app", seo: "Search and discoverability", format: "Format" };
function ScorePanel({ score, counts, network }: { score: ScoreResult; counts: ReturnType<typeof counters>; network: Network }) {
  const t = useT();
  const tag = useDateTag();
  const groups = (["algorithm", "seo", "format"] as const).map((g) => ({ g, items: score.findings.filter((f) => f.group === g) })).filter((x) => x.items.length);
  const L = PLATFORM_LIMITS[network];
  return (
    <aside aria-label={t("Optimizer")} className="flex flex-col gap-3 self-start rounded-[20px] bg-panel p-4 lg:sticky lg:top-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Optimizer")} · {network === "linkedin" ? "LinkedIn" : "Instagram"}</h3>
        <span className="text-[12px] text-text-3">{t(score.grade === "good" ? "Ready to go" : score.grade === "fair" ? "Can do better" : "Needs work")}</span>
      </div>
      <p className="num text-[44px] font-semibold leading-none tracking-tight" data-score={score.score}>{score.score}<span className="text-lg text-text-3">/100</span></p>
      <div className="h-2 rounded-full bg-subtle" aria-hidden><div className="h-2 rounded-full bg-ink" style={{ width: `${score.score}%` }} /></div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-text-3">{t("Characters")}</dt><dd className={cn("num text-right", counts.over && "font-semibold text-bad")}>{counts.chars.toLocaleString(tag)} / {counts.max.toLocaleString(tag)}</dd>
        <dt className="text-text-3">{t("Hashtags")}</dt><dd className={cn("num text-right", counts.hashtags > L.hashtagsMax && "font-semibold text-bad")}>{counts.hashtags} / {L.hashtagsMax}</dd>
      </dl>
      <div className="rounded-[12px] bg-subtle/60 p-2 text-[12px]">
        <p className="mb-1 text-text-3">{t("Visible before “see more” ({n} characters)", { n: counts.fold })}</p>
        <p className="whitespace-pre-wrap break-words">{counts.visible || "—"}{counts.chars > counts.fold ? <span className="text-text-3"> …</span> : null}</p>
      </div>
      {groups.map(({ g, items }) => (
        <section key={g}>
          <h4 className="mb-1 text-[12px] font-semibold text-text-2">{t(GROUP_LABEL[g])}</h4>
          <ul className="flex flex-col gap-1.5">
            {items.map((f) => (
              <li key={f.key} className="flex gap-2 text-[13px]" data-finding={f.key} data-status={f.status}>
                {f.status === "ok" ? <Check aria-label={t("OK")} className="mt-0.5 size-4 shrink-0 text-win" /> : f.status === "bad" ? <X aria-label={t("To fix")} className="mt-0.5 size-4 shrink-0 text-bad" /> : f.status === "warn" ? <AlertTriangle aria-label={t("To improve")} className="mt-0.5 size-4 shrink-0 text-text-2" /> : <Info aria-label={t("Note")} className="mt-0.5 size-4 shrink-0 text-text-3" />}
                <span className="min-w-0">
                  <span>{t(f.message, f.vars)}</span>
                  {f.weight ? <span className="num text-text-3"> · {f.earned.toLocaleString(tag)}/{f.weight}</span> : null}
                  {f.fix ? <span className="block text-[12px] text-text-2">{t(f.fix, f.vars)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[11px] text-text-3">{t("Explainable score, no AI: each line shows its points. Based on public 2025–2026 ranking signals; your own numbers win.")}</p>
    </aside>
  );
}

/* ---------- Drive media ---------- */

function MediaIcon({ mime, className }: { mime: string; className?: string }) {
  const I = mime === "application/vnd.google-apps.folder" ? Folder : mime.startsWith("image/") ? FileImage : mime.startsWith("video/") ? FileVideo : File;
  return <I className={className} />;
}
function Thumb({ m, className }: { m: MediaRef; className?: string }) {
  const [broken, setBroken] = React.useState(false);
  return m.thumbnail_link && !broken
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={m.thumbnail_link} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn("object-cover", className)} />
    : <span className={cn("flex items-center justify-center bg-subtle", className)}><MediaIcon mime={m.mime} className="size-6 text-text-2" /></span>;
}
const metaOf = (m: MediaRef) => [m.width && m.height ? `${m.width}×${m.height}` : "", m.duration_ms !== null ? `${Math.round(m.duration_ms / 1000)} s` : ""].filter(Boolean).join(" · ");

function MediaSection({ piece, network, media, onChange, onPick }: { piece: Piece; network: Network; media: MediaRef[]; onChange: (m: MediaRef[]) => void; onPick: () => void }) {
  const t = useT();
  const fit = mediaFit(piece.format, network, media);
  const move = (i: number, dir: -1 | 1) => { const n = [...media]; const [x] = n.splice(i, 1); n.splice(i + dir, 0, x); onChange(n); };
  return (
    <section className="flex flex-col gap-3 rounded-[20px] bg-panel p-4" aria-label={t("Media from Drive")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Media from Drive")}</h3>
        <Button size="sm" variant="outline" onClick={onPick}><Folder className="size-4" />{t("Pick in Drive")}</Button>
      </div>
      <p className="text-[12px] text-text-3">{t("Files stay in Drive; only their id, name and link are stored.")}</p>
      {media.length ? (
        <ul className="flex flex-wrap gap-3">
          {media.map((m, i) => (
            <li key={m.file_id} className="flex w-32 flex-col gap-1">
              <Thumb m={m} className="h-24 w-32 rounded-[8px]" />
              <a href={m.web_link} target="_blank" rel="noopener noreferrer" className="truncate text-[12px] underline underline-offset-2" title={m.name}>{m.name}</a>
              <span className="num text-[11px] text-text-3">{metaOf(m) || t("size unknown")}</span>
              <span className="flex gap-1">
                <button type="button" aria-label={t("Move left")} disabled={i === 0} onClick={() => move(i, -1)} className="rounded-full p-1 hover:bg-subtle disabled:opacity-40"><ArrowLeft className="size-3.5" /></button>
                <button type="button" aria-label={t("Move right")} disabled={i === media.length - 1} onClick={() => move(i, 1)} className="rounded-full p-1 hover:bg-subtle disabled:opacity-40"><ArrowRight className="size-3.5" /></button>
                <button type="button" aria-label={t("Remove {name}", { name: m.name })} onClick={() => onChange(media.filter((x) => x.file_id !== m.file_id))} className="rounded-full p-1 hover:bg-subtle"><Trash2 className="size-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="flex flex-col gap-1 text-[12px]">
        {fit.map((f, i) => <li key={i} className={cn("flex items-start gap-1.5", f.level === "bad" ? "text-bad" : f.level === "ok" ? "text-win" : "text-text-2")}>{f.level === "ok" ? <Check className="mt-0.5 size-3.5 shrink-0" /> : f.level === "info" ? <Info className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}{t(f.message, f.vars)}</li>)}
      </ul>
    </section>
  );
}

async function toBase64(f: globalThis.File) {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Drive picker "en mode shell": the shared folder tree, search, thumbnails; upload with the founder's drive.file grant. */
export function MediaPicker({ open, onOpenChange, selected, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; selected: MediaRef[]; onPick: (m: MediaRef[]) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [trail, setTrail] = React.useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<MediaRef[]>([]);
  const folder = trail.at(-1)?.id;
  const list = useQuery({
    queryKey: ["content-media", folder, q], enabled: open,
    queryFn: () => api<MediaListing>(`/api/content/media?q=${encodeURIComponent(q)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`),
  });
  const upload = useMutation({
    mutationFn: async (f: globalThis.File) => api<DriveFile>("/api/files/upload", { body: { name: f.name, mime_type: f.type || "application/octet-stream", data_base64: await toBase64(f), parent_id: folder ?? list.data?.folderId ?? null } }),
    onSuccess: (f) => { qc.invalidateQueries({ queryKey: ["content-media"] }); qc.invalidateQueries({ queryKey: ["files"] }); setPicked((p) => [...p, mediaRefOf(f)]); toast(t("Uploaded {name}", { name: f.name })); },
  });
  const consent = upload.error instanceof ApiError && upload.error.body.error === "consent_required";
  const has = (id: string) => picked.some((m) => m.file_id === id) || selected.some((m) => m.file_id === id);
  const toggle = (m: MediaRef) => setPicked((p) => (p.some((x) => x.file_id === m.file_id) ? p.filter((x) => x.file_id !== m.file_id) : [...p, m]));
  const close = (o: boolean) => { if (!o) { setPicked([]); setQ(""); } onOpenChange(o); };
  return (
    <Modal open={open} onOpenChange={close} title={t("Pick in Drive")} description={t("Images and videos of the shared Valemont OS folder. Nothing is copied.")} wide>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
            <Input aria-label={t("Search in Drive")} placeholder={t("Search the whole Valemont OS drive")} value={q} onChange={(e) => setQ(e.target.value)} className="h-10 pl-9" />
          </div>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-control px-4 text-sm font-medium hover:bg-subtle">
            <Upload className="size-4" />{upload.isPending ? t("Uploading…") : t("Upload")}
            <input type="file" accept="image/*,video/*,application/pdf" multiple className="sr-only" onChange={(e) => { for (const f of Array.from(e.target.files ?? []).slice(0, 10)) upload.mutate(f); e.target.value = ""; }} />
          </label>
        </div>
        {!q ? (
          <nav aria-label={t("Folder path")} className="flex flex-wrap items-center gap-1 text-sm">
            <button type="button" className="rounded-full px-2 py-1 font-medium hover:bg-subtle" onClick={() => setTrail([])}>Valemont OS</button>
            {trail.map((x, i) => <span key={x.id} className="flex items-center"><ChevronRight className="size-4 text-text-3" /><button type="button" className="rounded-full px-2 py-1 font-medium hover:bg-subtle" onClick={() => setTrail(trail.slice(0, i + 1))}>{x.name}</button></span>)}
          </nav>
        ) : null}
        {consent ? (
          <p role="alert" className="flex flex-wrap items-center gap-3 rounded-[12px] bg-subtle p-3 text-sm">
            {t("Adding files creates them in your own Google Drive, so Google asks your permission once (only files Valemont OS creates).")}
            <Button asChild size="sm" variant="primary"><a href="/api/auth/google/drive?back=/marketing/content">{t("Allow Drive access")}</a></Button>
          </p>
        ) : upload.isError ? <ErrorState error={upload.error} onRetry={() => upload.reset()} /> : null}
        {list.isPending ? <p className="text-sm text-text-2">{t("Loading…")}</p> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data.configured ? (
          <p className="text-sm text-text-2">{t("Create a “Valemont OS” folder in Google Drive, share it with the service account as Viewer, then paste its id in Settings › Workspace.")}</p>
        ) : list.data.files.length === 0 ? <p className="text-sm text-text-2">{t("No image or video here.")}</p> : (
          <ul className="grid max-h-[50dvh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
            {list.data.files.map((f) => (
              <li key={f.file_id}>
                {f.is_folder ? (
                  <button type="button" onClick={() => { setTrail(q ? [{ id: f.file_id, name: f.name }] : [...trail, { id: f.file_id, name: f.name }]); setQ(""); }} className="flex w-full items-center gap-2 rounded-[12px] border border-hairline p-2 text-left text-sm hover:border-control">
                    <Folder className="size-5 shrink-0 text-text-2" /><span className="truncate">{f.name}</span>
                  </button>
                ) : (
                  <button type="button" aria-pressed={has(f.file_id)} disabled={selected.some((m) => m.file_id === f.file_id)} onClick={() => toggle(f)}
                    className={cn("flex w-full flex-col gap-1 rounded-[12px] border p-2 text-left hover:border-control disabled:opacity-50", has(f.file_id) ? "border-ink ring-1 ring-ink" : "border-hairline")}>
                    <Thumb m={f} className="h-24 w-full rounded-[8px]" />
                    <span className="truncate text-[12px]" title={f.name}>{f.name}</span>
                    <span className="num text-[11px] text-text-3">{metaOf(f) || " "}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!picked.length} onClick={() => { onPick(picked); setPicked([]); }}>{t("Add ({n})", { n: picked.length })}</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- accounts of a piece ---------- */

export function AccountGrid({ accounts, value, onChange, disabled = [] }: { accounts: Account[]; value: { account_id: string; language: "FR" | "ES" }[]; onChange: (v: { account_id: string; language: "FR" | "ES" }[]) => void; disabled?: string[] }) {
  const t = useT();
  const on = (id: string, l: "FR" | "ES") => value.some((x) => x.account_id === id && x.language === l);
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-medium text-text-2">{t("Accounts and languages")}</legend>
      <ul className="flex flex-col divide-y divide-hairline">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 truncate">{a.label}</span>
            <span className="flex gap-3">
              {(["FR", "ES"] as const).map((l) => {
                const k = `${a.id}:${l}`;
                return <label key={l} className="flex items-center gap-1.5"><input type="checkbox" className="size-5" disabled={disabled.includes(k)} checked={on(a.id, l) || disabled.includes(k)} aria-label={`${a.label} ${l}`}
                  onChange={(e) => onChange(e.target.checked ? [...value, { account_id: a.id, language: l }] : value.filter((x) => !(x.account_id === a.id && x.language === l)))} />{l}</label>;
              })}
            </span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
function AddAccounts({ open, onOpenChange, piece, accounts, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; piece: Piece; accounts: Account[]; onAdded: (ids: string[]) => void }) {
  const t = useT();
  const save = useSaveHandlers();
  const [sel, setSel] = React.useState<{ account_id: string; language: "FR" | "ES" }[]>([]);
  const m = useMutation({ mutationFn: () => api<{ ids: string[] }>("/api/content/variants", { body: { piece_id: piece.id, targets: sel } }), ...save(), onSuccess: (r) => { save().onSuccess(); setSel([]); onAdded(r.ids); } });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("Add an account")} description={t("One version per account and language: each gets its own text, media and slot.")}>
      <div className="flex flex-col gap-3">
        <AccountGrid accounts={accounts} value={sel} onChange={setSel} disabled={piece.variants.map((v) => `${v.account_id}:${v.language}`)} />
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button variant="primary" disabled={!sel.length || m.isPending} onClick={() => m.mutate()}>{m.isPending ? t("Saving…") : t("Add ({n})", { n: sel.length })}</Button>
      </div>
    </Modal>
  );
}

/* ---------- new idea / new post ---------- */

export function NewPost({ open, onOpenChange, accounts, onCreated, defaultBrand }: { open: boolean; onOpenChange: (o: boolean) => void; accounts: Account[]; onCreated: (id: string) => void; defaultBrand: string }) {
  const t = useT();
  const save = useSaveHandlers();
  const blank = () => ({ id: crypto.randomUUID(), kind: "post" as "idea" | "post", title: "", brand: defaultBrand, format: "post" as ContentFormat, targets: [] as { account_id: string; language: "FR" | "ES" }[] });
  const [v, setV] = React.useState(blank);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>("/api/content", { body: { id: v.id, title: v.title, brand: v.brand === PERSONAL ? null : v.brand, format: v.format, stage: v.kind === "idea" ? "idea" : "draft", targets: v.kind === "idea" ? [] : v.targets } }),
    ...save(() => { const id = v.id; const kind = v.kind; setV(blank()); if (kind === "post") onCreated(id); else { onOpenChange(false); toast(t("Idea saved")); } }),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("New content")} description={t("A one-line idea, or a full post on one or several accounts.")}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (v.title.trim()) m.mutate(); }}>
        <SegmentedSwitch label={t("Kind")} value={v.kind} onChange={(kind) => setV({ ...v, kind })} options={[{ value: "idea", label: t("Idea") }, { value: "post", label: t("Full post") }]} />
        <Field label={v.kind === "idea" ? t("The idea in one line") : t("Title")} htmlFor="np-title"><Input id="np-title" autoFocus value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Type")} htmlFor="np-type"><Select id="np-type" value={v.format} onChange={(e) => setV({ ...v, format: e.target.value as ContentFormat })}>{CONTENT_FORMATS.map((f) => <option key={f} value={f}>{t(FORMAT_LABELS[f])}</option>)}</Select></Field>
          <Field label={t("Brand")} htmlFor="np-brand"><Select id="np-brand" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })}><option value="consulting">Valemont</option><option value="thirty">30/30 AI</option><option value={PERSONAL}>{t("Personal")}</option></Select></Field>
        </div>
        {v.kind === "post" ? <AccountGrid accounts={accounts} value={v.targets} onChange={(targets) => setV({ ...v, targets })} /> : null}
        {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
        <Button type="submit" variant="primary" disabled={m.isPending || !v.title.trim() || (v.kind === "post" && !v.targets.length)}>{m.isPending ? t("Saving…") : v.kind === "idea" ? t("Save the idea") : t("Write the post")}</Button>
      </form>
    </Modal>
  );
}

/* ---------- numbers at a fixed age (published versions) ---------- */

const METRIC_LABEL: Record<string, string> = { views: "Views", impressions: "Impressions", reach: "Reach", likes: "Likes", comments: "Comments", saves: "Saves", shares: "Shares", profile_visits: "Profile visits", link_clicks: "Link clicks", site_visits: "Site visits", leads: "Leads", follows: "Follows" };
function MetricsEntry({ variant }: { variant: Variant }) {
  const t = useT();
  const tag = useDateTag();
  const ig = variant.platform === "instagram";
  const fields = [ig ? "views" : "impressions", "reach", "likes", "comments", "saves", "shares", "profile_visits", "link_clicks", "site_visits", "leads"] as const;
  const [cp, setCp] = React.useState<string>(variant.checkpoints.find((c) => !c.snapshot)?.key ?? "h24");
  const current = variant.checkpoints.find((c) => c.key === cp)?.snapshot ?? null;
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-hairline p-3">
      <h3 className="text-sm font-semibold">{t("Numbers at a fixed age")}</h3>
      <ul className="grid grid-cols-4 gap-2 text-center">
        {variant.checkpoints.map((c) => (
          <li key={c.key} className="rounded-[8px] bg-subtle/60 p-1.5">
            <p className="text-[11px] text-text-3">{t(c.label)}</p>
            <p className="num text-sm font-semibold">{c.snapshot ? (c.snapshot.availability === "ok" ? ((ig ? c.snapshot.views : c.snapshot.impressions)?.toLocaleString(tag) ?? "—") : t("not available")) : "—"}</p>
            <p className="text-[10px] text-text-3">{c.snapshot ? (c.snapshot.source === "api" ? t("API") : t("entered by hand")) : ""}</p>
          </li>
        ))}
      </ul>
      {variant.stories.length ? <p className="text-[12px] text-text-2">{t("Story captured {n} time(s) while live.", { n: variant.stories.length })}</p> : null}
      <SegmentedSwitch size="sm" label={t("Checkpoint")} value={cp} onChange={setCp} options={CHECKPOINTS.map((c) => ({ value: c.key, label: t(c.label) }))} />
      {current?.source === "api" ? <p className="text-[12px] text-text-2">{t("Captured from the API; a number entered by hand would not replace it.")}</p> : null}
      <MetricsForm key={`${cp}:${current?.captured_at ?? ""}`} variant={variant} cp={cp} fields={fields} initial={Object.fromEntries(fields.map((f) => [f, current && current.source === "manual" && current[f] !== null ? String(current[f]) : ""]))} />
    </div>
  );
}
function MetricsForm({ variant, cp, fields, initial }: { variant: Variant; cp: string; fields: readonly string[]; initial: Record<string, string> }) {
  const t = useT();
  const save = useSaveHandlers();
  const [vals, setVals] = React.useState<Record<string, string>>(initial);
  const m = useMutation({
    mutationFn: () => api("/api/content/metrics", { method: "PUT", body: { variant_id: variant.id, checkpoint: cp, ...Object.fromEntries(fields.map((f) => [f, vals[f] === "" || vals[f] === undefined ? null : Number(vals[f])])) } }),
    ...save(() => toast(t("Numbers saved"))),
  });
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => <Field key={f} label={t(METRIC_LABEL[f])} htmlFor={`me-${f}`}><Input id={`me-${f}`} type="number" inputMode="numeric" min={0} className="num" value={vals[f] ?? ""} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} /></Field>)}
      </div>
      <Button size="sm" variant="outline" disabled={m.isPending || Object.values(vals).every((x) => x === "")} onClick={() => m.mutate()}>{m.isPending ? t("Saving…") : t("Save the numbers")}</Button>
      <p className="text-[12px] text-text-3">{t("Recorded as entered by hand. Site visits and leads: from the analytics of the UTM link.")}</p>
      {m.isError ? <ErrorState error={m.error} onRetry={() => m.mutate()} /> : null}
    </>
  );
}
