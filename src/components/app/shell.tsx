"use client";
import { PhoneCall, Bell, CalendarDays, ChevronDown, Command, FileText, Gauge, Lightbulb, LayoutList, ListChecks, Megaphone, Plus, RefreshCw, Settings, Sun, Users, AlertCircle, Check, Loader2, BarChart3, X, Wallet } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { IdeaCapture } from "./idea-capture";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { WORK_MODE_LABELS } from "@/domain/constants";
import { cn, relTime } from "@/lib/utils";
import { Providers, useMe, useSyncStatus, type Me } from "./providers";
import { QUICK_KINDS, QuickActionProvider, useQuickAction } from "./quick-action";
import { useCrm, useMyDay } from "./use-crm";
import { useT } from "@/i18n/react";

const NAV = [
  { href: "/command-center", label: "Command Center", icon: Gauge },
  { href: "/my-day", label: "My Day", icon: Sun },
  { href: "/call", label: "Call mode", icon: PhoneCall },
  { href: "/crm", label: "Sales CRM", icon: Users },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/money", label: "Money", icon: Wallet },
];
const WORKSPACE = [
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];
const MOBILE_NAV = [
  { href: "/my-day", label: "My Day", icon: Sun },
  { href: "/call", label: "Call mode", icon: PhoneCall },
  { href: "/crm", label: "CRM", icon: Users },
  { href: "/command-center", label: "Team", icon: Gauge },
  { href: "/settings", label: "More", icon: Settings },
];

