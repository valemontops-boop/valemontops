"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Search, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, SegmentedSwitch, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  BRAND_LABELS, BRANDS, CONTACT_TYPES, CONTACT_TYPE_LABELS, FOLLOW_UP_CHANNELS, OBJECTIONS, OBJECTION_LABELS, OUTCOME_LABELS,
  type ActivityType, type Brand, type ContactType, type Outcome,
} from "@/domain/constants";
import { addDays } from "@/domain/time";
import { useCrm, type CrmAccount, type CrmContact } from "./use-crm";
import { useMe } from "./providers";
import { useT } from "@/i18n/react";

export type QuickKind = "call" | "visit" | "dm" | "invitation" | "inmail" | "email" | "follow_up" | "demo" | "meeting" | "comment";
export const QUICK_KINDS: { kind: QuickKind; label: string; key: string }[] = [
  { kind: "call", label: "Phone call", key: "c" },
  { kind: "visit", label: "Field visit", key: "v" },
  { kind: "dm", label: "LinkedIn DM", key: "d" },
  { kind: "invitation", label: "Invitation", key: "l" },
  { kind: "inmail", label: "InMail", key: "n" },
  { kind: "email", label: "Cold email", key: "e" },
  { kind: "follow_up", label: "Follow-up", key: "f" },
  { kind: "demo", label: "Demo shown", key: "s" },
  { kind: "meeting", label: "Meeting", key: "m" },
  { kind: "comment", label: "LinkedIn comment", key: "o" },
];

export interface QuickPrefill {
  kind?: QuickKind;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  nextActionHint?: string;
}

const Ctx = React.createContext<{ open: (p?: QuickPrefill) => void } | null>(null);
export function useQuickAction() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useQuickAction outside provider");
  return c;
}

export function QuickActionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; prefill: QuickPrefill; session: number }>({ open: false, prefill: {}, session: 0 });
  const open = React.useCallback((p: QuickPrefill = {}) => setState((s) => ({ open: true, prefill: p, session: s.session + 1 })), []);
  const t = useT();
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <Modal open={state.open} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))} title={t("Log activity")} description={t("Counted only after the server confirms the save.")}>
        {state.open ? <QuickActionForm key={state.session} prefill={state.prefill} onDone={() => setState((s) => ({ ...s, open: false }))} /> : null}
      </Modal>
    </Ctx.Provider>
  );
}

/** English words for API values, translated at render. */
const CHANNEL_WORDS: Record<string, string> = { phone: "Phone", email: "Email", linkedin: "LinkedIn", in_person: "In person", field_visit: "Field visit", whatsapp: "WhatsApp" };
const RULE_STATUS_WORDS: Record<string, string> = { allowed: "Allowed", allowed_with_conditions: "Allowed with conditions", requires_consent: "Requires consent", needs_review: "Needs review" };

type CallResult = "no_answer" | "voicemail" | "connected";
const CONNECTED_OUTCOMES: Outcome[] = ["conversation", "interested", "not_interested", "callback_requested", "demo_booked", "meeting_booked", "gatekeeper"];
const VISIT_OUTCOMES: Outcome[] = ["met_owner", "owner_absent", "interested", "not_interested", "callback_requested", "demo_booked"];
const MESSAGE_OUTCOMES: Outcome[] = ["sent", "interested", "not_interested"];

function typeFor(kind: QuickKind, call: CallResult, meeting: "booked" | "held"): ActivityType {
  switch (kind) {
    case "call": return call === "connected" ? "connected_call" : call === "voicemail" ? "voicemail" : "cold_call";
    case "visit": return "field_visit";
    case "dm": return "linkedin_dm";
    case "invitation": return "linkedin_invitation";
    case "inmail": return "inmail";
    case "email": return "cold_email";
    case "follow_up": return "follow_up";
    case "demo": return "demo_shown";
    case "meeting": return meeting === "held" ? "meeting_held" : "meeting_booked";
    case "comment": return "comment";
  }
}

