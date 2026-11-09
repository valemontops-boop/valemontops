import * as React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app/shell";
import { MyDayView } from "@/components/app/my-day-view";
import { CrmView } from "@/components/app/crm-view";
import { ImportView } from "@/components/app/import-view";
import { SettingsView } from "@/components/app/settings-view";
import { FOUNDER_NAMES, type FounderKey } from "@/domain/constants";
import { LOCALE_OF, translate, type Locale } from "@/i18n";
import { usePathname } from "./shims/navigation";
import { exportCsv, founder as initialFounder, grantDrive, grantGmail, installMockFetch, seed, setFounder } from "./mock-api";
import { CommandCenterView } from "@/components/app/command-center-view";
import { TasksView } from "@/components/app/tasks-view";
import { AgendaView } from "@/components/app/agenda-view";
import { IdeasView } from "@/components/app/ideas-view";
import { FilesView } from "@/components/app/files-view";
import { MarketingView } from "@/components/app/marketing-view";
import { ContentStudio } from "@/components/app/content-studio";
import { MoneyView } from "@/components/app/money-view";
import { ClientsView } from "@/components/app/clients-view";
import { ReportsView } from "@/components/app/reports-view";
import { CallMode } from "@/components/app/call-mode";
import { DealView } from "@/components/app/deal-view";

function Page() {
  const path = usePathname();
  if (path.startsWith("/crm/import")) return <ImportView />;
  if (path.startsWith("/crm/deal")) return <DealView />;
  if (path.startsWith("/crm")) return <CrmView />;
  if (path.startsWith("/settings")) return <SettingsView />;
  if (path.startsWith("/command-center")) return <CommandCenterView />;
  if (path.startsWith("/tasks")) return <TasksView />;
  if (path.startsWith("/agenda")) return <AgendaView />;
  if (path.startsWith("/ideas")) return <IdeasView />;
  if (path.startsWith("/files")) return <FilesView />;
  if (path.startsWith("/marketing/content")) return <ContentStudio />;
  if (path.startsWith("/marketing")) return <MarketingView />;
  if (path.startsWith("/reports")) return <ReportsView />;
  if (path.startsWith("/money")) return <MoneyView />;
  if (path.startsWith("/clients")) return <ClientsView />;
  if (path.startsWith("/call")) return <CallMode />;
  return <MyDayView />;
}

function CsvSheet({ csv, onClose, locale }: { csv: string; onClose: () => void; locale: Locale }) {
  const t = (s: string) => translate(locale, s);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv);
    } catch {
      ref.current?.select();
    }
  };
  return (
    <div role="dialog" aria-label={t("CSV export")} className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center">
      <div className="flex w-full max-w-2xl flex-col gap-3 rounded-[20px] bg-panel p-5">
        <h2 className="text-lg font-semibold">{t("CSV export")}</h2>
        <p className="text-sm text-text-2">{t("Downloads are disabled inside the preview, so the file is shown here. In the real app this is a download.")}</p>
        <textarea ref={ref} readOnly value={csv} className="num h-64 w-full rounded-[12px] border border-control bg-panel p-2 font-mono text-[12px]" />
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="h-10 rounded-full bg-accent px-4 text-sm font-medium text-on-accent">{t("Copy CSV")}</button>
          <button type="button" onClick={onClose} className="h-10 rounded-full border border-control px-4 text-sm font-medium">{t("Close")}</button>
        </div>
      </div>
    </div>
  );
}

function alertGrant(locale: Locale, text = "Preview: Drive access granted. In the real app, Google asks you here. Upload again.") {
  const el = document.createElement("div");
  el.textContent = translate(locale, text);
  el.setAttribute("role", "status");
  el.className = "fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-panel";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function Preview() {
  const [who, setWho] = React.useState<FounderKey>(initialFounder);
  const [csv, setCsv] = React.useState<string | null>(null);
  const switchTo = (f: FounderKey) => {
    setFounder(f);
    setWho(f);
  };
  React.useEffect(() => {
    // Intercept links and forms that would leave the page (CSV download, sign out).
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href") ?? "";
      if (href.startsWith("/api/crm/export") || href.startsWith("/api/reports/scorecard") || href.startsWith("/api/csv/export")) {
        e.preventDefault();
        exportCsv(href).then(setCsv);
      }
      if (href.startsWith("/api/auth/google/drive")) {
        e.preventDefault();
        grantDrive(); // preview stand-in for Google's consent screen
        alertGrant(LOCALE_OF[who]);
      }
      if (href.startsWith("/api/auth/google/gmail")) {
        e.preventDefault();
        grantGmail(); // preview stand-in for Google's consent screen (gmail.send)
        alertGrant(LOCALE_OF[who], "Preview: Gmail connected (send only). Emails stay inside the preview, nothing is really sent.");
        window.dispatchEvent(new Event("vos-refetch"));
      }
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if (f.getAttribute("action")?.startsWith("/api/auth/logout")) {
        e.preventDefault();
        switchTo(who === "theo" ? "pablo" : "theo");
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  });
  const other: FounderKey = who === "theo" ? "pablo" : "theo";
  const t = (s: string, vars?: Record<string, string>) => translate(LOCALE_OF[who], s, vars);
  return (
    <>
      <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-ink px-4 py-1.5 text-center text-[13px] font-medium text-panel">
        <span>{t("PREVIEW · DEMO data running in your browser. Nothing is saved; reloading starts over.")}</span>
        <span className="flex items-center gap-2">
          {t("Signed in as {name}", { name: FOUNDER_NAMES[who] })}
          <button type="button" onClick={() => switchTo(other)} className="rounded-full bg-panel px-3 py-0.5 text-ink">{t("Switch to {name}", { name: FOUNDER_NAMES[other] })}</button>
        </span>
      </div>
      <AppShell key={who} me={{ founder: who, name: FOUNDER_NAMES[who], config: { mode: "demo", pollSeconds: 30, backend: "browser" } }}>
        <Page />
      </AppShell>
      {csv !== null ? <CsvSheet csv={csv} onClose={() => setCsv(null)} locale={LOCALE_OF[who]} /> : null}
    </>
  );
}

installMockFetch();
seed().then(() => {
  createRoot(document.getElementById("root")!).render(<Preview />);
});