type Notif = { key: string; kind: string; title: string; detail: string; href: string };
function Notifications() {
  const qc = useQueryClient();
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<Notif[]>("/api/notifications") });
  const dismiss = useMutation({ mutationFn: (key: string) => api("/api/notifications", { body: { key } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const n = q.data?.length ?? 0;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={n ? t("{n} notifications", { n }) : t("Notifications")} className="relative flex size-10 items-center justify-center rounded-full text-text-2 hover:bg-subtle hover:text-ink">
        <Bell className="size-5" />
        {n ? <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-ink px-1 text-center text-[11px] leading-4 text-panel">{n}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label={t("Notifications")} className="absolute right-0 top-12 z-30 w-[min(92vw,380px)] rounded-[20px] bg-panel p-3 shadow-[0_12px_40px_rgba(23,22,26,0.16)]">
          {q.isError ? <p className="p-2 text-sm text-bad">{t("Error: could not load notifications.")}</p> : n === 0 ? <p className="p-2 text-sm text-text-2">{t("Nothing needs you right now.")}</p> : (
            <ul className="flex max-h-96 flex-col overflow-y-auto">
              {q.data!.map((x) => (
                <li key={x.key} className="flex items-start gap-2 rounded-[12px] p-2 hover:bg-subtle">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setOpen(false); router.push(x.href); }}>
                    <p className="text-sm font-medium">{t(x.title)}</p>
                    <p className="text-[12px] text-text-2">{t(x.detail)}</p>
                  </button>
                  <button type="button" aria-label={t("Dismiss")} onClick={() => dismiss.mutate(x.key)} className="rounded-full p-1 text-text-3 hover:bg-panel hover:text-ink"><X className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NavLink({ href, label, icon: Icon, path, badge }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; path: string; badge?: number }) {
  const active = path.startsWith(href);
  const t = useT();
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={cn("flex h-10 items-center gap-3 rounded-[12px] px-3 text-sm font-medium", active ? "bg-subtle text-ink" : "text-text-2 hover:bg-subtle hover:text-ink")}>
      <Icon className="size-4" />
      <span className="flex-1">{t(label)}</span>
      {badge ? <span className="num rounded-full bg-ink px-2 text-[12px] text-panel">{badge}</span> : null}
    </Link>
  );
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  return (
    <Providers me={me}>
      <QuickActionProvider>
        <Frame>{children}</Frame>
      </QuickActionProvider>
    </Providers>
  );
}

function ModeBanner() {
  const me = useMe();
  const t = useT();
  if (me.config.mode === "live" && me.config.backend === "google-sheets") return null;
  if (me.config.backend === "browser") return null; // the preview renders its own banner with a founder switch
  const text =
    me.config.mode === "demo"
      ? me.config.backend === "fake-sheets"
        ? "DEMO mode · synthetic data on a local fake Google Sheets server. Nothing here is real or touches your Sheet."
        : "DEMO mode · synthetic data held in server memory. Nothing here is real or touches your Sheet."
      : "LIVE mode pointed at a local fake Sheets server (development only).";
  return (
    <div role="status" className="sticky top-0 z-20 bg-ink px-4 py-1.5 text-center text-[13px] font-medium text-panel">
      {t(text)}
    </div>
  );
}

function SyncBadge() {
  const s = useSyncStatus();
  const t = useT();
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-[13px]" aria-live="polite">
      {s.status === "syncing" ? (
        <span className="flex items-center gap-1.5 text-text-2"><Loader2 className="size-3.5 animate-spin" />{t("Syncing")}</span>
      ) : s.status === "error" ? (
        <button type="button" onClick={() => s.refresh()} className="flex items-center gap-1.5 font-medium text-bad" title={s.error ? t(s.error) : undefined}>
          <AlertCircle className="size-3.5" />{t("Error: retry")}
        </button>
      ) : (
        <span className="flex items-center gap-1.5 text-text-2"><Check className="size-3.5 text-good" />{t("Saved · synced {when}", { when: t(relTime(s.lastSyncAt)) })}</span>
      )}
      <button type="button" onClick={() => s.refresh()} className="rounded-full p-1.5 text-text-3 hover:bg-subtle hover:text-ink" aria-label={t("Refresh now")}>
        <RefreshCw className="size-3.5" />
      </button>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const path = usePathname();
  const router = useRouter();
  const qa = useQuickAction();
  const t = useT();
  const [palette, setPalette] = React.useState(false);
  const [idea, setIdea] = React.useState(false);
  const [wsOpen, setWsOpen] = React.useState(true);
  const day = useMyDay();
  const followUps = day.data?.followUps.filter((f) => f.overdue).length ?? 0;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      // Live calling owns the single-letter keys (outcomes, objections, follow-ups).
      if (document.querySelector("[data-call-live]")) return;
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setIdea(true);
        return;
      }
      const k = QUICK_KINDS.find((q) => q.key === e.key.toLowerCase());
      if (k) {
        e.preventDefault();
        qa.open({ kind: k.kind });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qa]);

  return (
    <div className="min-h-dvh">
      <ModeBanner />
      <div className="flex">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-hairline bg-panel px-3 py-5 md:flex">
          <Link href="/my-day" className="mb-6 px-3 text-[17px] font-semibold tracking-tight">Valemont OS</Link>
          <nav aria-label={t("Main")} className="flex flex-col gap-1">
            {NAV.map((n) => <NavLink key={n.href} {...n} path={path} badge={n.href === "/my-day" ? followUps : undefined} />)}
            <button type="button" onClick={() => setWsOpen((o) => !o)} aria-expanded={wsOpen} className="mt-3 flex h-8 items-center justify-between rounded-[12px] px-3 text-[12px] font-semibold text-text-3 hover:text-ink">
              {t("Workspace")} <ChevronDown className={cn("size-4 transition-transform", !wsOpen && "-rotate-90")} />
            </button>
            {wsOpen ? WORKSPACE.map((n) => <NavLink key={n.href} {...n} path={path} />) : null}
          </nav>
          <div className="mt-auto flex flex-col gap-1">
            <Link href="/settings" aria-current={path.startsWith("/settings") ? "page" : undefined}
              className={cn("flex h-10 items-center gap-3 rounded-[12px] px-3 text-sm font-medium", path.startsWith("/settings") ? "bg-subtle text-ink" : "text-text-2 hover:bg-subtle hover:text-ink")}>
              <Settings className="size-4" /> {t("Settings")}
            </Link>
            <div className="mt-2 flex items-center justify-between rounded-[12px] border border-hairline px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{me.name}</p>
                <p className="truncate text-[12px] text-text-3">{day.data?.mode ? t(WORK_MODE_LABELS[day.data.mode]) : t("No mode set")}</p>
              </div>
              <form action="/api/auth/logout" method="post">
                <button className="rounded-full px-2 py-1 text-[12px] text-text-2 hover:bg-subtle" type="submit">{t("Sign out")}</button>
              </form>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-hairline bg-canvas/95 px-4 backdrop-blur sm:px-6">
            <span className="text-[15px] font-semibold md:hidden">Valemont OS</span>
            <button type="button" onClick={() => setPalette(true)} className="hidden h-9 w-72 items-center gap-2 rounded-full border border-hairline bg-panel px-3 text-sm text-text-3 hover:border-control sm:flex">
              <Command className="size-4" /> {t("Search or run a command")} <kbd className="ml-auto text-[12px]">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden sm:block"><SyncBadge /></div>
              <Notifications />
              <Button variant="ghost" size="icon" onClick={() => setIdea(true)} aria-label={t("New idea (I)")} title={t("New idea (I)")}><Lightbulb /></Button>
              <Button variant="primary" size="md" onClick={() => qa.open()} aria-keyshortcuts="c v d l n e f s m">
                <Plus /> {t("Log activity")}
              </Button>
            </div>
          </header>
          <div className="border-b border-hairline px-4 py-1.5 sm:hidden"><SyncBadge /></div>
          <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 md:pb-10">{children}</main>
        </div>
      </div>

      <nav aria-label={t("Main")} className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-hairline bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
        {MOBILE_NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}
            className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", path.startsWith(n.href) ? "text-ink" : "text-text-3")}>
            <n.icon className="size-5" />{t(n.label)}
          </Link>
        ))}
      </nav>

      <IdeaCapture open={idea} onOpenChange={setIdea} />
      <CommandPalette open={palette} onOpenChange={setPalette} onNavigate={(href) => router.push(href)} />
    </div>
  );
}

function CommandPalette({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (o: boolean) => void; onNavigate: (href: string) => void }) {
  const t = useT();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("Command")}>
      {/* Content unmounts when closed, so search state resets on every open. */}
      <PaletteBody onClose={() => onOpenChange(false)} onNavigate={onNavigate} />
    </Modal>
  );
}