function ruleChannel(kind: QuickKind, followChannel: string): "phone" | "email" | "linkedin" | "field_visit" | null {
  if (kind === "call") return "phone";
  if (kind === "email") return "email";
  if (kind === "dm" || kind === "invitation" || kind === "inmail") return "linkedin";
  if (kind === "visit") return "field_visit";
  if (kind === "follow_up") return followChannel === "email" ? "email" : followChannel === "linkedin" ? "linkedin" : followChannel === "in_person" ? "field_visit" : "phone";
  return null;
}

function QuickActionForm({ prefill, onDone }: { prefill: QuickPrefill; onDone: () => void }) {
  const me = useMe();
  const t = useT();
  const crm = useCrm();
  const qc = useQueryClient();
  const [idempotencyKey] = React.useState(() => crypto.randomUUID()); // reused for every retry (spec 4.2)
  const [kind, setKind] = React.useState<QuickKind>(prefill.kind ?? "call");
  const [callResult, setCallResult] = React.useState<CallResult>("no_answer");
  const [meeting, setMeeting] = React.useState<"booked" | "held">("booked");
  const [accountId, setAccountId] = React.useState(prefill.accountId ?? "");
  const [contactChoice, setContactId] = React.useState(prefill.contactId ?? "");
  const [oppChoice, setOpportunityId] = React.useState(prefill.opportunityId ?? "");
  const [query, setQuery] = React.useState("");
  const [fast, setFast] = React.useState(false);
  const [fc, setFc] = React.useState({ company_name: "", contact_name: "", phone: "", email: "", country: "FR" as "FR" | "ES", contact_type: "professional_named" as ContactType, niche: "" });
  const [outcome, setOutcome] = React.useState<Outcome | "">("");
  const [objection, setObjection] = React.useState("");
  const [metPerson, setMetPerson] = React.useState("");
  const [channel, setChannel] = React.useState("phone");
  const [notes, setNotes] = React.useState("");
  const [nextAction, setNextAction] = React.useState(prefill.nextActionHint ?? "");
  const [nextDue, setNextDue] = React.useState("");
  const [brand, setBrand] = React.useState<Brand | "">("");
  const [formError, setFormError] = React.useState<string | null>(null);

  const accounts = React.useMemo(() => crm.data?.accounts ?? [], [crm.data]);
  const account: CrmAccount | undefined = accounts.find((a) => a.id === accountId);
  const contacts = (crm.data?.contacts ?? []).filter((c) => c.account_id === accountId);
  const opps = (crm.data?.opportunities ?? []).filter((o) => o.account_id === accountId && !["won", "lost"].includes(o.stage));
  // A single contact or open opportunity is selected implicitly (derived, not synced state).
  const contactId = contactChoice || (contacts.length === 1 ? contacts[0].id : "");
  const opportunityId = oppChoice || (opps.length === 1 ? opps[0].id : "");
  const contact: CrmContact | undefined = contacts.find((c) => c.id === contactId);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byName = accounts.filter((a) => a.name.toLowerCase().includes(q) || a.phone.replace(/\s/g, "").includes(q.replace(/\s/g, "")));
    const viaContact = (crm.data?.contacts ?? []).filter((c) => c.full_name.toLowerCase().includes(q)).map((c) => accounts.find((a) => a.id === c.account_id)).filter(Boolean) as CrmAccount[];
    return [...new Map([...byName, ...viaContact].map((a) => [a.id, a])).values()].slice(0, 6);
  }, [query, accounts, crm.data?.contacts]);

  const blockedReason = contact?.blocked_reason ?? account?.blocked_reason ?? null;
  const outreach = !["demo", "meeting", "comment"].includes(kind);
  const rc = ruleChannel(kind, channel);
  const contactType = contact?.contact_type ?? (fast ? fc.contact_type : undefined);
  const market = account?.country ?? (fast ? fc.country : null);
  const rule = rc && contactType && market ? crm.data?.channelRules.find((r) => r.market === market && r.contact_type === contactType && r.channel === rc) : undefined;

  const today = new Date().toLocaleDateString("en-CA"); // browser-local date for due-date chips
  const activityType = typeFor(kind, callResult, meeting);
  const mutation = useMutation({
    mutationKey: ["log-activity"],
    mutationFn: () =>
      api<{ duplicate: boolean; warnings: string[] }>("/api/activities", {
        body: {
          idempotency_key: idempotencyKey,
          activity_type: activityType,
          channel: kind === "follow_up" ? channel : null,
          account_id: fast ? "" : accountId,
          contact_id: fast ? "" : contactId,
          opportunity_id: fast ? "" : opportunityId,
          fast_contact: fast ? fc : null,
          brand: brand || null,
          outcome: kind === "call" && callResult === "no_answer" ? "no_answer" : outcome || null,
          objection: objection || null,
          met_person: metPerson,
          notes,
          next_action: nextAction,
          next_action_due: nextDue,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast(r.duplicate ? t("Already saved earlier. Not counted twice.") : t("Saved"));
      for (const w of r.warnings) toast(t(w));
      onDone();
    },
    onError: (e) => {
      setFormError(e instanceof ApiError && e.isBlocked ? t(e.message) : e instanceof ApiError && e.isRetryable ? t("Error: {message} Retry keeps the same entry, so nothing is counted twice.", { message: t(e.message) }) : t((e as Error).message));
    },
  });

  const businessOk = kind === "comment" ? !fast || fc.company_name.trim().length > 0 : fast ? fc.company_name.trim().length > 0 : Boolean(accountId);
  const canSave = businessOk && !(outreach && blockedReason) && !mutation.isPending;
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setFormError(null);
    if (!canSave) return;
    mutation.mutate();
  };

  const outcomeOptions = kind === "call" && callResult === "connected" ? CONNECTED_OUTCOMES : kind === "visit" ? VISIT_OUTCOMES : ["dm", "invitation", "inmail", "email", "follow_up"].includes(kind) ? MESSAGE_OUTCOMES : [];

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}>
      <div role="radiogroup" aria-label={t("Activity")} className="flex flex-wrap gap-2">
        {QUICK_KINDS.map((k) => (
          <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => { setKind(k.kind); setOutcome(""); }}
            className={cn("h-10 rounded-full border px-4 text-sm font-medium", kind === k.kind ? "border-ink bg-ink text-panel" : "border-control text-ink hover:bg-subtle")}>
            {t(k.label)}
          </button>
        ))}
      </div>

      {/* Business */}
      {!fast ? (
        account ? (
          <div className="flex items-center justify-between gap-3 rounded-[12px] bg-subtle px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{account.name}</p>
              <p className="text-[13px] text-text-2">{[account.country, account.niche, account.phone].filter(Boolean).join(" · ")}</p>
            </div>
            {!prefill.accountId ? (
              <button type="button" className="rounded-full p-2 hover:bg-panel" aria-label={t("Change business")} onClick={() => { setAccountId(""); setContactId(""); setOpportunityId(""); }}>
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="qa-search" className="text-[13px] font-medium text-text-2">{kind === "comment" ? t("Business (optional)") : t("Business")}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
              <Input id="qa-search" autoFocus placeholder={t("Search by business, contact or phone")} value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" autoComplete="off" />
            </div>
            {results.length > 0 ? (
              <ul className="flex flex-col divide-y divide-hairline rounded-[12px] border border-hairline">
                {results.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => { setAccountId(a.id); setQuery(""); }} className="flex min-h-11 w-full items-center justify-between px-3 py-2 text-left hover:bg-subtle">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-[13px] text-text-3">{a.country ?? ""}{a.blocked_reason ? ` · ${t("blocked")}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim() && crm.isSuccess ? <p className="text-sm text-text-2">{t("No match.")}</p> : null}
            <button type="button" className="self-start text-sm font-medium text-accent-text underline underline-offset-2" onClick={() => { setFast(true); setFc((f) => ({ ...f, company_name: query })); }}>
              {t("Add a new business")}
            </button>
          </div>
        )
      ) : (
        <fieldset className="grid grid-cols-1 gap-3 rounded-[12px] border border-hairline p-3 sm:grid-cols-2">
          <legend className="px-1 text-[13px] font-medium text-text-2">{t("New business")}</legend>
          <Field label={t("Business name")} htmlFor="fc-company"><Input id="fc-company" autoFocus value={fc.company_name} onChange={(e) => setFc({ ...fc, company_name: e.target.value })} /></Field>
          <Field label={t("Country")} htmlFor="fc-country">
            <SegmentedSwitch label={t("Country")} value={fc.country} onChange={(v) => setFc({ ...fc, country: v })} options={[{ value: "FR", label: t("France") }, { value: "ES", label: t("Spain") }]} />
          </Field>
          <Field label={t("Contact name")} htmlFor="fc-name"><Input id="fc-name" value={fc.contact_name} onChange={(e) => setFc({ ...fc, contact_name: e.target.value })} /></Field>
          <Field label={t("Phone")} htmlFor="fc-phone"><Input id="fc-phone" type="tel" inputMode="tel" value={fc.phone} onChange={(e) => setFc({ ...fc, phone: e.target.value })} /></Field>
          <Field label={t("Email")} htmlFor="fc-email"><Input id="fc-email" type="email" value={fc.email} onChange={(e) => setFc({ ...fc, email: e.target.value })} /></Field>
          <Field label={t("Contact type")} htmlFor="fc-type">
            <Select id="fc-type" value={fc.contact_type} onChange={(e) => setFc({ ...fc, contact_type: e.target.value as ContactType })}>
              {CONTACT_TYPES.map((ct) => <option key={ct} value={ct}>{t(CONTACT_TYPE_LABELS[ct])}</option>)}
            </Select>
          </Field>
          <button type="button" className="self-start text-sm text-text-2 underline sm:col-span-2" onClick={() => setFast(false)}>{t("Search existing businesses instead")}</button>
        </fieldset>
      )}

      {account && contacts.length > 1 ? (
        <Field label={t("Contact")} htmlFor="qa-contact">
          <Select id="qa-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t("Business (no specific person)")}</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email || c.phone}{c.blocked_reason ? ` (${t("blocked")})` : ""}</option>)}
          </Select>
        </Field>
      ) : null}
      {account && opps.length > 1 ? (
        <Field label={t("Opportunity")} htmlFor="qa-opp">
          <Select id="qa-opp" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
            <option value="">{t("None")}</option>
            {opps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
      ) : null}

      {outreach && blockedReason ? (
        <p role="alert" className="flex items-start gap-2 rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad">
          <Ban className="mt-0.5 size-4 shrink-0" /> {t(blockedReason)} {t("Outreach cannot be logged or queued for either founder.")}
        </p>
      ) : null}
      {outreach && rule && rule.status !== "allowed" && !blockedReason ? (
        <p className="flex items-start gap-2 rounded-[12px] bg-subtle p-3 text-[13px] text-text-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-text" />
          <span><strong className="font-semibold text-ink">{rule.market} · {t(CONTACT_TYPE_LABELS[rule.contact_type])} · {t(CHANNEL_WORDS[rule.channel] ?? rule.channel)}: {t(RULE_STATUS_WORDS[rule.status] ?? rule.status.replace(/_/g, " "))}.</strong> {t(rule.note)} {t("Not legal advice.")}</span>
        </p>
      ) : null}

      {kind === "call" ? (
        <Field label={t("Result")} htmlFor="qa-call">
          <SegmentedSwitch label={t("Call result")} value={callResult} onChange={(v) => { setCallResult(v); setOutcome(""); }} options={[{ value: "no_answer", label: t("No answer") }, { value: "voicemail", label: t("Voicemail") }, { value: "connected", label: t("Connected") }]} />
        </Field>
      ) : null}
      {kind === "meeting" ? (
        <Field label={t("Meeting")} htmlFor="qa-meeting">
          <SegmentedSwitch label={t("Meeting")} value={meeting} onChange={setMeeting} options={[{ value: "booked", label: t("Booked") }, { value: "held", label: t("Held") }]} />
        </Field>
      ) : null}
      {kind === "follow_up" ? (
        <Field label={t("Channel")} htmlFor="qa-channel">
          <Select id="qa-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {FOLLOW_UP_CHANNELS.map((c) => <option key={c} value={c}>{t(CHANNEL_WORDS[c] ?? c.replace("_", " "))}</option>)}
          </Select>
        </Field>
      ) : null}

      {outcomeOptions.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-text-2">{t("Outcome")}</span>
          <div className="flex flex-wrap gap-2">
            {outcomeOptions.map((o) => (
              <button key={o} type="button" aria-pressed={outcome === o} onClick={() => setOutcome(outcome === o ? "" : o)}
                className={cn("min-h-10 rounded-full border px-3 text-sm", outcome === o ? "border-ink bg-ink text-panel" : "border-control hover:bg-subtle")}>
                {t(OUTCOME_LABELS[o])}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {kind === "visit" ? (
        <Field label={t("Who you met")} htmlFor="qa-met"><Input id="qa-met" value={metPerson} onChange={(e) => setMetPerson(e.target.value)} placeholder={t("e.g. owner, receptionist")} /></Field>
      ) : null}

      <details className="group rounded-[12px] border border-hairline px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-text-2">{t("Objection, notes, brand")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label={t("Objection")} htmlFor="qa-obj">
            <Select id="qa-obj" value={objection} onChange={(e) => setObjection(e.target.value)}>
              <option value="">{t("None")}</option>
              {OBJECTIONS.map((o) => <option key={o} value={o}>{t(OBJECTION_LABELS[o])}</option>)}
            </Select>
          </Field>
          <Field label={t("Notes")} htmlFor="qa-notes"><Textarea id="qa-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} /></Field>
          <Field label={t("Brand")} htmlFor="qa-brand">
            <Select id="qa-brand" value={brand} onChange={(e) => setBrand(e.target.value as Brand)}>
              <option value="">{t("From the business or opportunity")}</option>
              {BRANDS.filter((b) => b !== "local").map((b) => <option key={b} value={b}>{t(BRAND_LABELS[b])}</option>)}
            </Select>
          </Field>
        </div>
      </details>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <Field label={t("Next action")} htmlFor="qa-next"><Input id="qa-next" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder={t("e.g. Call back after 5pm")} /></Field>
        <Field label={t("Due")} htmlFor="qa-due"><Input id="qa-due" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></Field>
      </div>
      <div className="-mt-2 flex flex-wrap gap-2">
        {[["Tomorrow", 1], ["In 3 days", 3], ["In 7 days", 7], ["In 14 days", 14]].map(([l, d]) => (
          <button key={l} type="button" onClick={() => setNextDue(addDays(today, d as number))} className="min-h-9 rounded-full border border-hairline px-3 text-[13px] text-text-2 hover:bg-subtle">{t(l as string)}</button>
        ))}
      </div>

      {formError ? <p role="alert" className="rounded-[12px] bg-[#fbeceb] p-3 text-sm text-bad">{formError}</p> : null}

      <div className="sticky bottom-0 z-10 -mx-5 flex items-center justify-between gap-3 border-t border-hairline bg-panel px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <span className="text-[13px] text-text-3">{t("Logged by {name} · Enter to save", { name: me.name })}</span>
        <Button type="submit" variant="primary" size="lg" disabled={!canSave} className="min-w-36">
          {mutation.isPending ? t("Saving…") : formError && mutation.isError ? t("Retry") : t("Save")}
        </Button>
      </div>
    </form>
  );
}