function PaletteBody({ onClose, onNavigate }: { onClose: () => void; onNavigate: (href: string) => void }) {
  const qa = useQuickAction();
  const crm = useCrm();
  const t = useT();
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const items = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const actions = [
      ...QUICK_KINDS.map((k) => ({ id: `qa-${k.kind}`, label: t("Log: {activity}", { activity: t(k.label) }), hint: k.key.toUpperCase(), run: () => qa.open({ kind: k.kind }) })),
      ...[...NAV, ...WORKSPACE].map((n) => ({ id: `nav-${n.href}`, label: t("Go to {page}", { page: t(n.label) }), hint: "", run: () => onNavigate(n.href) })),
      { id: "nav-import", label: t("Import prospects from CSV"), hint: "", run: () => onNavigate("/crm/import") },
      { id: "nav-settings", label: t("Open Settings"), hint: "", run: () => onNavigate("/settings") },
    ];
    const accounts = (crm.data?.accounts ?? []).map((a) => ({ id: a.id, label: a.name, hint: a.country ?? "", run: () => onNavigate(`/crm?account=${a.id}`) }));
    const all = [...actions, ...accounts];
    return (s ? all.filter((i) => i.label.toLowerCase().includes(s)) : actions).slice(0, 10);
  }, [q, crm.data, qa, onNavigate, t]);
  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    setTimeout(it.run, 0);
  };
  return (
    <>
      <Input autoFocus aria-label={t("Search")} placeholder={t("Type a command or a business name")} value={q}
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); run(sel); }
        }} />
      <ul role="listbox" className="mt-3 flex flex-col">
        {items.map((it, i) => (
          <li key={it.id} role="option" aria-selected={i === sel}>
            <button type="button" onClick={() => run(i)} onMouseEnter={() => setSel(i)}
              className={cn("flex h-11 w-full items-center justify-between rounded-[12px] px-3 text-left text-sm", i === sel ? "bg-subtle" : "")}>
              <span className="flex items-center gap-2"><LayoutList className="size-4 text-text-3" />{it.label}</span>
              {it.hint ? <kbd className="text-[12px] text-text-3">{it.hint}</kbd> : null}
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="px-3 py-2 text-sm text-text-2">{t("No match.")}</li> : null}
      </ul>
    </>
  );
}
